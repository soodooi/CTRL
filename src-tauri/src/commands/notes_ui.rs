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

// ── rename commands (upstream rename_cmds.rs shapes; CTRL-own impls) ────────

#[derive(Debug, Clone, serde::Deserialize, Serialize)]
pub struct DetectedRename {
    pub old_path: String,
    pub new_path: String,
}

#[derive(Debug, Serialize)]
pub struct RenameResult {
    /// New ABSOLUTE file path after the rename (upstream contract).
    pub new_path: String,
    pub updated_files: usize,
    pub failed_updates: usize,
}

/// Renamed-but-uncommitted files, from git (upstream semantics: diff HEAD
/// with rename detection). Empty when the vault has no repo.
#[tauri::command]
pub fn detect_renames(args: serde_json::Value) -> Result<Vec<DetectedRename>, String> {
    let _ = args; // upstream carries vaultPath; single-vault v1 uses the root
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    if !root.join(".git").is_dir() {
        return Ok(Vec::new());
    }
    let out = std::process::Command::new("git")
        .args(["diff", "HEAD", "--name-status", "--diff-filter=R", "-M"])
        .current_dir(&root)
        .output()
        .map_err(|e| format!("git spawn: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .filter_map(|l| {
            let mut it = l.split('\t');
            let status = it.next()?;
            if !status.starts_with('R') {
                return None;
            }
            Some(DetectedRename {
                old_path: it.next()?.to_string(),
                new_path: it.next()?.to_string(),
            })
        })
        .collect())
}

