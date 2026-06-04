// Vault — local-first markdown + frontmatter store, Obsidian-compatible.
//
// Per CLAUDE.md `## Design Philosophy` (Obsidian philosophy section):
//   - Data belongs to the user. Vault is plain markdown + YAML frontmatter
//     on the filesystem; vim / Obsidian / any text editor can read it.
//   - Local is truth, cloud is mirror — never the other way around.
//   - No proprietary binary format; CTRL never claims ownership of vault
//     content.
//
// Layout policy is user-decided. CTRL ships a sane default (by-day for
// time-series content, flat for entity-named content) but a user can
// point the kernel at their existing Obsidian vault, change the layout
// policy, or write arbitrary path hints from a keycap.
//
// The kernel module owns IO only — capability-level surface (which keycap
// can read/write which paths) lives in `kernel::capability`; PWA-facing
// Tauri commands wrap this module and apply capability checks.

use crate::kernel::vault_index;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Lazy global FTS5 index. Initialized on first vault operation (or
/// first search). Production code goes through this; tests skip
/// index touches via the cfg(not(test)) gates below so concurrent
/// test threads don't pollute the user's real index db.
static GLOBAL_INDEX: OnceLock<Option<vault_index::VaultIndex>> = OnceLock::new();

#[allow(dead_code)] // gated by cfg(not(test)); compiler can't see runtime use under test cfg
fn try_global_index() -> Option<&'static vault_index::VaultIndex> {
    GLOBAL_INDEX
        .get_or_init(|| {
            let path = std::env::var("CTRL_VAULT_INDEX_PATH")
                .ok()
                .map(PathBuf::from)
                .or_else(vault_index::default_index_path)?;
            match vault_index::VaultIndex::open(&path) {
                Ok(idx) => Some(idx),
                Err(e) => {
                    tracing::warn!(?path, error = %e, "vault: index unavailable, falling back to scan");
                    None
                }
            }
        })
        .as_ref()
}

/// Default vault path: `$HOME/Documents/CTRL`. Plain-text philosophy + invariant
/// #2 (vault = sibling structure visible to Finder / vim / VMark / Obsidian
/// without dotfile burying). Users may override via `~/.ctrl/config.toml`'s
/// `[vault] path = "..."` to point at an existing markdown vault. Returns
/// None when HOME isn't set (CI env).
///
/// Migration: if the legacy `~/.ctrl/vault/` exists and the new default does
/// not, call `migrate_legacy_vault()` to move it. ensure_vault_layout() also
/// creates the canonical sibling structure (`notes/`, `assets/{images,audio,
/// pdf,attachments}/`) on first boot.
pub fn default_vault_root() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join("Documents").join("CTRL"))
}

/// Legacy vault path (pre-0.1.37). Migration source only.
pub fn legacy_vault_root() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("vault"))
}

/// Ensure the vault directory exists with the canonical sibling layout per
/// ADR-001 spine amendment 2026-05-25 invariant #2 (vault sibling structure). Also
/// migrates legacy `~/.ctrl/vault/` content forward when present.
///
/// Called at kernel boot via vault_index init. Idempotent — already-existing
/// dirs are left untouched; only missing pieces are created.
pub fn ensure_vault_layout(root: &Path) -> std::io::Result<()> {
    // Migration: if the new root doesn't exist but the legacy ~/.ctrl/vault/
    // does, move it. Best-effort — on failure we log and continue with a
    // fresh empty new root.
    if !root.exists() {
        if let Some(legacy) = legacy_vault_root() {
            if legacy.exists() && legacy != root {
                if let Some(parent) = root.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::rename(&legacy, root) {
                    Ok(_) => {
                        tracing::info!(?legacy, ?root, "vault: migrated legacy ~/.ctrl/vault/");
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, ?legacy, ?root, "vault: migration failed, starting fresh");
                    }
                }
            }
        }
    }

    // Canonical structure — notes/ + assets/{images,audio,pdf,attachments}/.
    let _ = std::fs::create_dir_all(root.join("notes"));
    for sub in ["images", "audio", "pdf", "attachments"] {
        let _ = std::fs::create_dir_all(root.join("assets").join(sub));
    }
    // ADR-002 substrate § vault v1 §8.2 + §8.4 (2026-06-01, memory
    // `decision_vault_adr_002_section_8`) — feature-layer scaffolding.
    // `.ctrl/` mirrors Obsidian's `.obsidian/` (hidden config namespace);
    // `templates/` is plain-text user-forkable seeds. Each file is only
    // written when absent so re-launch never clobbers user edits.
    seed_vault_feature_layer(root);
    Ok(())
}

