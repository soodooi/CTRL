//! Workshop draft storage — CRUD over `~/.ctrl/mcps/.drafts/<id>/`.
//!
//! Drafts are authoring-time state, not user knowledge. Live OUTSIDE
//! the vault (per memory `decision_mcp_base_vs_functional_layer` +
//! workshop research: drafts are tooling, vault is content). mesh does
//! NOT sync drafts — they're per-device editing state.
//!
//! Layout:
//!   ~/.ctrl/mcps/.drafts/<draft-id>/
//!     manifest.json              # current edit state (McpManifest shape)
//!     runs/<timestamp>-<id>.json # n8n-style execution trace history (LRU, last 20)
//!     .git/                       # opt-in, written by separate `draft_git_init` (future)
//!
//! draft_id is opaque to the kernel (PWA generates; canonical form =
//! short ulid or uuid). When install_mcp promotes the draft, the
//! manifest's `id` field becomes the real mcp id; the draft_id is
//! discarded with the draft directory.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const DRAFTS_SUBDIR: &str = ".drafts";

#[derive(Debug, Serialize)]
pub struct DraftSummary {
    pub draft_id: String,
    pub manifest_id: Option<String>,
    pub manifest_name: Option<String>,
    pub manifest_version: Option<String>,
    pub created_at: Option<String>,
    pub last_modified_at: String, // ISO from filesystem mtime
    pub size_bytes: u64,
    pub run_count: usize,
}

#[tauri::command]
pub async fn draft_list() -> Result<Vec<DraftSummary>, String> {
    let dir = drafts_root()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read_dir {dir:?}: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("dir entry: {e}"))?;
        if !entry
            .file_type()
            .map(|t| t.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        let draft_id = entry.file_name().to_string_lossy().to_string();
        // Skip hidden dirs (e.g., temp scratch).
        if draft_id.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            // Defensive — directory without manifest isn't a draft.
            continue;
        }
        let summary = summarize_draft(&draft_id, &manifest_path);
        out.push(summary);
    }
    out.sort_by(|a, b| b.last_modified_at.cmp(&a.last_modified_at));
    Ok(out)
}

#[derive(Debug, Deserialize)]
pub struct DraftReadArgs {
    pub draft_id: String,
}

#[derive(Debug, Serialize)]
pub struct DraftReadReply {
    pub draft_id: String,
    pub manifest: serde_json::Value,
    pub absolute_path: String,
}