/// Rewrite `[[wikilinks]]` pointing at renamed notes (E11 link-aware rename —
/// the LRA ecosystem's known gap, served natively). Own implementation: for
/// each rename, every `.md` file containing `[[<old-stem>` gets those link
/// targets rewritten to the new stem (plain + `|aliased` + `#heading` forms
/// all share the `[[target` prefix, so one boundary-aware replace covers them).
#[tauri::command]
pub fn update_wikilinks_for_renames(args: UpdateWikilinksArgs) -> Result<usize, String> {
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    let mut updated_total = 0usize;
    for rename in &args.renames {
        updated_total += rewrite_wikilinks(&root, &rename.old_path, &rename.new_path)?;
    }
    Ok(updated_total)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWikilinksArgs {
    /// Upstream carries the vault; single-vault v1 ignores it (root-checked).
    #[serde(default)]
    #[allow(dead_code)]
    pub vault_path: Option<String>,
    pub renames: Vec<DetectedRename>,
}

fn stem_of(p: &str) -> String {
    Path::new(p).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

/// Delegates to the kernel's link-aware rewrite (single implementation —
/// the vault_rename gate tool uses the same one).
fn rewrite_wikilinks(root: &Path, old_path: &str, new_path: &str) -> Result<usize, String> {
    vault::rewrite_wikilinks(root, old_path, new_path).map_err(|e| format!("{e:?}"))
}

/// Rename an `Untitled*` note after its first heading / first line (upstream
/// auto-rename semantics, own impl). Returns None when the note is not
/// untitled or no title can be derived.
#[tauri::command]
pub fn auto_rename_untitled(args: AutoRenameArgs) -> Result<Option<RenameResult>, String> {
    let (root, rel) = to_rel(Path::new(&args.note_path))?;
    let stem = stem_of(&rel);
    if !stem.to_lowercase().starts_with("untitled") {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(root.join(&rel)).map_err(|e| e.to_string())?;
    let title = raw
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && *l != "---")
        .map(|l| l.trim_start_matches('#').trim())
        .unwrap_or("");
    let clean: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if clean.is_empty() {
        return Ok(None);
    }
    let parent = Path::new(&rel).parent().map(|p| p.to_path_buf()).unwrap_or_default();
    // Dedupe with ` 2`, ` 3`, … suffixes.
    let mut candidate = parent.join(format!("{clean}.md"));
    let mut n = 2;
    while root.join(&candidate).exists() {
        candidate = parent.join(format!("{clean} {n}.md"));
        n += 1;
        if n > 99 {
            return Err("could not find a free filename".into());
        }
    }
    let new_rel = candidate.to_string_lossy().to_string();
    std::fs::rename(root.join(&rel), root.join(&new_rel)).map_err(|e| e.to_string())?;
    let updated_files = rewrite_wikilinks(&root, &rel, &new_rel).unwrap_or(0);
    vault::refresh_index_for(&root, &new_rel, &raw);
    Ok(Some(RenameResult {
        new_path: root.join(&new_rel).to_string_lossy().to_string(),
        updated_files,
        failed_updates: 0,
    }))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRenameArgs {
    /// Upstream carries the vault; single-vault v1 ignores it (root-checked).
    #[serde(default)]
    #[allow(dead_code)]
    pub vault_path: Option<String>,
    pub note_path: String,
}

// ── image commands (upstream image.rs contract: attachments/ + timestamp) ───

#[tauri::command]
pub fn save_image(
    vault_path: Option<PathBuf>,
    filename: String,
    data: String,
) -> Result<String, String> {
    use base64::Engine;
    let _ = vault_path;
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("invalid base64: {e}"))?;
    let dir = root.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let safe_name: String = filename
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let target = dir.join(format!("{ts}-{safe_name}"));
    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn copy_image_to_vault(
    vault_path: Option<PathBuf>,
    source_path: PathBuf,
) -> Result<String, String> {
    let _ = vault_path;
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    if !source_path.exists() {
        return Err(format!("source does not exist: {}", source_path.display()));
    }
    let name = source_path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .ok_or("source has no filename")?;
    let dir = root.join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let target = dir.join(format!("{ts}-{name}"));
    std::fs::copy(&source_path, &target).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().to_string())
}

// ── watcher bridge (upstream vault-changed event, camelCase payload) ────────

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultChangedPayload {
    vault_path: String,
    paths: Vec<String>,
}

static WATCHER_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Start the vault watcher and bridge kernel watch events to the upstream
/// `vault-changed` Tauri event (2s poll over kernel::vault_watch, which is
/// already notify-backed — one watcher serves both the gate tool and the UI).
#[tauri::command]
pub fn start_vault_watcher(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    use tauri::Emitter;
    let _ = path; // single-vault v1: the CTRL root is watched
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    crate::kernel::vault_watch::start(&root).map_err(|e| format!("{e:?}"))?;
    if WATCHER_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(()); // bridge already polling
    }
    let root_str = root.to_string_lossy().to_string();
    tauri::async_runtime::spawn(async move {
        let mut since_ms = chrono::Utc::now().timestamp_millis();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if !WATCHER_RUNNING.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            let events = crate::kernel::vault_watch::recent(None, since_ms);
            if events.is_empty() {
                continue;
            }
            since_ms = events.iter().map(|e| e.ts_ms).max().unwrap_or(since_ms);
            let paths: Vec<String> = events
                .into_iter()
                .map(|e| format!("{root_str}/{}", e.path))
                .collect();
            let _ = app.emit(
                "vault-changed",
                VaultChangedPayload { vault_path: root_str.clone(), paths },
            );
        }
    });
    Ok(())
}

#[tauri::command]
pub fn stop_vault_watcher() -> Result<(), String> {
    WATCHER_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

// ── clipboard + misc shell partials ─────────────────────────────────────────

#[tauri::command]
pub fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_text_from_clipboard() -> Result<String, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.get_text().map_err(|e| e.to_string())
}