const SEED_SOURCING_YAML: &str = include_str!("vault_seed/sourcing.yaml");
const SEED_DAILY_NOTES_YAML: &str = include_str!("vault_seed/daily-notes.yaml");
const SEED_SOURCING_PROMPT: &str = include_str!("vault_seed/sourcing-prompt.md");
const SEED_TEMPLATE_DAILY: &str = include_str!("vault_seed/template-daily.md");
const SEED_TEMPLATE_MEETING: &str = include_str!("vault_seed/template-meeting.md");
const SEED_IRISY_SOUL: &str = include_str!("vault_seed/irisy-soul.md");
// ADR-005 irisy v4 §5 (2026-06-04) — sleep-time reflection subagent.
// Reflection prompt seeds the reflect subagent's system message;
// playbook seeds the procedural-memory file the main Irisy turn reads.
const SEED_IRISY_REFLECT_PROMPT: &str = include_str!("vault_seed/irisy-reflect-prompt.md");
const SEED_IRISY_PLAYBOOK: &str = include_str!("vault_seed/irisy-playbook.md");

/// SOUL.md spec version pin (ADR-005 § soul-md-compat §4.6 churn policy).
/// Bumped when CTRL adopts a newer upstream `aaronjmars/soul.md` revision.
const SOUL_MD_VERSION: &str = "soul-md-v1.0.0 (2026-06-03)";

fn seed_vault_feature_layer(root: &Path) {
    let _ = std::fs::create_dir_all(root.join(".ctrl"));
    let _ = std::fs::create_dir_all(root.join(".ctrl").join("review-queue"));
    let _ = std::fs::create_dir_all(root.join("sourcing"));
    let _ = std::fs::create_dir_all(root.join("daily"));
    let _ = std::fs::create_dir_all(root.join("templates"));
    // ADR-005 irisy v2 § soul-md-compat (2026-06-03, memory
    // `decision_openclaw_compat_layer`) — Irisy persistent memory.
    let _ = std::fs::create_dir_all(root.join("irisy"));
    let _ = std::fs::create_dir_all(root.join("notes").join("keycap-runs"));
    let _ = std::fs::create_dir_all(root.join("notes").join("keycap-runs").join("archive"));

    write_if_missing(root, ".ctrl/sourcing.yaml", SEED_SOURCING_YAML);
    write_if_missing(root, ".ctrl/daily-notes.yaml", SEED_DAILY_NOTES_YAML);
    write_if_missing(root, ".ctrl/sourcing-prompt.md", SEED_SOURCING_PROMPT);
    write_if_missing(root, "templates/daily.md", SEED_TEMPLATE_DAILY);
    write_if_missing(root, "templates/meeting.md", SEED_TEMPLATE_MEETING);
    write_if_missing(root, "irisy/SOUL.md", SEED_IRISY_SOUL);
    write_if_missing(root, "irisy/.soul-md-version", SOUL_MD_VERSION);
    // ADR-005 irisy v4 §5 — sleep-time reflection subagent files.
    let _ = std::fs::create_dir_all(root.join("irisy").join("episodes"));
    write_if_missing(root, "irisy/reflect-prompt.md", SEED_IRISY_REFLECT_PROMPT);
    write_if_missing(root, "irisy/playbook.md", SEED_IRISY_PLAYBOOK);
}

fn write_if_missing(root: &Path, rel: &str, contents: &str) {
    let full = root.join(rel);
    if full.exists() {
        return;
    }
    if let Some(parent) = full.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&full, contents) {
        tracing::warn!(path = %full.display(), error = %e, "vault: seed write failed");
    } else {
        tracing::info!(path = %rel, "vault: seeded feature-layer file");
    }
}

