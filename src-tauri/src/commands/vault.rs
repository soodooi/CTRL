// Vault Tauri commands — PWA-facing surface for the vault capability.
//
// Per CLAUDE.md design philosophy:
//   - All paths are relative to vault root (portable, machine-independent)
//   - Frontmatter is JSON over the wire; vault module renders/parses YAML on disk
//   - No "export" command — files are on disk, vim / Obsidian / Finder open them
//
// Capability gating (kernel::capability::CapabilityBroker) will mediate which
// keycap can write where in a follow-up commit. Today every keycap shares the
// vault root; isolation lands when manifest-declared capability scopes do.

use crate::kernel::capability::{CapToken, CapabilityBroker};
use crate::kernel::capability_resolver;
use crate::kernel::vault::{self, VaultEntry, VaultError};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn vault_root() -> Result<PathBuf, String> {
    vault::default_vault_root().ok_or_else(|| "HOME env var not set".to_string())
}

/// Resolve the caller's capability + check the required token. Absent
/// keycap_id falls back to "ctrl-system" (full-access) so Settings UI /
/// first-run wizard / debug calls keep working without manifest setup.
fn check_cap(keycap_id: Option<&str>, required: &CapToken) -> Result<(), String> {
    let id = keycap_id.unwrap_or("ctrl-system");
    let cap = capability_resolver::resolve_for_keycap(id);
    let broker = CapabilityBroker::new();
    broker.check(&cap, required).map_err(|e| {
        tracing::warn!(keycap_id = %id, token = ?required, error = %e, "vault: capability check rejected");
        format!("capability denied for keycap {id:?}: {e}")
    })
}

#[derive(Debug, Deserialize)]
pub struct VaultWriteArgs {
    /// Relative path under the vault root (e.g. "notes/2026-05-22/hello.md").
    pub path: String,
    /// Markdown body (frontmatter block is added automatically — don't
    /// include `---` framing yourself).
    pub content: String,
    /// JSON object that becomes the YAML frontmatter block. Must be an
    /// object; nested objects + scalar arrays are supported.
    pub frontmatter: serde_json::Value,
    /// Calling keycap's id. When present, the broker checks that this
    /// keycap holds a `VaultWrite { path_glob }` token whose prefix
    /// matches `path`. Absent = "ctrl-system" full-access (Settings /
    /// first-run / debug).
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VaultWriteReply {
    /// Absolute on-disk path of the written file (for logging / debug).
    pub absolute_path: String,
    /// Relative path under the vault root (the canonical reference).
    pub path: String,
}

#[tauri::command]
pub async fn vault_write(args: VaultWriteArgs) -> Result<VaultWriteReply, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultWrite {
            path_glob: args.path.clone(),
        },
    )?;
    let root = vault_root()?;
    let written = vault::write(&root, &args.path, &args.content, &args.frontmatter)
        .map_err(stringify_vault_error)?;
    tracing::info!(path = %args.path, "vault_write ok");
    Ok(VaultWriteReply {
        absolute_path: written.display().to_string(),
        path: args.path,
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
    pub keycap_id: Option<String>,
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
        args.keycap_id.as_deref(),
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

#[derive(Debug, Deserialize)]
pub struct VaultReadArgs {
    pub path: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[tauri::command]
pub async fn vault_read(args: VaultReadArgs) -> Result<VaultEntry, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: args.path.clone(),
        },
    )?;
    let root = vault_root()?;
    vault::read(&root, &args.path).map_err(stringify_vault_error)
}

#[derive(Debug, Deserialize)]
pub struct VaultListArgs {
    /// Optional subdirectory under the vault root; absent = whole vault.
    pub subdir: Option<String>,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[tauri::command]
pub async fn vault_list(args: VaultListArgs) -> Result<Vec<String>, String> {
    // List requires read on the subdir (or whole vault root if absent).
    let probe_path = args.subdir.clone().unwrap_or_default();
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: probe_path,
        },
    )?;
    let root = vault_root()?;
    vault::list(&root, args.subdir.as_deref()).map_err(stringify_vault_error)
}

#[derive(Debug, Deserialize)]
pub struct VaultSearchArgs {
    pub query: String,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

fn default_search_limit() -> usize {
    50
}

#[tauri::command]
pub async fn vault_search(args: VaultSearchArgs) -> Result<Vec<String>, String> {
    // Search reads the whole vault; require VaultRead "*".
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    vault::search(&root, &args.query, args.limit).map_err(stringify_vault_error)
}

#[derive(Debug, Deserialize)]
pub struct VaultDeleteArgs {
    pub path: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[tauri::command]
pub async fn vault_delete(args: VaultDeleteArgs) -> Result<(), String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultWrite {
            path_glob: args.path.clone(),
        },
    )?;
    let root = vault_root()?;
    vault::delete(&root, &args.path).map_err(stringify_vault_error)
}

/// Resolved vault root path — Settings UI shows this so the user knows
/// where their files live (and can `cd` to it in a terminal).
#[tauri::command]
pub async fn vault_root_path() -> Result<String, String> {
    Ok(vault_root()?.display().to_string())
}

/// Wipe the FTS5 index and rebuild from every `.md` file in the vault.
/// Useful after the user edited files in vim / Obsidian (bypassing
/// CTRL's write path) — the index would be out of sync until next
/// rebuild. Returns the number of files indexed.
#[tauri::command]
pub async fn vault_rebuild_index() -> Result<usize, String> {
    let root = vault_root()?;
    vault::rebuild_index(&root).map_err(stringify_vault_error)
}

fn stringify_vault_error(e: VaultError) -> String {
    e.to_string()
}