/// Open a vault file with the OS default app (upstream escape hatch for
/// non-markdown assets — PDFs, images).
#[tauri::command]
pub fn open_vault_file_external(path: PathBuf, vault_path: Option<PathBuf>) -> Result<(), String> {
    let _ = vault_path;
    let (root, rel) = to_rel(&path)?;
    let full = root.join(&rel);
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "linux")]
    let opener = "xdg-open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    std::process::Command::new(opener)
        .arg(&full)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── safe no-op stubs (upstream app-shell / AI-layer surface the CTRL build
//    intentionally does not serve — the AI panel is replaced by Irisy in F4;
//    updater/menu/telemetry are CTRL-shell concerns) ─────────────────────────

#[tauri::command]
pub fn update_menu_state(args: serde_json::Value) -> Result<(), String> {
    let _ = args;
    Ok(())
}

#[tauri::command]
pub fn update_current_window_min_size(args: serde_json::Value) -> Result<(), String> {
    let _ = args;
    Ok(())
}

#[tauri::command]
pub fn sync_vault_asset_scope_for_window(args: serde_json::Value) -> Result<(), String> {
    let _ = args;
    Ok(())
}

#[tauri::command]
pub fn should_use_external_media_preview(args: serde_json::Value) -> Result<bool, String> {
    let _ = args;
    Ok(false)
}

#[tauri::command]
pub fn get_process_memory_snapshot() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({ "available": false }))
}

#[tauri::command]
pub fn check_for_app_update() -> Result<serde_json::Value, String> {
    // CTRL owns updates (ADR-004); the vendored UI's updater is inert.
    Ok(serde_json::json!({ "available": false }))
}

// ── git UI commands (upstream commands/git.rs shapes) ──────────────────────

#[derive(Debug, Serialize)]
pub struct UiGitCommit {
    pub hash: String,
    #[serde(rename = "shortHash")]
    pub short_hash: String,
    pub message: String,
    pub author: String,
    /// Unix seconds (upstream contract).
    pub date: i64,
}

#[derive(Debug, Serialize)]
pub struct UiModifiedFile {
    pub path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub status: String,
    #[serde(rename = "addedLines")]
    pub added_lines: Option<usize>,
    #[serde(rename = "deletedLines")]
    pub deleted_lines: Option<usize>,
    pub binary: bool,
}

#[tauri::command]
pub async fn get_file_history(
    vault_path: String,
    path: String,
) -> Result<Vec<UiGitCommit>, String> {
    let _ = vault_path;
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    if !root.join(".git").is_dir() {
        return Ok(Vec::new());
    }
    let (_, rel) = to_rel(Path::new(&path))?;
    let hist = crate::kernel::vault_git::note_history(&root, &rel, 50).await?;
    Ok(hist
        .into_iter()
        .map(|c| UiGitCommit {
            short_hash: c.rev.chars().take(7).collect(),
            hash: c.rev,
            message: c.message,
            author: c.author,
            date: c.time,
        })
        .collect())
}

#[tauri::command]
pub async fn get_file_diff(vault_path: String, path: String) -> Result<String, String> {
    let _ = vault_path;
    let (_, rel) = to_rel(Path::new(&path))?;
    // Uncommitted diff vs HEAD (upstream semantics).
    let (out, _) = run_git_at_root(&["diff", "HEAD", "--", &rel]).await?;
    Ok(out)
}

#[tauri::command]
pub async fn get_file_diff_at_commit(
    vault_path: String,
    path: String,
    commit: String,
) -> Result<String, String> {
    let _ = vault_path;
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    let (_, rel) = to_rel(Path::new(&path))?;
    crate::kernel::vault_git::note_diff(&root, &rel, &commit).await
}

#[tauri::command]
pub async fn get_modified_files(
    vault_path: String,
    include_stats: Option<bool>,
) -> Result<Vec<UiModifiedFile>, String> {
    let _ = (vault_path, include_stats);
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    if !root.join(".git").is_dir() {
        return Ok(Vec::new());
    }
    let (out, _) = run_git_at_root(&["status", "--porcelain=v1"]).await?;
    Ok(out
        .lines()
        .filter_map(|l| {
            if l.len() < 4 {
                return None;
            }
            let xy = &l[..2];
            let rel = l[3..].trim().trim_matches('"').to_string();
            let status = match xy.trim() {
                "??" => "untracked",
                s if s.contains('M') => "modified",
                s if s.contains('A') => "added",
                s if s.contains('D') => "deleted",
                s if s.contains('R') => "renamed",
                _ => "modified",
            };
            Some(UiModifiedFile {
                path: root.join(&rel).to_string_lossy().to_string(),
                relative_path: rel,
                status: status.to_string(),
                added_lines: None,
                deleted_lines: None,
                binary: false,
            })
        })
        .collect())
}