/// VaultEntry — what callers get back from list / read operations.
/// `path` is relative to the vault root so it's portable across machines.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEntry {
    pub path: String,
    pub frontmatter: serde_json::Value,
    pub content: String,
}

/// Write a markdown file under the vault root with a YAML frontmatter
/// block at the top. Creates parent directories on demand.
///
/// `path_hint` is the relative path the caller suggests (e.g.
/// `messages/2026-05-22/john.md`). The current implementation honors
/// the hint verbatim; a future layout policy engine may rewrite it.
pub fn write(
    vault_root: &Path,
    path_hint: &str,
    content: &str,
    frontmatter: &serde_json::Value,
) -> Result<PathBuf, VaultError> {
    let safe = sanitize_relative_path(path_hint)?;
    let full = vault_root.join(&safe);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| VaultError::Io(e.to_string()))?;
    }

    let yaml = frontmatter_to_yaml(frontmatter)?;
    let body = format!("---\n{yaml}---\n\n{content}");
    fs::write(&full, body).map_err(|e| VaultError::Io(e.to_string()))?;

    // Best-effort index upsert. Failures are logged but never block the
    // write — vault files on disk remain the source of truth and the
    // index can always be rebuilt via vault::rebuild_index.
    #[cfg(not(test))]
    if let Some(idx) = try_global_index() {
        let fm_str = serde_json::to_string(frontmatter).unwrap_or_default();
        let mtime_ms = current_mtime_ms(&full);
        if let Err(e) = idx.upsert(
            &safe.to_string_lossy(),
            content,
            &fm_str,
            mtime_ms,
        ) {
            tracing::warn!(path = %safe.display(), error = %e, "vault: index upsert failed");
        }
    }

    Ok(full)
}

/// Write raw bytes (typically a generated or captured image) to a path
/// under the vault root. Companion `.md` sidecar is written via the
/// regular `write` function so the FTS5 index picks up the metadata
/// frontmatter (prompt / provider / etc.) and users see the image card
/// when browsing the vault in any markdown viewer.
///
/// `path_hint` is the relative path for the binary asset (e.g.
/// `images/2026-05/23-poster-001.png`); caller is responsible for
/// deriving the sidecar path from this (typically swap extension).
/// Returns the resolved absolute path. Parent dirs created on demand.
pub fn write_binary(
    vault_root: &Path,
    path_hint: &str,
    bytes: &[u8],
) -> Result<PathBuf, VaultError> {
    let safe = sanitize_relative_path(path_hint)?;
    let full = vault_root.join(&safe);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| VaultError::Io(e.to_string()))?;
    }
    fs::write(&full, bytes).map_err(|e| VaultError::Io(e.to_string()))?;
    Ok(full)
}

/// Read a vault file and split frontmatter from body content.
pub fn read(vault_root: &Path, rel_path: &str) -> Result<VaultEntry, VaultError> {
    let safe = sanitize_relative_path(rel_path)?;
    let full = vault_root.join(&safe);
    let raw = fs::read_to_string(&full).map_err(|e| VaultError::Io(e.to_string()))?;
    let (frontmatter, body) = split_frontmatter(&raw);
    Ok(VaultEntry {
        path: safe.to_string_lossy().to_string(),
        frontmatter,
        content: body,
    })
}

/// List all `.md` files under the vault root (or a subdirectory),
/// returning relative paths sorted lexicographically.
pub fn list(vault_root: &Path, subdir: Option<&str>) -> Result<Vec<String>, VaultError> {
    let scan_root = match subdir {
        Some(s) => vault_root.join(sanitize_relative_path(s)?),
        None => vault_root.to_path_buf(),
    };
    if !scan_root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    walk_markdown(&scan_root, vault_root, &mut out)?;
    out.sort();
    Ok(out)
}

