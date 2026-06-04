// kernel::vault_graph — link + tag scanner derived from vault markdown files.
//
// (ADR-002 substrate § vault v1 §8.3 #9-15, 2026-06-01 — memory
// `decision_vault_adr_002_section_8`.)
//
// Walks the vault tree, parses every `.md` file (frontmatter scalar
// values + body wikilinks + markdown links + inline `#tags`) and builds
// an in-memory graph. The result is a *derivative* — vault files on
// disk remain the source of truth, the graph is rebuilt on demand.
//
// Per memory `feedback_build_system_not_business`, this module emits
// raw graph primitives only (nodes + edges + tag→note index +
// backlink/orphan/broken-link views). Daily Note convention and
// sourcing routine compose from these primitives at the feature layer
// (frontend / Irisy), not here.
//
// Per memory `feedback_reuse_existing_capability_first`, frontmatter
// parsing reuses `vault::read` (which already splits the YAML preamble
// into `serde_json::Value`). No new YAML parser dependency in kernel.

use std::collections::HashMap;
use std::path::Path;

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;
use walkdir::WalkDir;

use crate::kernel::vault;

/// Snippet radius (chars) around a backlink hit for the preview that
/// the L2 BacklinksDrawer renders. Matches kairo's behavior — enough to
/// disambiguate context without rendering the entire paragraph.
const BACKLINK_SNIPPET_RADIUS: usize = 40;