// ── settings + vault-list (upstream settings.rs / vault_list.rs contracts) ──
// Settings are an OPAQUE JSON blob to CTRL (the UI normalizes/fills defaults
// itself), persisted under ~/.ctrl/ — robust across upstream schema changes.

fn ctrl_config_path(name: &str) -> Result<std::path::PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME unset")?;
    let dir = std::path::Path::new(&home).join(".ctrl");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
pub fn get_settings() -> Result<serde_json::Value, String> {
    let path = ctrl_config_path("notes-ui-settings.json")?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(_) => Ok(serde_json::json!({
            // First run inside CTRL: telemetry OFF by default (data sovereignty;
            // the consent dialog still lets the user opt in), AI panel off —
            // Irisy is CTRL's assistant (F4 trims the panel entirely).
            "telemetry_consent": false,
            "crash_reporting_enabled": false,
            "analytics_enabled": false,
            "anonymous_id": null,
            "ai_features_enabled": false,
        })),
    }
}

#[tauri::command]
pub fn save_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = ctrl_config_path("notes-ui-settings.json")?;
    std::fs::write(&path, serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_vault_path() -> Result<String, String> {
    let root = vault::default_vault_root().ok_or("vault root unresolved")?;
    Ok(root.to_string_lossy().to_string())
}

/// Single-vault v1: the list always contains the CTRL vault (both snake_case
/// and camelCase keys emitted — upstream mixes casings across fields).
#[tauri::command]
pub fn load_vault_list() -> Result<serde_json::Value, String> {
    let root = get_default_vault_path()?;
    let stored = ctrl_config_path("notes-ui-vaults.json")
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    if let Some(v) = stored {
        return Ok(v);
    }
    Ok(serde_json::json!({
        "vaults": [{ "label": "CTRL", "path": root, "mounted": true }],
        "active_vault": root,
        "activeVault": root,
        "default_workspace_path": null,
        "defaultWorkspacePath": null,
        "hidden_defaults": [],
        "hiddenDefaults": [],
    }))
}

#[tauri::command]
pub fn save_vault_list(list: serde_json::Value) -> Result<(), String> {
    let path = ctrl_config_path("notes-ui-vaults.json")?;
    std::fs::write(&path, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// CTRL's vault already exists — "create" commands resolve to it (the UI's
/// vault-picker flows land on the CTRL vault instead of making a new one).
#[tauri::command]
pub fn create_empty_vault(args: serde_json::Value) -> Result<String, String> {
    let _ = args;
    get_default_vault_path()
}

#[tauri::command]
pub fn create_getting_started_vault(args: serde_json::Value) -> Result<String, String> {
    let _ = args;
    get_default_vault_path()
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

    #[test]
    fn rewrite_wikilinks_is_boundary_aware() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(
            root.join("a.md"),
            "see [[old-note]] and [[old-note|alias]] and [[old-note#Heading]]\nbut [[old-note-longer]] stays\n",
        )
        .unwrap();
        std::fs::write(root.join("b.md"), "no links here\n").unwrap();
        let n = rewrite_wikilinks(root, "old-note.md", "new-note.md").unwrap();
        assert_eq!(n, 1, "only the file with matching links rewrites");
        let out = std::fs::read_to_string(root.join("a.md")).unwrap();
        assert!(out.contains("[[new-note]]"));
        assert!(out.contains("[[new-note|alias]]"));
        assert!(out.contains("[[new-note#Heading]]"));
        assert!(out.contains("[[old-note-longer]]"), "longer stem is NOT a boundary match");
    }

    #[test]
    fn rewrite_wikilinks_noop_on_same_stem() {
        let dir = tempfile::TempDir::new().unwrap();
        assert_eq!(rewrite_wikilinks(dir.path(), "x/a.md", "y/a.md").unwrap(), 0);
    }
}