/// Vault search — tries FTS5 (kernel::vault_index) first, falls back
/// to substring scan if the index is unavailable or empty. The public
/// signature stays stable so existing callers don't break.
///
/// Fallback rationale: per CLAUDE.md design philosophy, the index is a
/// *derivative* of the vault, not the source of truth. A user can rm
/// the index db at any time, or the daemon can boot before the first
/// rebuild_index runs — neither should make search hard-fail.
pub fn search(vault_root: &Path, query: &str, limit: usize) -> Result<Vec<String>, VaultError> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    #[cfg(not(test))]
    if let Some(idx) = try_global_index() {
        match idx.count() {
            Ok(n) if n > 0 => {
                if let Ok(hits) = idx.search(q, limit) {
                    return Ok(hits);
                }
                // Fall through to scan on FTS5 error.
            }
            Ok(_) => {
                // Index empty (never built or was cleared). Trigger
                // async-ish rebuild for next call, return scan results
                // now so the user gets an answer this turn.
                if let Err(e) = rebuild_index_inner(vault_root, idx) {
                    tracing::warn!(error = %e, "vault: lazy rebuild_index failed");
                }
            }
            Err(_) => {
                // Index unhealthy — log + fall through.
                tracing::warn!("vault: index count failed, falling back to scan");
            }
        }
    }

    substring_search_scan(vault_root, q, limit)
}

