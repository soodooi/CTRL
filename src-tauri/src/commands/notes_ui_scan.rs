// list_vault scan — CTRL-OWN implementation of the vendored notes frontend's
// vault-entry contract (ADR-002 substrate §1.9 v47 F2; ADR-006 §5.1.1
// containment: upstream Rust is NOT vendored — this file implements the same
// COMMAND CONTRACT, shapes verified against the pinned upstream commit).
//
// The UI's whole data model rides on this scan: types-as-lenses (`type:` fm),
// relationships (any fm key whose value carries `[[wikilinks]]`), favorites,
// snippets, word counts, outgoing links. Values it derives are all plain
// frontmatter + body facts — the vim test holds.

use crate::kernel::vault;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiVaultEntry {
    /// ABSOLUTE path (upstream contract).
    pub path: String,
    pub filename: String,
    pub title: String,
    pub is_a: Option<String>,
    pub aliases: Vec<String>,
    pub belongs_to: Vec<String>,
    pub related_to: Vec<String>,
    pub status: Option<String>,
    pub archived: bool,
    pub modified_at: Option<u64>,
    pub created_at: Option<u64>,
    pub file_size: u64,
    pub snippet: String,
    pub relationships: HashMap<String, Vec<String>>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub order: Option<i64>,
    pub sidebar_label: Option<String>,
    pub template: Option<String>,
    pub sort: Option<String>,
    pub view: Option<String>,
    pub note_width: Option<String>,
    pub display: Option<String>,
    pub visible: Option<bool>,
    pub organized: bool,
    pub favorite: bool,
    pub favorite_index: Option<i64>,
    pub word_count: u32,
    pub outgoing_links: Vec<String>,
    pub properties: HashMap<String, serde_json::Value>,
    pub list_properties_display: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct UiFolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<UiFolderNode>,
}

