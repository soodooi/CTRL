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