fn substring_search_scan(
    vault_root: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<String>, VaultError> {
    let paths = list(vault_root, None)?;
    let needle = query.to_lowercase();
    let mut hits: Vec<String> = Vec::new();
    for p in paths {
        let full = vault_root.join(&p);
        let Ok(text) = fs::read_to_string(&full) else {
            continue;
        };
        if text.to_lowercase().contains(&needle) {
            hits.push(p);
            if hits.len() >= limit {
                break;
            }
        }
    }
    Ok(hits)
}

/// Wipe the FTS5 index and rebuild from every `.md` file in the vault.
/// Called manually (Settings UI button) or lazily on first search if
/// the index is empty.
pub fn rebuild_index(vault_root: &Path) -> Result<usize, VaultError> {
    #[cfg(not(test))]
    {
        let idx = try_global_index()
            .ok_or_else(|| VaultError::Io("vault index unavailable (HOME unset?)".to_string()))?;
        return rebuild_index_inner(vault_root, idx);
    }
    #[cfg(test)]
    {
        // Test mode bypasses the global index; caller should use
        // VaultIndex directly for end-to-end index tests.
        let _ = vault_root;
        Ok(0)
    }
}

#[allow(dead_code)] // gated under cfg(not(test))
fn rebuild_index_inner(
    vault_root: &Path,
    idx: &vault_index::VaultIndex,
) -> Result<usize, VaultError> {
    idx.clear()
        .map_err(|e| VaultError::Io(format!("clear index: {e}")))?;
    let paths = list(vault_root, None)?;
    for path in &paths {
        let entry = read(vault_root, path)?;
        let fm_str = serde_json::to_string(&entry.frontmatter).unwrap_or_default();
        let mtime_ms = current_mtime_ms(&vault_root.join(path));
        if let Err(e) = idx.upsert(path, &entry.content, &fm_str, mtime_ms) {
            tracing::warn!(path = %path, error = %e, "vault: rebuild upsert failed");
        }
    }
    Ok(paths.len())
}

#[allow(dead_code)]
fn current_mtime_ms(full_path: &Path) -> i64 {
    std::fs::metadata(full_path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Delete a vault file. Returns Ok even when the file didn't exist —
/// vault semantics match the user's mental model: "after delete, it's
/// gone" is true either way.
pub fn delete(vault_root: &Path, rel_path: &str) -> Result<(), VaultError> {
    let safe = sanitize_relative_path(rel_path)?;
    let full = vault_root.join(&safe);
    match fs::remove_file(&full) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(VaultError::Io(e.to_string())),
    }
    #[cfg(not(test))]
    if let Some(idx) = try_global_index() {
        if let Err(e) = idx.remove(&safe.to_string_lossy()) {
            tracing::warn!(path = %safe.display(), error = %e, "vault: index remove failed");
        }
    }
    Ok(())
}

// ── Internal helpers ─────────────────────────────────────────────────────

fn walk_markdown(
    dir: &Path,
    vault_root: &Path,
    out: &mut Vec<String>,
) -> Result<(), VaultError> {
    let entries = fs::read_dir(dir).map_err(|e| VaultError::Io(e.to_string()))?;
    for entry in entries.flatten() {
        let path = entry.path();
        // Skip dotfiles (e.g. `.ctrl/` / `.obsidian/`) — they're kernel
        // state or Obsidian internals, not user content.
        if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        if path.is_dir() {
            walk_markdown(&path, vault_root, out)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let rel = path
                .strip_prefix(vault_root)
                .map_err(|_| VaultError::PathOutsideVault(path.display().to_string()))?;
            out.push(rel.to_string_lossy().to_string());
        }
    }
    Ok(())
}

/// Reject path traversal (`..`), absolute paths, and Windows drive
/// prefixes. Vault writes must stay inside the vault root no matter
/// what a keycap claims.
pub fn sanitize_relative_path(p: &str) -> Result<PathBuf, VaultError> {
    if p.starts_with('/') || p.starts_with('\\') {
        return Err(VaultError::InvalidPath(format!(
            "leading slash not allowed: {p}"
        )));
    }
    let pb = PathBuf::from(p);
    if pb.is_absolute() {
        return Err(VaultError::InvalidPath(format!(
            "absolute paths not allowed: {p}"
        )));
    }
    for comp in pb.components() {
        use std::path::Component;
        match comp {
            Component::Normal(_) => {}
            Component::CurDir => continue,
            _ => {
                return Err(VaultError::InvalidPath(format!(
                    "path traversal / non-normal component not allowed: {p}"
                )))
            }
        }
    }
    Ok(pb)
}

/// Render a JSON value as a YAML frontmatter block. We avoid an extra
/// crate (serde_yaml) by hand-formatting the cases we actually use
/// (top-level object of scalar / array / nested object values).
fn frontmatter_to_yaml(value: &serde_json::Value) -> Result<String, VaultError> {
    let obj = value.as_object().ok_or_else(|| {
        VaultError::InvalidFrontmatter("frontmatter must be a JSON object".to_string())
    })?;
    let mut out = String::new();
    for (key, val) in obj {
        emit_yaml_pair(&mut out, key, val, 0);
    }
    Ok(out)
}

fn emit_yaml_pair(out: &mut String, key: &str, value: &serde_json::Value, indent: usize) {
    let pad = "  ".repeat(indent);
    match value {
        serde_json::Value::Null => {
            out.push_str(&format!("{pad}{key}: null\n"));
        }
        serde_json::Value::Bool(b) => {
            out.push_str(&format!("{pad}{key}: {b}\n"));
        }
        serde_json::Value::Number(n) => {
            out.push_str(&format!("{pad}{key}: {n}\n"));
        }
        serde_json::Value::String(s) => {
            out.push_str(&format!("{pad}{key}: {}\n", yaml_quote(s)));
        }
        serde_json::Value::Array(items) => {
            out.push_str(&format!("{pad}{key}:\n"));
            for item in items {
                match item {
                    serde_json::Value::String(s) => {
                        out.push_str(&format!("{pad}  - {}\n", yaml_quote(s)));
                    }
                    other => {
                        out.push_str(&format!("{pad}  - {other}\n"));
                    }
                }
            }
        }
        serde_json::Value::Object(nested) => {
            out.push_str(&format!("{pad}{key}:\n"));
            for (k, v) in nested {
                emit_yaml_pair(out, k, v, indent + 1);
            }
        }
    }
}

/// Quote YAML strings only when they contain characters that would
/// otherwise confuse the parser (colons / hashes / leading dashes /
/// newlines). Bare strings stay bare so the file reads naturally in
/// vim / Obsidian.
fn yaml_quote(s: &str) -> String {
    let needs_quote = s.is_empty()
        || s.contains(':')
        || s.contains('#')
        || s.contains('"')
        || s.contains('\n')
        || s.starts_with('-')
        || s.starts_with(' ')
        || s.ends_with(' ');
    if needs_quote {
        let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
        format!("\"{escaped}\"")
    } else {
        s.to_string()
    }
}

/// Split a markdown file into its frontmatter (JSON value) and body.
/// Tolerates absent frontmatter (returns null + raw content).
fn split_frontmatter(raw: &str) -> (serde_json::Value, String) {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---\n") && !trimmed.starts_with("---\r\n") {
        return (serde_json::Value::Null, raw.to_string());
    }
    let after_open = &trimmed[4..];
    let close_pos = after_open.find("\n---");
    let Some(end_idx) = close_pos else {
        return (serde_json::Value::Null, raw.to_string());
    };
    let fm_text = &after_open[..end_idx];
    let body_start = end_idx + 4; // skip "\n---"
    let after_close = &after_open[body_start..];
    let body = after_close
        .trim_start_matches('\n')
        .trim_start_matches('\r')
        .to_string();
    let fm_json = parse_yaml_to_json(fm_text);
    (fm_json, body)
}

/// Tiny YAML → JSON parser covering the shapes we emit + the shapes
/// users hand-write in frontmatter (block-style + flow-style scalar
/// sequences). Anchors / multi-doc / nested mappings remain out of
/// scope. Round-trips `tags: [a, b]` (inline) and:
///
/// ```yaml
/// tags:
///   - a
///   - b
/// ```
///
/// (block) symmetrically.
fn parse_yaml_to_json(yaml: &str) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    let mut list_key: Option<String> = None;
    let mut list_buf: Vec<serde_json::Value> = Vec::new();

    for line in yaml.lines() {
        let raw = line.trim_end();
        if raw.is_empty() || raw.trim_start().starts_with('#') {
            continue;
        }
        // Block-sequence continuation under a previously-opened key.
        let trimmed = raw.trim_start();
        if list_key.is_some() && (raw.starts_with(' ') || raw.starts_with('\t')) {
            if let Some(item) = trimmed.strip_prefix("- ") {
                list_buf.push(parse_yaml_scalar(item.trim()));
                continue;
            }
        }
        // Hit a top-level key — flush any accumulating block list.
        if let Some(k) = list_key.take() {
            obj.insert(k, serde_json::Value::Array(std::mem::take(&mut list_buf)));
        }
        if raw.starts_with(' ') || raw.starts_with('\t') {
            // Nested mapping (unsupported) — skip line.
            continue;
        }
        let Some(colon) = raw.find(':') else { continue };
        let key = raw[..colon].trim().to_string();
        let value_str = raw[colon + 1..].trim();
        if value_str.is_empty() {
            list_key = Some(key);
            list_buf = Vec::new();
            continue;
        }
        if let Some(items) = parse_inline_sequence(value_str) {
            obj.insert(key, serde_json::Value::Array(items));
            continue;
        }
        obj.insert(key, parse_yaml_scalar(value_str));
    }
    if let Some(k) = list_key.take() {
        obj.insert(k, serde_json::Value::Array(list_buf));
    }
    serde_json::Value::Object(obj)
}