/// Maximum body bytes loaded per file into the in-memory graph. Vaults
/// of 1000 notes × 4 KiB = 4 MiB heap, well within budget; cap protects
/// against pathological multi-MB markdown files (e.g. mass-imported
/// research dumps).
const MAX_BODY_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct NodeInfo {
    pub path: String,
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub starred: bool,
    /// Outgoing links to other vault notes (resolved relative paths).
    pub outlinks: Vec<String>,
    /// Outgoing link targets that could not be resolved to any vault
    /// file. Surfaced via `vault.broken_links()`.
    pub broken: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BacklinkHit {
    pub from: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct MentionHit {
    pub path: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrokenLink {
    pub from: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub nodes: Vec<String>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum GraphError {
    #[error("graph io: {0}")]
    Io(String),
    #[error("graph regex: {0}")]
    Regex(String),
}

/// In-memory link / tag / mention graph. Hold by reference — clone is
/// the caller's choice when the graph needs to outlive the read lock.
pub struct VaultGraph {
    /// Each node keyed by its vault-relative path (e.g. `notes/foo.md`).
    nodes: HashMap<String, NodeInfo>,
    /// Body kept off `NodeInfo` so external callers can serialize nodes
    /// without paying the body-content tax. Indexed by same path key.
    bodies: HashMap<String, String>,
    /// `stem` (filename without extension) → vault path(s). First entry
    /// wins on wikilink resolution when multiple files share a stem.
    by_stem: HashMap<String, Vec<String>>,
    /// `alias` declared in frontmatter → vault path. Aliases collide ⇒
    /// last write wins (callers can fix by renaming the alias).
    by_alias: HashMap<String, String>,
}

/// Scan the vault root and return a fresh graph. Caller is responsible
/// for any caching (kernel does not cache because the typical query
/// pattern is one batch per UI action; rescan on every call is < 100 ms
/// for a 1k-note vault, see commands/vault.rs::vault_backlinks).
pub fn scan(vault_root: &Path) -> Result<VaultGraph, GraphError> {
    let mut nodes: HashMap<String, NodeInfo> = HashMap::new();
    let mut bodies: HashMap<String, String> = HashMap::new();
    let mut by_stem: HashMap<String, Vec<String>> = HashMap::new();
    let mut by_alias: HashMap<String, String> = HashMap::new();

    // Cache compiled regexes per scan — building them is non-trivial
    // and we hit them once per file. Static OnceLock would also work
    // but per-scan locals keep this module thread-safe without static
    // contention when several scans race.
    let re_wikilink = wikilink_regex();
    let re_mdlink = mdlink_regex();
    let re_inline_tag = inline_tag_regex();

    for entry in WalkDir::new(vault_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_vault_metadata(e.file_name().to_string_lossy().as_ref()))
    {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        if entry.path().extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let abs = entry.path();
        let rel = match abs.strip_prefix(vault_root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        // Read through vault::read so we reuse the existing frontmatter
        // split — keeps a single parser in the codebase.
        let parsed = match vault::read(vault_root, &rel) {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(path = %rel, error = %e, "vault_graph: skip unreadable file");
                continue;
            }
        };

        let body = if parsed.content.len() > MAX_BODY_BYTES {
            parsed.content[..MAX_BODY_BYTES].to_string()
        } else {
            parsed.content
        };

        let title = read_string_scalar(&parsed.frontmatter, "title");
        let tags_fm = read_string_list(&parsed.frontmatter, "tags");
        let aliases = read_string_list(&parsed.frontmatter, "aliases");
        let starred = read_bool_scalar(&parsed.frontmatter, "starred");

        let mut tags = tags_fm;
        for cap in re_inline_tag.captures_iter(&body) {
            if let Some(m) = cap.get(1) {
                tags.push(m.as_str().to_string());
            }
        }
        tags.sort();
        tags.dedup();

        let stem = file_stem(&rel);
        by_stem.entry(stem.clone()).or_default().push(rel.clone());
        for alias in &aliases {
            by_alias.insert(alias.clone(), rel.clone());
        }

        nodes.insert(
            rel.clone(),
            NodeInfo {
                path: rel.clone(),
                title,
                tags,
                aliases,
                starred,
                outlinks: Vec::new(),
                broken: Vec::new(),
            },
        );
        bodies.insert(rel, body);
    }

    // Second pass — now that every node is registered, resolve each
    // outlink. Resolution order: alias index → stem index → markdown
    // relative path lookup. Unresolved targets land in `broken`.
    let keys: Vec<String> = nodes.keys().cloned().collect();
    for key in keys {
        let body = match bodies.get(&key) {
            Some(b) => b.clone(),
            None => continue,
        };

        let mut outlinks: Vec<String> = Vec::new();
        let mut broken: Vec<String> = Vec::new();

        for cap in re_wikilink.captures_iter(&body) {
            let raw = cap.get(1).map(|m| m.as_str().trim()).unwrap_or("");
            if raw.is_empty() {
                continue;
            }
            match resolve_wikilink(raw, &by_alias, &by_stem) {
                Some(p) if p != key => outlinks.push(p),
                Some(_) => {} // self-link, ignore
                None => broken.push(raw.to_string()),
            }
        }
        for cap in re_mdlink.captures_iter(&body) {
            let raw = cap.get(2).map(|m| m.as_str().trim()).unwrap_or("");
            if raw.is_empty() || raw.starts_with("http://") || raw.starts_with("https://") {
                continue;
            }
            match resolve_relative_path(raw, &key, &nodes) {
                Some(p) if p != key => outlinks.push(p),
                Some(_) => {}
                None => broken.push(raw.to_string()),
            }
        }
        outlinks.sort();
        outlinks.dedup();
        broken.sort();
        broken.dedup();

        if let Some(node) = nodes.get_mut(&key) {
            node.outlinks = outlinks;
            node.broken = broken;
        }
    }

    Ok(VaultGraph {
        nodes,
        bodies,
        by_stem,
        by_alias,
    })
}

impl VaultGraph {
    /// Backlinks of `path` — every node that links to it, with a short
    /// snippet around the link site for UI preview.
    pub fn backlinks_of(&self, path: &str) -> Vec<BacklinkHit> {
        let mut hits: Vec<BacklinkHit> = Vec::new();
        let stem = file_stem(path);
        let re_wiki = wikilink_regex();
        let re_md = mdlink_regex();
        for (from, node) in &self.nodes {
            if from == path {
                continue;
            }
            if !node.outlinks.iter().any(|o| o == path) {
                continue;
            }
            let body = self.bodies.get(from).cloned().unwrap_or_default();
            let snippet = snippet_around_link(&body, path, &stem, re_wiki, re_md);
            hits.push(BacklinkHit {
                from: from.clone(),
                snippet,
            });
        }
        hits.sort_by(|a, b| a.from.cmp(&b.from));
        hits
    }

    pub fn tags(&self) -> Vec<TagCount> {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for node in self.nodes.values() {
            for t in &node.tags {
                *counts.entry(t.clone()).or_insert(0) += 1;
            }
        }
        let mut out: Vec<TagCount> = counts
            .into_iter()
            .map(|(tag, count)| TagCount { tag, count })
            .collect();
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.tag.cmp(&b.tag)));
        out
    }

    pub fn notes_by_tag(&self, tag: &str) -> Vec<String> {
        let mut hits: Vec<String> = self
            .nodes
            .iter()
            .filter(|(_, n)| n.tags.iter().any(|t| t == tag))
            .map(|(p, _)| p.clone())
            .collect();
        hits.sort();
        hits
    }

    /// Unlinked mentions — substring match across body, excluding
    /// matches that already have a wikilink/md-link wrapper. UI lifts
    /// these into "you mentioned X but didn't link to it".
    pub fn mentions_of(&self, text: &str) -> Vec<MentionHit> {
        let needle = text.trim();
        if needle.is_empty() {
            return Vec::new();
        }
        let mut hits: Vec<MentionHit> = Vec::new();
        for (path, body) in &self.bodies {
            if let Some(idx) = body.find(needle) {
                // Skip if surrounded by `[[ ]]` (real link) — let
                // backlinks_of cover those.
                if surrounded_by_wikilink(body, idx, needle.len()) {
                    continue;
                }
                hits.push(MentionHit {
                    path: path.clone(),
                    snippet: snippet_around_offset(body, idx, needle.len()),
                });
            }
        }
        hits.sort_by(|a, b| a.path.cmp(&b.path));
        hits
    }

    pub fn orphans(&self) -> Vec<String> {
        let mut linked: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for node in self.nodes.values() {
            for o in &node.outlinks {
                linked.insert(o);
            }
        }
        let mut out: Vec<String> = self
            .nodes
            .keys()
            .filter(|p| !linked.contains(p.as_str()))
            .cloned()
            .collect();
        out.sort();
        out
    }

    pub fn broken_links(&self) -> Vec<BrokenLink> {
        let mut out: Vec<BrokenLink> = Vec::new();
        for (from, node) in &self.nodes {
            for target in &node.broken {
                out.push(BrokenLink {
                    from: from.clone(),
                    target: target.clone(),
                });
            }
        }
        out.sort_by(|a, b| a.from.cmp(&b.from).then_with(|| a.target.cmp(&b.target)));
        out
    }

    pub fn graph_data(&self) -> GraphData {
        let mut nodes: Vec<String> = self.nodes.keys().cloned().collect();
        nodes.sort();
        let mut edges: Vec<GraphEdge> = Vec::new();
        for (from, node) in &self.nodes {
            for to in &node.outlinks {
                edges.push(GraphEdge {
                    from: from.clone(),
                    to: to.clone(),
                });
            }
        }
        edges.sort_by(|a, b| a.from.cmp(&b.from).then_with(|| a.to.cmp(&b.to)));
        GraphData { nodes, edges }
    }

    pub fn aliases_of(&self, path: &str) -> Vec<String> {
        self.nodes
            .get(path)
            .map(|n| n.aliases.clone())
            .unwrap_or_default()
    }
}

// ---------- frontmatter helpers ----------

fn read_string_scalar(fm: &serde_json::Value, key: &str) -> Option<String> {
    fm.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn read_bool_scalar(fm: &serde_json::Value, key: &str) -> bool {
    fm.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

fn read_string_list(fm: &serde_json::Value, key: &str) -> Vec<String> {
    fm.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

// ---------- link parsing ----------

/// `[[stem]]` or `[[Folder/Sub]]` or `[[note|Display Text]]`.
/// Capture group 1 = target (display text after `|` discarded).
///
/// Returns a borrowed `&'static Regex` — the previous draft cloned
/// the value out of `OnceLock`, reallocating the compiled NFA on
/// every call and defeating the point of memoisation.
fn wikilink_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\|\]\n]+)(?:\|[^\]]+)?\]\]").expect("wikilink regex"))
}

