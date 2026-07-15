// Vault Tauri commands — PWA-facing surface for the vault capability.
//
// (ADR-002 substrate § vault v1 §8.3, 2026-06-01 — memory
// `decision_vault_adr_002_section_8` — kernel exposes 21 primitive
// endpoints; Daily Note / Sourcing routines live at the feature layer.)
//
// Per `.kiro/steering/development-philosophy.md` Design Philosophy:
//   - All paths are relative to vault root (portable, machine-independent)
//   - Frontmatter is JSON over the wire; vault module renders/parses YAML on disk
//   - No "export" command — files are on disk, vim / Obsidian / Finder open them
//
// Capability gating (kernel::capability::CapabilityBroker) will mediate which
// mcp can write where in a follow-up commit. Today every mcp shares the
// vault root; isolation lands when manifest-declared capability scopes do.

// Trimmed 2026-06-24: the vault/smart-table/embeddings/sourcing capability
// commands retired to the :17873 gate (comms-system-design Phase B). Only
// vault_write_image / vault_watch_recent / irisy_soul_* remain as Tauri
// commands, so this surface keeps just the imports those few need.
use crate::kernel::capability::{CapToken, CapabilityBroker};
use crate::kernel::capability_resolver;
use crate::kernel::vault::{self, VaultError};
use crate::kernel::vault_watch::{self, EventEntry as VaultWatchEvent};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn vault_root() -> Result<PathBuf, String> {
    vault::default_vault_root().ok_or_else(|| "HOME env var not set".to_string())
}

/// Resolve the caller's capability + check the required token. Absent
/// mcp_id falls back to "ctrl-system" (full-access) so Settings UI /
/// first-run wizard / debug calls keep working without manifest setup.
fn check_cap(mcp_id: Option<&str>, required: &CapToken) -> Result<(), String> {
    let id = mcp_id.unwrap_or("ctrl-system");
    let cap = capability_resolver::resolve_for_mcp(id);
    let broker = CapabilityBroker::new();
    broker.check(&cap, required).map_err(|e| {
        tracing::warn!(mcp_id = %id, token = ?required, error = %e, "vault: capability check rejected");
        format!("capability denied for mcp {id:?}: {e}")
    })
}

