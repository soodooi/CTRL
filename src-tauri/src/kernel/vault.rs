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
// policy, or write arbitrary path hints from a mcp.
//
// The kernel module owns IO only — capability-level surface (which mcp
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
/// CTRL config file — a single JSON object, currently `{ "vault_root": "..." }`.
/// Lives OUTSIDE any vault (it points AT the vault), at `~/.ctrl/config.json`.
fn config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("config.json"))
}

/// The vault root the user pointed CTRL at (e.g. their EXISTING Obsidian vault).
/// `None` until they pick one — the data belongs to the user, so CTRL operates on
/// the user's own vault instead of imposing a folder (CLAUDE.md: vault layout is
/// user-decided, not hardcoded). The first-run flow prompts for it.
pub fn configured_vault_root() -> Option<PathBuf> {
    let body = fs::read_to_string(config_path()?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let p = v.get("vault_root")?.as_str()?.trim();
    if p.is_empty() {
        None
    } else {
        Some(PathBuf::from(p))
    }
}

/// True once the user has chosen a vault, so the UI can skip the first-run picker.
pub fn is_vault_configured() -> bool {
    configured_vault_root().is_some()
}

/// Set one config key in `~/.ctrl/config.json`, merging so other keys survive.
fn update_config(key: &str, value: serde_json::Value) -> std::io::Result<()> {
    let cfg = config_path()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "HOME not set"))?;
    if let Some(parent) = cfg.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut obj = fs::read_to_string(&cfg)
        .ok()
        .and_then(|b| serde_json::from_str::<serde_json::Value>(&b).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    obj.insert(key.to_string(), value);
    let body = serde_json::to_string_pretty(&serde_json::Value::Object(obj)).unwrap_or_default();
    fs::write(&cfg, body)
}

/// Persist the user's chosen vault root.
pub fn set_vault_root(path: &Path) -> std::io::Result<()> {
    update_config(
        "vault_root",
        serde_json::Value::String(path.display().to_string()),
    )
}

/// Whether auto-commit (git) of the vault is enabled (default off).
pub fn auto_sync_enabled() -> bool {
    config_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|b| serde_json::from_str::<serde_json::Value>(&b).ok())
        .and_then(|v| v.get("auto_sync").and_then(|a| a.as_bool()))
        .unwrap_or(false)
}

/// Persist the auto-sync toggle.
pub fn set_auto_sync(enabled: bool) -> std::io::Result<()> {
    update_config("auto_sync", serde_json::Value::Bool(enabled))
}

/// The resolved vault root: the user's configured vault if set, otherwise the
/// `~/Documents/CTRL/` fallback (used only until the user points CTRL at their
/// own vault). Named "default" for historical callers; it is now config-aware.
pub fn default_vault_root() -> Option<PathBuf> {
    if let Some(root) = configured_vault_root() {
        return Some(root);
    }
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
    let _ = std::fs::create_dir_all(root.join("notes").join("mcp-runs"));
    let _ = std::fs::create_dir_all(root.join("notes").join("mcp-runs").join("archive"));

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
            Ok(indexed) => {
                // Staleness check (bao 2026-06-13): the index is built at boot,
                // but files written to disk afterwards (by the user's editor,
                // another app, or a direct write) never made it in — and the
                // old logic returned FTS5 hits whenever the index was non-empty,
                // so new notes were invisible until a manual rebuild. Compare
                // the indexed count against the actual .md count and rebuild
                // when they diverge (added/removed on disk) or when empty.
                let actual = list(vault_root, None).map(|v| v.len()).unwrap_or(indexed);
                if indexed == 0 || actual != indexed {
                    if let Err(e) = rebuild_index_inner(vault_root, idx) {
                        tracing::warn!(error = %e, "vault: stale rebuild_index failed");
                    }
                }
                if let Ok(hits) = idx.search(q, limit) {
                    return Ok(hits);
                }
                // Fall through to scan on FTS5 error.
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
/// what a mcp claims.
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

/// Render a JSON value as a YAML frontmatter block via serde_yaml (already a
/// dependency). This round-trips nested objects/arrays as real YAML — so a
/// smart-table `schema:` block reads as clean YAML, not an escaped JSON string
/// (vim test). The read side (`parse_yaml_to_json`) is the symmetric deserialize.
fn frontmatter_to_yaml(value: &serde_json::Value) -> Result<String, VaultError> {
    let obj = value.as_object().ok_or_else(|| {
        VaultError::InvalidFrontmatter("frontmatter must be a JSON object".to_string())
    })?;
    if obj.is_empty() {
        return Ok(String::new());
    }
    serde_yaml::to_string(value).map_err(|e| VaultError::InvalidFrontmatter(e.to_string()))
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

/// Parse a YAML frontmatter block into a JSON value via serde_yaml (symmetric
/// with `frontmatter_to_yaml`). Handles nested objects/arrays/scalars; an empty
/// or unparseable block yields null (frontmatter is best-effort, never fatal).
fn parse_yaml_to_json(yaml: &str) -> serde_json::Value {
    if yaml.trim().is_empty() {
        return serde_json::Value::Null;
    }
    serde_yaml::from_str::<serde_json::Value>(yaml).unwrap_or(serde_json::Value::Null)
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

    // P6 — Irisy SOUL.md core-memory write closes the loop: the persona
    // layer reads back exactly what was saved, or the injected memory is
    // wrong. ADR-005 irisy v2 § soul-md-compat §4.3. SOUL.md is a multi-line
    // markdown doc with frontmatter.
    #[test]
    fn soul_md_roundtrips_multiline_body_and_flat_frontmatter() {
        let root = fresh_tmp("soul");
        // soul_md_version lives in a separate irisy/.soul-md-version pin file,
        // NOT here. The ISO timestamp round-trips as a string (serde_yaml maps
        // it to a JSON string, not a number/date).
        let fm = serde_json::json!({
            "kind": "soul",
            "managed_by": "irisy",
            "created_at": "2026-06-19T10:00:00Z",
            "tags": ["irisy", "memory"]
        });
        let body = "# Irisy\n\nbao prefers brevity.\n\n- cite path:line\n- no sycophancy\n";
        write(&root, "irisy/SOUL.md", body, &fm).expect("soul write");

        let entry = read(&root, "irisy/SOUL.md").expect("soul read");
        assert_eq!(entry.path, "irisy/SOUL.md");
        // Multi-line markdown body (blank lines + list) survives intact.
        assert_eq!(entry.content.trim_end(), body.trim_end());
        assert_eq!(entry.frontmatter["kind"], "soul");
        assert_eq!(entry.frontmatter["managed_by"], "irisy");
        assert_eq!(entry.frontmatter["created_at"], "2026-06-19T10:00:00Z");
        assert_eq!(entry.frontmatter["tags"][0], "irisy");
        assert_eq!(entry.frontmatter["tags"][1], "memory");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn soul_md_write_overwrites_prior_content() {
        // SOUL.md is single-file persistent memory — curator updates must
        // replace, not append. ADR-005 irisy v2 § soul-md-compat §4.3.
        let root = fresh_tmp("soul-ow");
        write(&root, "irisy/SOUL.md", "v1 body", &serde_json::json!({"rev": 1})).unwrap();
        write(&root, "irisy/SOUL.md", "v2 body", &serde_json::json!({"rev": 2})).unwrap();

        let entry = read(&root, "irisy/SOUL.md").unwrap();
        assert_eq!(entry.content.trim(), "v2 body");
        assert_eq!(entry.frontmatter["rev"].as_i64(), Some(2));

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