/// `[label](relative/path.md)` — only relative targets (no scheme).
fn mdlink_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[([^\]\n]+)\]\(([^)\n]+)\)").expect("mdlink regex"))
}

/// `#tag` (alphanum + `/` + `-`). Anchored at start-of-string or
/// whitespace to avoid eating `#anchor` in URLs.
fn inline_tag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|\s)#([A-Za-z0-9][A-Za-z0-9/_-]*)").expect("tag regex"))
}

fn resolve_wikilink(
    target: &str,
    by_alias: &HashMap<String, String>,
    by_stem: &HashMap<String, Vec<String>>,
) -> Option<String> {
    if let Some(p) = by_alias.get(target) {
        return Some(p.clone());
    }
    let stem = last_segment(target);
    if let Some(paths) = by_stem.get(stem) {
        // Prefer a path that ends with `<target>.md` (handles
        // `[[Folder/Sub]]` style — same stem could exist in multiple
        // folders, we pick the one whose suffix matches).
        if target.contains('/') {
            let suffix = format!("{target}.md");
            if let Some(p) = paths.iter().find(|p| p.ends_with(&suffix)) {
                return Some(p.clone());
            }
        }
        if let Some(p) = paths.first() {
            return Some(p.clone());
        }
    }
    None
}

fn resolve_relative_path(
    raw: &str,
    from: &str,
    nodes: &HashMap<String, NodeInfo>,
) -> Option<String> {
    if nodes.contains_key(raw) {
        return Some(raw.to_string());
    }
    let from_dir = std::path::Path::new(from).parent();
    if let Some(dir) = from_dir {
        let candidate = dir.join(raw).to_string_lossy().replace('\\', "/");
        if nodes.contains_key(&candidate) {
            return Some(candidate);
        }
    }
    None
}