#[derive(Debug, Deserialize)]
pub struct VaultWriteImageArgs {
    /// Relative path for the image binary under the vault root (e.g.
    /// `images/2026-05/23-poster-001.png`). Caller picks the layout;
    /// CTRL ships defaults but never enforces.
    pub image_path: String,
    /// Image bytes. Tauri marshals `Vec<u8>` as a typed array over IPC
    /// so the PWA can hand over a Uint8Array without base64 overhead.
    pub bytes: Vec<u8>,
    /// Companion `.md` sidecar — markdown body (CTRL prefixes the YAML
    /// frontmatter from `sidecar_frontmatter` automatically).
    pub sidecar_path: String,
    pub sidecar_body: String,
    pub sidecar_frontmatter: serde_json::Value,
    #[serde(default)]
    pub mcp_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VaultWriteImageReply {
    pub image_path: String,
    pub image_absolute: String,
    pub sidecar_path: String,
    pub sidecar_absolute: String,
}

/// Write an image asset + its markdown sidecar atomically.
///
/// CTRL's vault is markdown-first (Obsidian-compat) — opening a `.png`
/// directly in VMark / vim is unhelpful. The sidecar `.md` carries the
/// rendered embed `![](path.png)` plus structured frontmatter (prompt /
/// provider / model / etc.) so the asset is searchable via FTS5 and
/// navigable from any markdown viewer.
///
/// The PWA gallery (C21, daedalus lane) browses sidecar files; the user
/// double-clicks a sidecar to open it inline (CTRL native lightbox) and
/// optionally jumps out to VMark.
///
/// Image and sidecar are written sequentially (filesystem doesn't give
/// atomicity for two paths); on partial failure the caller can re-issue
/// — both writes are idempotent on identical inputs.
#[tauri::command]
pub async fn vault_write_image(
    args: VaultWriteImageArgs,
) -> Result<VaultWriteImageReply, String> {
    check_cap(
        args.mcp_id.as_deref(),
        &CapToken::VaultWrite {
            path_glob: args.image_path.clone(),
        },
    )?;
    let root = vault_root()?;
    let image_full = vault::write_binary(&root, &args.image_path, &args.bytes)
        .map_err(stringify_vault_error)?;
    let sidecar_full = vault::write(
        &root,
        &args.sidecar_path,
        &args.sidecar_body,
        &args.sidecar_frontmatter,
    )
    .map_err(stringify_vault_error)?;
    tracing::info!(
        image = %args.image_path,
        sidecar = %args.sidecar_path,
        bytes = args.bytes.len(),
        "vault_write_image ok",
    );
    Ok(VaultWriteImageReply {
        image_path: args.image_path,
        image_absolute: image_full.display().to_string(),
        sidecar_path: args.sidecar_path,
        sidecar_absolute: sidecar_full.display().to_string(),
    })
}

fn stringify_vault_error(e: VaultError) -> String {
    e.to_string()
}

// ---------------------------------------------------------------------
// Smart-table AI column (ADR-003 frontend §6.5.4 / ADR-002 substrate §14)
// ---------------------------------------------------------------------
// The "AI-as-column" differentiator from the front end: run an LLM down a
// column, {field}-templated, resume-safe (skips filled cells), cost-gated.
// This is the PWA-facing twin of the mcp_server gate tool of the same name —
// it reuses the identical ai_column core (plan_rows / complete_row /
// apply_results) so the gate path (Irisy / external CLI) and the direct path
// (the user clicking the column header) stay behaviourally identical.
// Produce still writes straight through vault::write; the system-wide review
// gate is ADR-006 §4 (out of this slice, per GOAL non-goals).

// ---------------------------------------------------------------------
// Watcher endpoint (§8.3 #21)
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct VaultWatchRecentArgs {
    /// Optional vault-relative prefix filter. Pass `"sourcing/"` to get
    /// only Sourcing inbox events.
    #[serde(default)]
    pub prefix: Option<String>,
    /// Unix epoch ms cursor. Frontend stores the largest `ts_ms` it has
    /// seen and passes it back on the next poll; older entries get
    /// dropped from the ring buffer regardless.
    pub since_ms: i64,
    #[serde(default)]
    pub mcp_id: Option<String>,
}

/// Drain recent filesystem events from the vault watcher ring buffer
/// (`kernel::vault_watch`). First call lazily starts the watcher so the
/// frontend doesn't need a separate setup step — the same poll loop
/// bootstraps the cursor and the watcher in one round-trip.
#[tauri::command]
pub async fn vault_watch_recent(
    args: VaultWatchRecentArgs,
) -> Result<Vec<VaultWatchEvent>, String> {
    check_cap(
        args.mcp_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    if let Err(e) = vault_watch::start(&root) {
        tracing::warn!(error = %e, "vault_watch_recent: start failed");
    }
    Ok(vault_watch::recent(args.prefix.as_deref(), args.since_ms))
}


// SOUL.md (Irisy persistent memory, vault/irisy/SOUL.md) retired to the gate's
// memory-domain tools irisy_soul_get/set (SC5 convergence) — the PWA reaches
// them via gate_invoke, the same governed path external CLI drivers use, so
// vanilla SOUL.md readers (Cursor / Claude Code) stay consistent with CTRL.

// ── Vault root configuration (point CTRL at the user's own Obsidian vault) ──
// The data belongs to the user, so CTRL operates on the vault the user picks
// rather than imposing `~/Documents/CTRL/`. The default is only a fallback until
// the first-run flow points CTRL at the user's existing vault.

#[derive(Debug, Serialize)]
pub struct VaultConfig {
    /// True once the user has explicitly chosen a vault (UI hides the first-run
    /// picker). False = still on the `~/Documents/CTRL/` fallback.
    pub configured: bool,
    /// The resolved vault root currently in effect.
    pub root: String,
    /// Whether the vault is auto-committed to git on a schedule.
    pub auto_sync: bool,
}

#[tauri::command]
pub async fn vault_get_config() -> Result<VaultConfig, String> {
    Ok(VaultConfig {
        configured: vault::is_vault_configured(),
        root: vault::default_vault_root()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        auto_sync: vault::auto_sync_enabled(),
    })
}

#[derive(Debug, Deserialize)]
pub struct AutoSyncArgs {
    pub enabled: bool,
}

#[tauri::command]
pub async fn vault_set_auto_sync(args: AutoSyncArgs) -> Result<(), String> {
    vault::set_auto_sync(args.enabled).map_err(|e| format!("save auto-sync: {e}"))
}

/// PWA reports which note is focused (ADR-002 substrate section 1.9 v46 E2).
/// Tauri-command surface ON PURPOSE (same C3 boundary as review_resolve): the
/// brain reads the active note via the `note_active_get` gate tool but can
/// never FORGE focus — only the UI can set it.
#[tauri::command]
pub async fn set_active_note(
    kernel: tauri::State<'_, crate::shell::kernel_supervisor::KernelHandle>,
    path: Option<String>,
) -> Result<(), String> {
    kernel.runtime.ui_bridge.set_active_note(path);
    Ok(())
}

#[tauri::command]
pub async fn vault_set_root(path: String) -> Result<VaultConfig, String> {
    let p = PathBuf::from(path.trim());
    if !p.is_dir() {
        return Err(format!("not a folder: {}", p.display()));
    }
    vault::set_vault_root(&p).map_err(|e| format!("save vault root: {e}"))?;
    // Reindex against the newly-pointed vault so search/backlinks reflect it.
    if let Err(e) = vault::rebuild_index(&p) {
        tracing::warn!(error = %e, "vault_set_root: reindex failed");
    }
    Ok(VaultConfig {
        configured: true,
        root: p.display().to_string(),
        auto_sync: vault::auto_sync_enabled(),
    })
}