#[tauri::command]
pub async fn draft_read(args: DraftReadArgs) -> Result<DraftReadReply, String> {
    let safe_id = sanitize_draft_id(&args.draft_id)?;
    let path = drafts_root()?.join(&safe_id).join("manifest.json");
    if !path.exists() {
        return Err(format!("draft {safe_id} not found"));
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read {path:?}: {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("parse manifest.json: {e}"))?;
    Ok(DraftReadReply {
        draft_id: safe_id,
        manifest,
        absolute_path: path.display().to_string(),
    })
}

#[derive(Debug, Deserialize)]
pub struct DraftSaveArgs {
    pub draft_id: String,
    /// Full McpManifest JSON. Kernel does NOT validate the shape here
    /// (drafts are by definition incomplete); validation happens at
    /// install_mcp promotion time.
    pub manifest: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct DraftSaveReply {
    pub draft_id: String,
    pub absolute_path: String,
    pub written_at: String,
}

/// Atomic write (tmp + rename). Creates the draft directory tree on
/// first save. Re-issuing on an existing draft overwrites the manifest
/// — caller (PWA) is responsible for diffing if rollback matters; the
/// runs/ history is the change log on the execution side.
#[tauri::command]
pub async fn draft_save(args: DraftSaveArgs) -> Result<DraftSaveReply, String> {
    let safe_id = sanitize_draft_id(&args.draft_id)?;
    let dir = drafts_root()?.join(&safe_id);
    std::fs::create_dir_all(dir.join("runs"))
        .map_err(|e| format!("mkdir {:?}: {e}", dir.join("runs")))?;
    let path = dir.join("manifest.json");
    let serialized = serde_json::to_vec_pretty(&args.manifest)
        .map_err(|e| format!("serialize manifest: {e}"))?;
    write_atomic(&path, &serialized)?;
    let now = iso_now();
    tracing::info!(
        draft_id = %safe_id,
        bytes = serialized.len(),
        "draft_save ok"
    );
    Ok(DraftSaveReply {
        draft_id: safe_id,
        absolute_path: path.display().to_string(),
        written_at: now,
    })
}

#[derive(Debug, Deserialize)]
pub struct DraftDeleteArgs {
    pub draft_id: String,
}

/// Recursively remove the draft directory (manifest + runs/ + opt-in .git/).
/// Idempotent — silent when nothing's there. Caller is responsible for
/// confirming user intent before invoking; the kernel doesn't second-
/// guess (Figma agents pattern — delete is action, undo is at app level).
#[tauri::command]
pub async fn draft_delete(args: DraftDeleteArgs) -> Result<(), String> {
    let safe_id = sanitize_draft_id(&args.draft_id)?;
    let dir = drafts_root()?.join(&safe_id);
    if !dir.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("remove {dir:?}: {e}"))?;
    tracing::info!(draft_id = %safe_id, "draft_delete ok");
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct DraftRecordRunArgs {
    pub draft_id: String,
    /// Execution trace JSON — shape is run_mcp_draft's `RunResult`
    /// (see commands/draft_run.rs once D2 lands). Kernel only writes the
    /// blob verbatim; consumers parse on read.
    pub trace: serde_json::Value,
}

/// Append an execution-trace entry under `runs/<timestamp>-<id>.json`.
/// Keeps the last 20 runs (LRU, oldest deleted). Optional; PWA can skip
/// if it doesn't want history.
#[tauri::command]
pub async fn draft_record_run(args: DraftRecordRunArgs) -> Result<String, String> {
    let safe_id = sanitize_draft_id(&args.draft_id)?;
    let runs_dir = drafts_root()?.join(&safe_id).join("runs");
    std::fs::create_dir_all(&runs_dir).map_err(|e| format!("mkdir {runs_dir:?}: {e}"))?;

    let stamp = iso_now().replace(':', "-").replace('.', "-");
    let short = rand_short_id();
    let file_name = format!("{stamp}-{short}.json");
    let path = runs_dir.join(&file_name);
    let bytes = serde_json::to_vec_pretty(&args.trace)
        .map_err(|e| format!("serialize trace: {e}"))?;
    write_atomic(&path, &bytes)?;

    // Prune to last 20 (LRU by filename, which is timestamp-prefixed).
    prune_runs(&runs_dir, 20);

    Ok(file_name)
}

#[derive(Debug, Deserialize)]
pub struct DraftListRunsArgs {
    pub draft_id: String,
}

#[derive(Debug, Serialize)]
pub struct DraftRunSummary {
    pub file_name: String,
    pub absolute_path: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub async fn draft_list_runs(args: DraftListRunsArgs) -> Result<Vec<DraftRunSummary>, String> {
    let safe_id = sanitize_draft_id(&args.draft_id)?;
    let runs_dir = drafts_root()?.join(&safe_id).join("runs");
    if !runs_dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&runs_dir).map_err(|e| format!("read_dir: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let meta = entry.metadata().map_err(|e| format!("metadata: {e}"))?;
        out.push(DraftRunSummary {
            file_name: entry.file_name().to_string_lossy().to_string(),
            absolute_path: path.display().to_string(),
            size_bytes: meta.len(),
        });
    }
    out.sort_by(|a, b| b.file_name.cmp(&a.file_name)); // newest first
    Ok(out)
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn drafts_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
    Ok(PathBuf::from(home)
        .join(".ctrl")
        .join("mcps")
        .join(DRAFTS_SUBDIR))
}

fn sanitize_draft_id(s: &str) -> Result<String, String> {
    if s.is_empty() {
        return Err("draft_id is empty".into());
    }
    if s.len() > 100 {
        return Err("draft_id too long (>100 chars)".into());
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "draft_id {s:?} must be alphanumeric + - + _ only"
        ));
    }
    Ok(s.to_string())
}

fn summarize_draft(draft_id: &str, manifest_path: &Path) -> DraftSummary {
    let raw = std::fs::read_to_string(manifest_path).unwrap_or_default();
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null);
    let meta = std::fs::metadata(manifest_path).ok();
    let size_bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let last_modified_at = meta
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| {
            chrono_lite_iso(d.as_secs())
        })
        .unwrap_or_else(|| iso_now());

    // Count run files (cheap — directory scan, bounded by LRU prune).
    let runs_dir = manifest_path
        .parent()
        .map(|p| p.join("runs"))
        .unwrap_or_default();
    let run_count = std::fs::read_dir(&runs_dir)
        .map(|rd| rd.filter_map(|e| e.ok()).count())
        .unwrap_or(0);

    DraftSummary {
        draft_id: draft_id.to_string(),
        manifest_id: parsed
            .get("id")
            .and_then(|v| v.as_str())
            .map(String::from),
        manifest_name: parsed
            .get("name")
            .and_then(|v| v.as_str())
            .map(String::from),
        manifest_version: parsed
            .get("version")
            .and_then(|v| v.as_str())
            .map(String::from),
        created_at: parsed
            .get("draft")
            .and_then(|d| d.get("created_at"))
            .and_then(|v| v.as_str())
            .map(String::from),
        last_modified_at,
        size_bytes,
        run_count,
    }
}

fn write_atomic(path: &Path, content: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("write {tmp:?}: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))?;
    Ok(())
}

fn prune_runs(runs_dir: &Path, keep: usize) {
    let mut entries: Vec<_> = match std::fs::read_dir(runs_dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return,
    };
    if entries.len() <= keep {
        return;
    }
    // Sort by file name ascending; oldest at the front (timestamp prefix).
    entries.sort_by_key(|e| e.file_name());
    let to_delete = entries.len() - keep;
    for entry in entries.into_iter().take(to_delete) {
        let _ = std::fs::remove_file(entry.path());
    }
}

fn iso_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    chrono_lite_iso(secs)
}

/// Format a Unix timestamp as an ISO-8601 UTC string without pulling in
/// chrono. Sufficient for filesystem mtimes — second precision, no TZ.
fn chrono_lite_iso(secs: u64) -> String {
    let (year, month, day, hour, minute, second) = ymd_hms_utc(secs);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn ymd_hms_utc(secs: u64) -> (u32, u32, u32, u32, u32, u32) {
    // Days since 1970-01-01.
    let days = (secs / 86_400) as i64;
    let seconds_of_day = (secs % 86_400) as u32;
    let hour = seconds_of_day / 3600;
    let minute = (seconds_of_day % 3600) / 60;
    let second = seconds_of_day % 60;

    // Convert days-since-epoch → Y/M/D using the algorithm from
    // Howard Hinnant's date library (public domain).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (if m <= 2 { y + 1 } else { y }) as u32;
    (year, m as u32, d as u32, hour, minute, second)
}

fn rand_short_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{:08x}", n & 0xffff_ffff)
}