// ---------- snippet helpers ----------

fn snippet_around_link(
    body: &str,
    target_path: &str,
    target_stem: &str,
    re_wiki: &Regex,
    re_md: &Regex,
) -> String {
    if let Some(m) = re_wiki.captures_iter(body).find(|c| {
        c.get(1)
            .map(|m| m.as_str().trim())
            .map(|t| t == target_stem || t.ends_with(target_stem))
            .unwrap_or(false)
    }) {
        if let Some(full) = m.get(0) {
            return snippet_around_offset(body, full.start(), full.len());
        }
    }
    if let Some(m) = re_md.captures_iter(body).find(|c| {
        c.get(2)
            .map(|m| m.as_str().trim() == target_path)
            .unwrap_or(false)
    }) {
        if let Some(full) = m.get(0) {
            return snippet_around_offset(body, full.start(), full.len());
        }
    }
    String::new()
}

/// Slice a body around `idx..idx+hit_len`, snapped outward to the
/// nearest valid UTF-8 char boundary. The previous draft tried to
/// loop with `is_char_boundary` inside a `while` body that always
/// returned on the first iteration — that loop never actually
/// advanced, so multibyte chars at the snippet edge could land in
/// a panic on `&body[start..end]`. Snap exactly once, in both
/// directions, then slice safely.
///
/// `str::floor_char_boundary` / `ceil_char_boundary` would be the
/// idiomatic API but they remain unstable as of Rust 1.83 — manual
/// walk via `is_char_boundary` is the stable-Rust equivalent.
fn snippet_around_offset(body: &str, idx: usize, hit_len: usize) -> String {
    let raw_start = idx.saturating_sub(BACKLINK_SNIPPET_RADIUS);
    let raw_end = (idx + hit_len + BACKLINK_SNIPPET_RADIUS).min(body.len());
    let start = (0..=raw_start)
        .rev()
        .find(|i| body.is_char_boundary(*i))
        .unwrap_or(0);
    let end = (raw_end..=body.len())
        .find(|i| body.is_char_boundary(*i))
        .unwrap_or(body.len());
    body[start..end].replace('\n', " ").trim().to_string()
}

/// True only when `idx..idx+needle_len` sits between `[[` and `]]`
/// with nothing else in between — i.e. the substring really is the
/// target of a wikilink, not just text that happens to live in a
/// note that also contains an unrelated wikilink elsewhere.
fn surrounded_by_wikilink(body: &str, idx: usize, needle_len: usize) -> bool {
    let before_slice = &body[..idx];
    let Some(before) = before_slice.rfind("[[") else {
        return false;
    };
    let after_offset = idx + needle_len;
    if after_offset > body.len() {
        return false;
    }
    let after_slice = &body[after_offset..];
    let Some(after) = after_slice.find("]]") else {
        return false;
    };
    let between_before = &before_slice[before + 2..];
    if between_before.contains("[[") || between_before.contains("]]") {
        return false;
    }
    let between_after = &after_slice[..after];
    if between_after.contains("[[") || between_after.contains("]]") {
        return false;
    }
    true
}

fn file_stem(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rfind('.') {
        Some(i) if i > 0 => name[..i].to_string(),
        _ => name.to_string(),
    }
}

/// resolve_wikilink uses the rightmost path segment as the stem. We
/// use `rsplit().next()` here rather than `split().next_back()` for
/// documented semantics — `next_back()` on an iterator created from
/// `split` interacts subtly with empty trailing separators.
fn last_segment(target: &str) -> &str {
    target.rsplit('/').next().unwrap_or(target)
}