/// `[a, "b c", 3]` → Vec of parsed scalars. Returns None when the value
/// isn't an inline flow sequence so the caller can fall back to scalar
/// parsing.
///
/// We distinguish between an empty token (skip — handles trailing
/// comma `[a, b,]`) and a token that parses to JSON null (keep —
/// `[a, ~, b]` must round-trip preserving the explicit null). The
/// earlier draft folded both cases together via `!v.is_null()` and
/// silently dropped legitimate `~` entries.
fn parse_inline_sequence(s: &str) -> Option<Vec<serde_json::Value>> {
    let inner = s.strip_prefix('[')?.strip_suffix(']')?;
    let mut out: Vec<serde_json::Value> = Vec::new();
    let mut buf = String::new();
    let mut in_quote: Option<char> = None;
    let mut push_token = |buf: &mut String, out: &mut Vec<serde_json::Value>| {
        let trimmed = buf.trim();
        if !trimmed.is_empty() {
            out.push(parse_yaml_scalar(trimmed));
        }
        buf.clear();
    };
    for ch in inner.chars() {
        match (in_quote, ch) {
            (Some(q), c) if c == q => {
                in_quote = None;
                buf.push(c);
            }
            (None, c @ ('"' | '\'')) => {
                in_quote = Some(c);
                buf.push(c);
            }
            (None, ',') => push_token(&mut buf, &mut out),
            _ => buf.push(ch),
        }
    }
    push_token(&mut buf, &mut out);
    Some(out)
}

