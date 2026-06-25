// Vault Tauri commands — PWA-facing surface for the vault capability.
//
// (ADR-002 substrate § vault v1 §8.3, 2026-06-01 — memory
// `decision_vault_adr_002_section_8` — kernel exposes 21 primitive
// endpoints; Daily Note / Sourcing routines live at the feature layer.)
//
// Per CLAUDE.md design philosophy:
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


// ── SOUL.md surface (ADR-005 irisy v2 § soul-md-compat §4.3) ──────────
//
// Single-file persistent memory for Irisy lives at `vault/irisy/SOUL.md`,
// shape per github.com/aaronjmars/soul.md. PWA + external MCP agents both
// read/write through this surface so vanilla SOUL.md readers (Cursor /
// Claude Code / OpenClaw companions) stay consistent with CTRL.

const SOUL_REL_PATH: &str = "irisy/SOUL.md";

#[derive(Debug, Serialize)]
pub struct IrisySoulView {
    pub path: String,
    pub frontmatter: serde_json::Value,
    pub body: String,
    pub soul_md_version: String,
}

#[tauri::command]
pub async fn irisy_soul_read() -> Result<IrisySoulView, String> {
    let root = vault_root()?;
    let entry = vault::read(&root, SOUL_REL_PATH)
        .map_err(|e| format!("irisy_soul_read: {e}"))?;
    let pin_path = root.join("irisy/.soul-md-version");
    let pin = std::fs::read_to_string(&pin_path)
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(IrisySoulView {
        path: entry.path,
        frontmatter: entry.frontmatter,
        body: entry.content,
        soul_md_version: pin,
    })
}

#[derive(Debug, Deserialize)]
pub struct IrisySoulWriteArgs {
    pub frontmatter: serde_json::Value,
    pub body: String,
}

#[tauri::command]
pub async fn irisy_soul_write(args: IrisySoulWriteArgs) -> Result<(), String> {
    let root = vault_root()?;
    vault::write(&root, SOUL_REL_PATH, &args.body, &args.frontmatter)
        .map_err(|e| format!("irisy_soul_write: {e}"))?;
    Ok(())
}