/// Skip the `.ctrl/` and `.git/` directories during walk so internal
/// state never lands in the graph. `vault/.ctrl/` is locked-private per
/// ADR-002 § vault v1 §8.2 — same model as `.obsidian/`.
fn is_vault_metadata(name: &str) -> bool {
    name == ".ctrl" || name == ".git" || name == "node_modules"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_md(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, body).unwrap();
    }

    #[test]
    fn backlinks_picks_up_wikilink() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_md(root, "notes/alpha.md", "---\ntitle: Alpha\n---\n\nlink to [[beta]] here\n");
        write_md(root, "notes/beta.md", "---\ntitle: Beta\n---\n\nplain\n");
        let g = scan(root).unwrap();
        let hits = g.backlinks_of("notes/beta.md");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].from, "notes/alpha.md");
    }

    #[test]
    fn orphan_has_no_inbound() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_md(root, "notes/lonely.md", "---\n---\n\nbody\n");
        write_md(root, "notes/a.md", "---\n---\n\n[[b]]\n");
        write_md(root, "notes/b.md", "---\n---\n\nbody\n");
        let g = scan(root).unwrap();
        let orphans = g.orphans();
        assert!(orphans.contains(&"notes/lonely.md".to_string()));
        assert!(!orphans.contains(&"notes/b.md".to_string()));
    }

    #[test]
    fn broken_link_recorded() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_md(root, "notes/a.md", "---\n---\n\n[[ghost]]\n");
        let g = scan(root).unwrap();
        let broken = g.broken_links();
        assert_eq!(broken.len(), 1);
        assert_eq!(broken[0].from, "notes/a.md");
        assert_eq!(broken[0].target, "ghost");
    }

    #[test]
    fn tags_from_frontmatter_and_inline() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_md(root, "notes/a.md", "---\ntags: [project, work]\n---\n\nsome #idea here\n");
        let g = scan(root).unwrap();
        let by_tag = g.notes_by_tag("idea");
        assert_eq!(by_tag, vec!["notes/a.md"]);
        let counts = g.tags();
        assert!(counts.iter().any(|c| c.tag == "project"));
        assert!(counts.iter().any(|c| c.tag == "idea"));
    }

    #[test]
    fn alias_resolves_wikilink() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_md(root, "notes/canonical.md", "---\naliases: [\"Old Name\"]\n---\n\nbody\n");
        write_md(root, "notes/other.md", "---\n---\n\nsee [[Old Name]] for context\n");
        let g = scan(root).unwrap();
        let hits = g.backlinks_of("notes/canonical.md");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].from, "notes/other.md");
    }

    #[test]
    fn skips_dot_ctrl_directory() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_md(root, ".ctrl/sourcing-prompt.md", "---\n---\n\nshould not be indexed\n");
        write_md(root, "notes/a.md", "---\n---\n\nbody\n");
        let g = scan(root).unwrap();
        assert!(!g.nodes.contains_key(".ctrl/sourcing-prompt.md"));
        assert!(g.nodes.contains_key("notes/a.md"));
    }

    #[test]
    fn mentions_finds_unlinked_substring() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_md(root, "notes/a.md", "---\n---\n\nThe Foo concept is important.\n");
        write_md(root, "notes/b.md", "---\n---\n\nA [[Foo]] linked one.\n");
        let g = scan(root).unwrap();
        let hits = g.mentions_of("Foo");
        // a.md mentions Foo unlinked; b.md has [[Foo]] (excluded).
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "notes/a.md");
    }

    #[test]
    fn graph_data_serializes_edges() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        write_md(root, "a.md", "---\n---\n\n[[b]]\n");
        write_md(root, "b.md", "---\n---\n\n[[c]]\n");
        write_md(root, "c.md", "---\n---\n\nbody\n");
        let g = scan(root).unwrap();
        let data = g.graph_data();
        assert_eq!(data.nodes.len(), 3);
        assert_eq!(data.edges.len(), 2);
        let edge_strs: Vec<String> =
            data.edges.iter().map(|e| format!("{}→{}", e.from, e.to)).collect();
        assert!(edge_strs.contains(&"a.md→b.md".to_string()));
        assert!(edge_strs.contains(&"b.md→c.md".to_string()));
    }
}