fn parse_yaml_scalar(s: &str) -> serde_json::Value {
    if s.is_empty() {
        return serde_json::Value::Null;
    }
    if let Some(stripped) = s.strip_prefix('"').and_then(|r| r.strip_suffix('"')) {
        return serde_json::Value::String(stripped.replace("\\\"", "\""));
    }
    if let Some(stripped) = s.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')) {
        return serde_json::Value::String(stripped.to_string());
    }
    match s {
        "true" => return serde_json::Value::Bool(true),
        "false" => return serde_json::Value::Bool(false),
        "null" | "~" => return serde_json::Value::Null,
        _ => {}
    }
    if let Ok(n) = s.parse::<i64>() {
        return serde_json::Value::Number(n.into());
    }
    if let Ok(n) = s.parse::<f64>() {
        if let Some(num) = serde_json::Number::from_f64(n) {
            return serde_json::Value::Number(num);
        }
    }
    serde_json::Value::String(s.to_string())
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum VaultError {
    #[error("IO error: {0}")]
    Io(String),
    #[error("invalid vault path: {0}")]
    InvalidPath(String),
    #[error("path escapes vault root: {0}")]
    PathOutsideVault(String),
    #[error("invalid frontmatter: {0}")]
    InvalidFrontmatter(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_tmp(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        p.push(format!("ctrl-vault-test-{label}-{pid}-{nanos}"));
        p
    }

    #[test]
    fn write_then_read_roundtrip() {
        let root = fresh_tmp("rt");
        let fm = serde_json::json!({
            "title": "Hello",
            "type": "note",
            "tags": ["draft", "ctrl"]
        });
        let path = write(&root, "notes/2026-05-22/hello.md", "Body line.\n", &fm)
            .expect("write ok");
        assert!(path.exists());

        let entry = read(&root, "notes/2026-05-22/hello.md").expect("read ok");
        assert_eq!(entry.path, "notes/2026-05-22/hello.md");
        assert_eq!(entry.content.trim(), "Body line.");
        assert_eq!(entry.frontmatter["title"], "Hello");
        assert_eq!(entry.frontmatter["type"], "note");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn sanitize_rejects_traversal() {
        assert!(sanitize_relative_path("../escape.md").is_err());
        assert!(sanitize_relative_path("/abs/path.md").is_err());
        assert!(sanitize_relative_path("a/../b.md").is_err());
        assert!(sanitize_relative_path("ok/nested/path.md").is_ok());
    }

    #[test]
    fn list_skips_dotfiles_and_non_md() {
        let root = fresh_tmp("ls");
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        fs::write(root.join(".obsidian/config"), b"x").unwrap();
        write(&root, "a.md", "a", &serde_json::json!({})).unwrap();
        write(&root, "sub/b.md", "b", &serde_json::json!({})).unwrap();
        fs::write(root.join("ignored.txt"), b"x").unwrap();

        let entries = list(&root, None).expect("list");
        assert_eq!(entries.len(), 2);
        assert!(entries.contains(&"a.md".to_string()));
        assert!(entries.contains(&"sub/b.md".to_string()));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn search_finds_substring_case_insensitive() {
        let root = fresh_tmp("se");
        write(&root, "one.md", "Hello WORLD", &serde_json::json!({})).unwrap();
        write(&root, "two.md", "nothing here", &serde_json::json!({})).unwrap();
        let hits = search(&root, "world", 10).expect("search");
        assert_eq!(hits, vec!["one.md".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn yaml_quote_only_when_needed() {
        assert_eq!(yaml_quote("plain"), "plain");
        assert_eq!(yaml_quote("has: colon"), "\"has: colon\"");
        assert_eq!(yaml_quote(""), "\"\"");
        assert_eq!(yaml_quote("#hash"), "\"#hash\"");
        assert_eq!(yaml_quote("with \"quote\""), "\"with \\\"quote\\\"\"");
    }

    #[test]
    fn split_frontmatter_handles_absent_block() {
        let (fm, body) = split_frontmatter("no frontmatter here\nsecond line");
        assert!(fm.is_null());
        assert!(body.starts_with("no frontmatter"));
    }

    #[test]
    fn delete_is_idempotent() {
        let root = fresh_tmp("del");
        write(&root, "x.md", "x", &serde_json::json!({})).unwrap();
        delete(&root, "x.md").expect("first delete");
        delete(&root, "x.md").expect("second delete (idempotent)");
        let _ = fs::remove_dir_all(&root);
    }
}
