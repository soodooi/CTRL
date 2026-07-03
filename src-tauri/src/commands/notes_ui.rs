// Adapter: the vendored Tolaria notes frontend's command surface, served by
// CTRL's kernel (ADR-002 substrate §1.9 v47 + ADR-006 §5.1.1 v11, notes-plan
// F2). The vendored UI (`packages/ctrl-notes-ui`) calls these EXACT command
// names with the upstream argument shapes (verified against the upstream
// src-tauri at the pinned commit — see UPSTREAM.md), so the frontend needs
// ZERO codemod and upstream cherry-picks stay conflict-free. CTRL's kernel is
// the only backend: reads/writes go through the vault layer (FTS index +
// embedding staleness + the vault_git audit layer all keep working).
//
// Path model translation: upstream is multi-vault with ABSOLUTE paths; CTRL
// v1 serves its single vault root — every incoming absolute path is validated
// to live INSIDE the CTRL vault root (no traversal out), then handled
// root-relative. The upstream `vault_path` argument is accepted and checked
// when present.

use crate::kernel::vault;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Resolve + validate an upstream absolute note path to a CTRL vault-relative
/// path. Rejects anything outside the vault root (defense against traversal —
/// mirrors upstream's own with_note_path validation posture).
fn to_rel(path: &Path) -> Result<(PathBuf, String), String> {
    let root = vault::default_vault_root().ok_or("vault root unresolved (HOME unset)")?;
    // Canonicalize the ROOT (must exist); the note itself may not exist yet
    // (create path), so canonicalize its parent chain logically instead:
    // require the raw path to start with the root after normalization.
    let root_canon = root.canonicalize().map_err(|e| format!("vault root: {e}"))?;
    let p = if path.is_absolute() { path.to_path_buf() } else { root_canon.join(path) };
    // Normalize `..` / `.` components without requiring existence.
    let mut norm = PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::ParentDir => {
                if !norm.pop() {
                    return Err("path escapes the vault root".into());
                }
            }
            std::path::Component::CurDir => {}
            other => norm.push(other),
        }
    }
    let rel = norm
        .strip_prefix(&root_canon)
        .map_err(|_| format!("path is outside the CTRL vault: {}", path.display()))?
        .to_path_buf();
    let rel_str = rel.to_string_lossy().to_string();
    if rel_str.is_empty() {
        return Err("path is the vault root, not a note".into());
    }
    Ok((root_canon, rel_str))
}

// ── file commands (upstream commands/vault/file_cmds.rs shapes) ─────────────

/// Raw note read — upstream returns the FULL file string (frontmatter
/// included), so we read raw bytes rather than the split vault::read.
#[tauri::command]
pub fn get_note_content(path: PathBuf, vault_path: Option<PathBuf>) -> Result<String, String> {
    let _ = vault_path; // single-vault v1: root is checked by to_rel
    let (root, rel) = to_rel(&path)?;
    std::fs::read_to_string(root.join(&rel)).map_err(|e| format!("read {rel}: {e}"))
}

/// Raw full-file write. Goes through fs + a best-effort index refresh so
/// search/backlinks stay live (same posture as vault::write_body).
#[tauri::command]
pub async fn save_note_content(
    path: PathBuf,
    content: String,
    vault_path: Option<PathBuf>,
) -> Result<(), String> {
    let _ = vault_path;
    let (root, rel) = to_rel(&path)?;
    let full = root.join(&rel);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full, &content).map_err(|e| format!("write {rel}: {e}"))?;
    vault::refresh_index_for(&root, &rel, &content);
    Ok(())
}

/// Create a new note (fails if it already exists — upstream semantics).
#[tauri::command]
pub async fn create_note_content(
    path: PathBuf,
    content: String,
    vault_path: Option<PathBuf>,
) -> Result<(), String> {
    let _ = vault_path;
    let (root, rel) = to_rel(&path)?;
    let full = root.join(&rel);
    if full.exists() {
        return Err(format!("note already exists: {rel}"));
    }
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&full, &content).map_err(|e| format!("create {rel}: {e}"))?;
    vault::refresh_index_for(&root, &rel, &content);
    Ok(())
}

/// Re-read one entry (upstream returns the raw content string too).
#[tauri::command]
pub fn reload_vault_entry(path: PathBuf, vault_path: Option<PathBuf>) -> Result<String, String> {
    get_note_content(path, vault_path)
}

#[tauri::command]
pub async fn batch_delete_notes_async(
    paths: Vec<PathBuf>,
    vault_path: Option<PathBuf>,
) -> Result<(), String> {
    let _ = vault_path;
    for p in paths {
        let (root, rel) = to_rel(&p)?;
        vault::delete(&root, &rel).map_err(|e| format!("delete {rel}: {e:?}"))?;
    }
    Ok(())
}

// ── folder commands ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_vault_folder(path: PathBuf, vault_path: Option<PathBuf>) -> Result<(), String> {
    let _ = vault_path;
    let (root, rel) = to_rel(&path)?;
    std::fs::create_dir_all(root.join(&rel)).map_err(|e| format!("mkdir {rel}: {e}"))
}

#[tauri::command]
pub fn rename_vault_folder(
    from: PathBuf,
    to: PathBuf,
    vault_path: Option<PathBuf>,
) -> Result<(), String> {
    let _ = vault_path;
    let (root, rel_from) = to_rel(&from)?;
    let (_, rel_to) = to_rel(&to)?;
    std::fs::rename(root.join(&rel_from), root.join(&rel_to))
        .map_err(|e| format!("rename {rel_from} -> {rel_to}: {e}"))
}