/// First string of a frontmatter value that may be a scalar or a list
/// (upstream StringOrList semantics).
fn first_string(v: Option<&serde_json::Value>) -> Option<String> {
    match v? {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Array(a) => {
            a.iter().find_map(|x| x.as_str().map(str::to_string))
        }
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn all_strings(v: Option<&serde_json::Value>) -> Vec<String> {
    match v {
        Some(serde_json::Value::String(s)) => vec![s.clone()],
        Some(serde_json::Value::Array(a)) => {
            a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()
        }
        _ => Vec::new(),
    }
}

fn bool_ish(v: Option<&serde_json::Value>) -> Option<bool> {
    match v? {
        serde_json::Value::Bool(b) => Some(*b),
        serde_json::Value::String(s) => match s.to_lowercase().as_str() {
            "true" | "yes" => Some(true),
            "false" | "no" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Fetch a frontmatter key by its upstream name + aliases.
fn fm_get<'a>(
    fm: &'a serde_json::Value,
    names: &[&str],
) -> Option<&'a serde_json::Value> {
    names.iter().find_map(|n| fm.get(n))
}

/// `[[target]]` / `[[target|display]]` / `[[target#heading]]` targets in text.
fn wikilink_targets(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("[[") {
        rest = &rest[at + 2..];
        let Some(end) = rest.find("]]") else { break };
        let inner = &rest[..end];
        let target = inner.split(['|', '#']).next().unwrap_or("").trim();
        if !target.is_empty() {
            out.push(target.to_string());
        }
        rest = &rest[end + 2..];
    }
    out
}

fn value_wikilinks(v: &serde_json::Value) -> Vec<String> {
    match v {
        serde_json::Value::String(s) => wikilink_targets(s),
        serde_json::Value::Array(a) => a.iter().flat_map(value_wikilinks).collect(),
        _ => Vec::new(),
    }
}

/// Keys the structural fields consume — everything else becomes either a
/// relationship (has wikilinks) or a plain property (scalar/scalar-array).
const STRUCTURAL: &[&str] = &[
    "title", "type", "Is A", "is_a", "aliases", "_archived", "Archived", "archived",
    "Status", "status", "_icon", "icon", "color", "_order", "order", "_sidebar_label",
    "sidebar label", "sidebar_label", "template", "_sort", "sort", "view", "_width",
    "width", "_display", "visible", "_organized", "_favorite", "_favorite_index",
    "_list_properties_display",
];

/// Build one UI entry from a note's parsed frontmatter + body + fs metadata.
pub fn entry_for(root: &Path, rel: &str, fm: &serde_json::Value, body: &str) -> UiVaultEntry {
    let full = root.join(rel);
    let meta = std::fs::metadata(&full).ok();
    let mtime = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    let ctime = meta
        .as_ref()
        .and_then(|m| m.created().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);

    let filename = Path::new(rel)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let stem = Path::new(rel)
        .file_stem()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();

    // Body-derived facts: first H1 title, snippet, word count, links.
    let h1 = body
        .lines()
        .find(|l| l.trim_start().starts_with("# "))
        .map(|l| l.trim_start().trim_start_matches("# ").trim().to_string());
    let title = first_string(fm_get(fm, &["title"]))
        .or(h1.clone())
        .unwrap_or(stem);
    let body_no_title: String = body
        .lines()
        .filter(|l| Some(l.trim_start().trim_start_matches("# ").trim().to_string()) != h1.clone() || !l.trim_start().starts_with("# "))
        .collect::<Vec<_>>()
        .join("\n");
    let snippet: String = body_no_title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(200)
        .collect();
    let word_count = body_no_title.split_whitespace().count() as u32;

    // Relationships: every non-structural fm key whose value carries wikilinks.
    let mut relationships: HashMap<String, Vec<String>> = HashMap::new();
    let mut properties: HashMap<String, serde_json::Value> = HashMap::new();
    if let Some(obj) = fm.as_object() {
        for (k, v) in obj {
            if STRUCTURAL.contains(&k.as_str()) {
                continue;
            }
            let links = value_wikilinks(v);
            if !links.is_empty() {
                relationships.insert(k.clone(), links);
            } else if v.is_string() || v.is_number() || v.is_boolean() || v.is_array() {
                properties.insert(k.clone(), v.clone());
            }
        }
    }
    let belongs_to = relationships
        .get("Belongs To")
        .or_else(|| relationships.get("belongs_to"))
        .cloned()
        .unwrap_or_default();
    let related_to = relationships
        .get("Related To")
        .or_else(|| relationships.get("related_to"))
        .cloned()
        .unwrap_or_default();

    UiVaultEntry {
        path: full.to_string_lossy().to_string(),
        filename,
        title,
        is_a: first_string(fm_get(fm, &["type", "Is A", "is_a"])),
        aliases: all_strings(fm_get(fm, &["aliases"])),
        belongs_to,
        related_to,
        status: first_string(fm_get(fm, &["Status", "status"])),
        archived: bool_ish(fm_get(fm, &["_archived", "Archived", "archived"])).unwrap_or(false),
        modified_at: mtime,
        created_at: ctime,
        file_size: meta.map(|m| m.len()).unwrap_or(0),
        snippet,
        relationships,
        icon: first_string(fm_get(fm, &["_icon", "icon"])),
        color: first_string(fm_get(fm, &["color"])),
        order: fm_get(fm, &["_order", "order"]).and_then(|v| v.as_i64()),
        sidebar_label: first_string(fm_get(fm, &["_sidebar_label", "sidebar label", "sidebar_label"])),
        template: first_string(fm_get(fm, &["template"])),
        sort: first_string(fm_get(fm, &["_sort", "sort"])),
        view: first_string(fm_get(fm, &["view"])),
        note_width: first_string(fm_get(fm, &["_width", "width"])),
        display: first_string(fm_get(fm, &["_display"])),
        visible: bool_ish(fm_get(fm, &["visible"])),
        organized: bool_ish(fm_get(fm, &["_organized"])).unwrap_or(false),
        favorite: bool_ish(fm_get(fm, &["_favorite"])).unwrap_or(false),
        favorite_index: fm_get(fm, &["_favorite_index"]).and_then(|v| v.as_i64()),
        word_count,
        outgoing_links: wikilink_targets(&body_no_title),
        properties,
        list_properties_display: all_strings(fm_get(fm, &["_list_properties_display"])),
    }
}

/// Scan every visible note into UI entries. `_path` is the upstream vault-path
/// argument; single-vault v1 always scans the CTRL root.
#[tauri::command]
pub async fn list_vault(path: std::path::PathBuf) -> Result<Vec<UiVaultEntry>, String> {
    let _ = path;
    tokio::task::spawn_blocking(scan_all).await.map_err(|e| format!("scan panicked: {e}"))?
}

/// Upstream's force-reload variant — same scan (CTRL has no scan cache yet).
#[tauri::command]
pub async fn reload_vault(path: std::path::PathBuf) -> Result<Vec<UiVaultEntry>, String> {
    list_vault(path).await
}

fn scan_all() -> Result<Vec<UiVaultEntry>, String> {
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    let rels = vault::list(&root, None).map_err(|e| format!("{e:?}"))?;
    let mut out = Vec::with_capacity(rels.len());
    for rel in rels {
        let Ok(entry) = vault::read(&root, &rel) else { continue };
        out.push(entry_for(&root, &rel, &entry.frontmatter, &entry.content));
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_vault_folders(path: std::path::PathBuf) -> Result<Vec<UiFolderNode>, String> {
    let _ = path;
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    Ok(folder_tree(&root, ""))
}

fn folder_tree(root: &Path, rel: &str) -> Vec<UiFolderNode> {
    let dir = if rel.is_empty() { root.to_path_buf() } else { root.join(rel) };
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut out: Vec<UiFolderNode> = entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                return None;
            }
            let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            Some(UiFolderNode {
                name,
                path: child_rel.clone(),
                children: folder_tree(root, &child_rel),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
pub fn check_vault_exists(path: std::path::PathBuf) -> Result<bool, String> {
    let _ = path;
    Ok(vault::default_vault_root().map(|r| r.is_dir()).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_derives_types_relationships_and_body_facts() {
        let fm = serde_json::json!({
            "type": "Project",
            "aliases": ["proj-x"],
            "Status": "active",
            "Belongs To": "[[Acme Corp]]",
            "Topics": ["[[rust]]", "[[notes]]"],
            "priority": 3,
            "_favorite": true,
        });
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("n.md"), "x").unwrap();
        let e = entry_for(
            dir.path(),
            "n.md",
            &fm,
            "# Project X\n\nBody text with a [[link-target|label]] inside.\n",
        );
        assert_eq!(e.title, "Project X");
        assert_eq!(e.is_a.as_deref(), Some("Project"));
        assert_eq!(e.aliases, vec!["proj-x"]);
        assert_eq!(e.status.as_deref(), Some("active"));
        assert_eq!(e.belongs_to, vec!["Acme Corp"]);
        assert_eq!(e.relationships["Topics"], vec!["rust", "notes"]);
        assert!(e.favorite);
        assert_eq!(e.properties["priority"], 3);
        assert!(!e.properties.contains_key("Belongs To"), "relationship, not property");
        assert_eq!(e.outgoing_links, vec!["link-target"]);
        assert!(e.word_count > 0);
        assert!(e.snippet.contains("Body text"));
    }

    #[test]
    fn wikilink_targets_handle_alias_and_heading_forms() {
        assert_eq!(
            wikilink_targets("[[a]] [[b|label]] [[c#h]] [[  ]] not [[unclosed"),
            vec!["a", "b", "c"]
        );
    }
}
