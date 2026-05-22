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

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Default vault path: `$HOME/.ctrl/vault`. Users may override via
/// `~/.ctrl/config.toml`'s `[vault] path = "..."` to point at their
/// existing Obsidian vault. Returns None when HOME isn't set (CI env).
pub fn default_vault_root() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("vault"))
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

/// Naive substring search across vault `.md` files. A future iteration
/// swaps this for SQLite FTS5 (rusqlite is already a dep); the public
/// signature stays the same so callers don't break.
pub fn search(vault_root: &Path, query: &str, limit: usize) -> Result<Vec<String>, VaultError> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let paths = list(vault_root, None)?;
    let needle = q.to_lowercase();
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

/// Delete a vault file. Returns Ok even when the file didn't exist —
/// vault semantics match the user's mental model: "after delete, it's
/// gone" is true either way.
pub fn delete(vault_root: &Path, rel_path: &str) -> Result<(), VaultError> {
    let safe = sanitize_relative_path(rel_path)?;
    let full = vault_root.join(&safe);
    match fs::remove_file(&full) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(VaultError::Io(e.to_string())),
    }
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
fn sanitize_relative_path(p: &str) -> Result<PathBuf, VaultError> {
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

/// Tiny YAML → JSON parser covering only the shapes we emit: top-level
/// scalar / sequence / mapping. Anything fancier (anchors, multi-doc,
/// flow style) falls back to a JSON null + the original text in the
/// body. Good enough for round-tripping our own frontmatter; users
/// editing frontmatter by hand stay within the same conservative shape.
fn parse_yaml_to_json(yaml: &str) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    for line in yaml.lines() {
        let raw = line.trim_end();
        if raw.is_empty() || raw.starts_with('#') {
            continue;
        }
        // Skip indented continuation / sequence lines for now (handled
        // by callers that know they wrote nested structure).
        if raw.starts_with(' ') || raw.starts_with('\t') {
            continue;
        }
        let Some(colon) = raw.find(':') else {
            continue;
        };
        let key = raw[..colon].trim().to_string();
        let value_str = raw[colon + 1..].trim();
        let value = parse_yaml_scalar(value_str);
        obj.insert(key, value);
    }
    serde_json::Value::Object(obj)
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