#[tauri::command]
pub fn delete_vault_folder(path: PathBuf, vault_path: Option<PathBuf>) -> Result<(), String> {
    let _ = vault_path;
    let (root, rel) = to_rel(&path)?;
    std::fs::remove_dir_all(root.join(&rel)).map_err(|e| format!("rmdir {rel}: {e}"))
}

// ── search (upstream commands/vault/scan_cmds.rs SearchResponse shape) ──────

#[derive(Debug, Serialize)]
pub struct SearchMatchItem {
    pub path: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchMatchItem>,
    pub truncated: bool,
}

/// Full-text search over the vault — served by CTRL's FTS5 index (upstream
/// scans in memory; this is strictly faster). Snippets come from a raw read
/// around the first match.
#[tauri::command]
pub async fn search_vault(
    vault_path: String,
    query: String,
    limit: Option<usize>,
    exclude_frontmatter: Option<bool>,
) -> Result<SearchResponse, String> {
    let _ = (vault_path, exclude_frontmatter); // single-vault; fm excluded by snippet shape
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    let limit = limit.unwrap_or(20);
    let hits = vault::search(&root, &query, limit + 1).map_err(|e| format!("{e:?}"))?;
    let truncated = hits.len() > limit;
    let needle = query.to_lowercase();
    let results = hits
        .into_iter()
        .take(limit)
        .map(|rel| {
            let snippet = vault::read(&root, &rel)
                .ok()
                .map(|e| snippet_around(&e.content, &needle, 100))
                .unwrap_or_default();
            // Upstream returns ABSOLUTE paths — translate back out.
            SearchMatchItem { path: root.join(&rel).to_string_lossy().to_string(), snippet }
        })
        .collect();
    Ok(SearchResponse { results, truncated })
}

fn snippet_around(content: &str, needle_lower: &str, radius: usize) -> String {
    let lower = content.to_lowercase();
    let Some(at) = lower.find(needle_lower) else {
        return content.chars().take(radius).collect();
    };
    let start = at.saturating_sub(radius);
    let end = (at + needle_lower.len() + radius).min(content.len());
    let start = (0..=start.min(content.len()))
        .rev()
        .find(|&i| content.is_char_boundary(i))
        .unwrap_or(0);
    let end = (end..=content.len()).find(|&i| content.is_char_boundary(i)).unwrap_or(content.len());
    content[start..end].trim().to_string()
}

// ── git commands (upstream src-tauri/src/git shapes, thin over `git` CLI) ───

async fn run_git_at_root(args: &[&str]) -> Result<(String, i32), String> {
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    let out = tokio::process::Command::new("git")
        .args(args)
        .current_dir(&root)
        .output()
        .await
        .map_err(|e| format!("git spawn: {e}"))?;
    Ok((String::from_utf8_lossy(&out.stdout).to_string(), out.status.code().unwrap_or(-1)))
}

#[tauri::command]
pub async fn is_git_repo(vault_path: Option<String>) -> Result<bool, String> {
    let _ = vault_path;
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    Ok(root.join(".git").is_dir())
}

#[tauri::command]
pub async fn init_git_repo(vault_path: Option<String>) -> Result<(), String> {
    let _ = vault_path;
    let (_, code) = run_git_at_root(&["init", "-q"]).await?;
    if code != 0 {
        return Err(format!("git init exited {code}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn git_commit(message: String, vault_path: Option<String>) -> Result<(), String> {
    let _ = vault_path;
    run_git_at_root(&["add", "-A"]).await?;
    let (_, code) = run_git_at_root(&["commit", "-m", &message, "--quiet"]).await?;
    // Nothing to commit is not an error for the UI's save-flow.
    if code != 0 && code != 1 {
        return Err(format!("git commit exited {code}"));
    }
    Ok(())
}

// NOTE: `git_push` is NOT defined here — the existing `commands::git::git_push`
// already serves the name (Tauri ignores the upstream UI's extra `vaultPath`
// argument), so the adapter reuses it instead of colliding.

#[derive(Debug, Serialize)]
pub struct GitAuthorIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[tauri::command]
pub async fn git_author_identity(vault_path: Option<String>) -> Result<GitAuthorIdentity, String> {
    let _ = vault_path;
    let (name, _) = run_git_at_root(&["config", "user.name"]).await?;
    let (email, _) = run_git_at_root(&["config", "user.email"]).await?;
    let clean = |s: String| {
        let t = s.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    };
    Ok(GitAuthorIdentity { name: clean(name), email: clean(email) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_rel_accepts_inside_and_rejects_outside() {
        // Uses the real default vault root when HOME is set; build paths off it.
        let Some(root) = vault::default_vault_root() else { return };
        std::fs::create_dir_all(&root).ok();
        let Ok(canon) = root.canonicalize() else { return };
        let inside = canon.join("notes/a.md");
        let (_, rel) = to_rel(&inside).unwrap();
        assert_eq!(rel, "notes/a.md");
        // Traversal out is rejected.
        let escape = canon.join("notes/../../outside.md");
        assert!(to_rel(&escape).is_err());
        // A path outside the root entirely is rejected.
        assert!(to_rel(Path::new("/tmp/other.md")).is_err());
    }

    #[test]
    fn snippet_falls_back_to_head_when_needle_absent() {
        assert_eq!(snippet_around("hello world", "zzz", 5), "hello");
        assert!(snippet_around("abc needle def", "needle", 3).contains("needle"));
    }
}
