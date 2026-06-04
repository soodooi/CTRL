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
// keycap can write where in a follow-up commit. Today every keycap shares the
// vault root; isolation lands when manifest-declared capability scopes do.

use crate::kernel::capability::{CapToken, CapabilityBroker};
use crate::kernel::capability_resolver;
use crate::kernel::vault::{self, VaultEntry, VaultError};
use crate::kernel::vault_graph::{
    self, BacklinkHit, BrokenLink, GraphData, MentionHit, TagCount,
};
use crate::kernel::vault_sourcing::{self, SourcingRunReport};
use crate::kernel::vault_watch::{self, EventEntry as VaultWatchEvent};
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

// ---------------------------------------------------------------------
// Graph endpoints (§8.3 #9-15)
// ---------------------------------------------------------------------
// All graph queries require VaultRead "" (whole vault) because the
// scanner walks every `.md` file. Per memory
// `decision_vault_adr_002_section_8`, the graph is a derivative — the
// scanner runs on demand and the result lives only in the caller's
// reply payload (no static cache yet — see vault_graph.rs § scan).

#[derive(Debug, Deserialize)]
pub struct VaultGraphQueryArgs {
    pub path: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[tauri::command]
pub async fn vault_backlinks(args: VaultGraphQueryArgs) -> Result<Vec<BacklinkHit>, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    let graph = vault_graph::scan(&root).map_err(|e| e.to_string())?;
    Ok(graph.backlinks_of(&args.path))
}

#[derive(Debug, Deserialize)]
pub struct VaultEmptyArgs {
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[tauri::command]
pub async fn vault_tags(args: VaultEmptyArgs) -> Result<Vec<TagCount>, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    let graph = vault_graph::scan(&root).map_err(|e| e.to_string())?;
    Ok(graph.tags())
}

#[derive(Debug, Deserialize)]
pub struct VaultNotesByTagArgs {
    pub tag: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[tauri::command]
pub async fn vault_notes_by_tag(
    args: VaultNotesByTagArgs,
) -> Result<Vec<String>, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    let graph = vault_graph::scan(&root).map_err(|e| e.to_string())?;
    Ok(graph.notes_by_tag(&args.tag))
}

#[derive(Debug, Deserialize)]
pub struct VaultMentionsArgs {
    pub text: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[tauri::command]
pub async fn vault_mentions(args: VaultMentionsArgs) -> Result<Vec<MentionHit>, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    let graph = vault_graph::scan(&root).map_err(|e| e.to_string())?;
    Ok(graph.mentions_of(&args.text))
}

#[tauri::command]
pub async fn vault_orphans(args: VaultEmptyArgs) -> Result<Vec<String>, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    let graph = vault_graph::scan(&root).map_err(|e| e.to_string())?;
    Ok(graph.orphans())
}

#[tauri::command]
pub async fn vault_broken_links(args: VaultEmptyArgs) -> Result<Vec<BrokenLink>, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    let graph = vault_graph::scan(&root).map_err(|e| e.to_string())?;
    Ok(graph.broken_links())
}

#[tauri::command]
pub async fn vault_graph_data(args: VaultEmptyArgs) -> Result<GraphData, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: String::new(),
        },
    )?;
    let root = vault_root()?;
    let graph = vault_graph::scan(&root).map_err(|e| e.to_string())?;
    Ok(graph.graph_data())
}

// ---------------------------------------------------------------------
// Mutation endpoints (§8.3 #16-20)
// ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct VaultRenameArgs {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

/// Move (or rename) a markdown file inside the vault. The kernel does
/// NOT rewrite inbound wikilinks — that's a UX concern (kairo prompts
/// the user; Irisy can offer batch-fix later). Frontend/Irisy can
/// follow up with `vault_backlinks(from)` and chained writes if desired.
#[tauri::command]
pub async fn vault_rename(args: VaultRenameArgs) -> Result<(), String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultWrite {
            path_glob: args.to.clone(),
        },
    )?;
    rename_inner(&args.from, &args.to)
}

/// `vault_move` is an explicit alias of `vault_rename` — same semantics,
/// distinct command surfaced for clarity in MCP tool listings (Irisy
/// "move sourcing item to notes/" reads better than "rename").
#[tauri::command]
pub async fn vault_move(args: VaultRenameArgs) -> Result<(), String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultWrite {
            path_glob: args.to.clone(),
        },
    )?;
    rename_inner(&args.from, &args.to)
}

fn rename_inner(from: &str, to: &str) -> Result<(), String> {
    let root = vault_root()?;
    let entry = vault::read(&root, from).map_err(stringify_vault_error)?;
    vault::write(&root, to, &entry.content, &entry.frontmatter)
        .map_err(stringify_vault_error)?;
    vault::delete(&root, from).map_err(stringify_vault_error)?;
    tracing::info!(from = %from, to = %to, "vault_rename ok");
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct VaultCreateFolderArgs {
    pub path: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

/// Create an empty subdirectory under the vault root. Idempotent —
/// existing directories are not an error (matches `mkdir -p`).
#[tauri::command]
pub async fn vault_create_folder(args: VaultCreateFolderArgs) -> Result<(), String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultWrite {
            path_glob: args.path.clone(),
        },
    )?;
    let root = vault_root()?;
    let safe = vault::sanitize_relative_path(&args.path).map_err(stringify_vault_error)?;
    std::fs::create_dir_all(root.join(&safe))
        .map_err(|e| format!("create_folder: {e}"))?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct VaultSetStarredArgs {
    pub path: String,
    pub starred: bool,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

/// Toggle the `starred:` frontmatter scalar. Implemented as
/// read-modify-write at the kernel level so the FTS5 index and
/// graph stay coherent (the rewritten file naturally re-upserts
/// on the `vault::write` path).
#[tauri::command]
pub async fn vault_set_starred(args: VaultSetStarredArgs) -> Result<(), String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultWrite {
            path_glob: args.path.clone(),
        },
    )?;
    let root = vault_root()?;
    let entry = vault::read(&root, &args.path).map_err(stringify_vault_error)?;
    let mut fm = entry.frontmatter;
    match fm {
        serde_json::Value::Object(ref mut map) => {
            map.insert("starred".to_string(), serde_json::Value::Bool(args.starred));
        }
        _ => {
            fm = serde_json::json!({ "starred": args.starred });
        }
    }
    vault::write(&root, &args.path, &entry.content, &fm).map_err(stringify_vault_error)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct VaultAliasesArgs {
    pub path: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

/// Read frontmatter `aliases:` for a note. Empty list when none set or
/// when the value isn't an array of strings. Surfaces wikilink
/// alternates without forcing the caller to re-parse frontmatter.
#[tauri::command]
pub async fn vault_aliases(args: VaultAliasesArgs) -> Result<Vec<String>, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: args.path.clone(),
        },
    )?;
    let root = vault_root()?;
    let entry = vault::read(&root, &args.path).map_err(stringify_vault_error)?;
    let list = entry
        .frontmatter
        .get("aliases")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    Ok(list)
}

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
    pub keycap_id: Option<String>,
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
        args.keycap_id.as_deref(),
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

// ---------------------------------------------------------------------
// Sourcing routine (§8.4 — feature-layer kernel seed)
// ---------------------------------------------------------------------
// The richer Irisy LLM-backed routine writes to the same review-queue
// file; this command guarantees the loop works before Irisy attaches.

#[derive(Debug, Deserialize)]
pub struct VaultSourcingRunArgs {
    /// `YYYY-MM-DD` date for the review-queue file. Frontend passes the
    /// local-tz "today" — kernel-side cron passes the UTC date.
    pub date: String,
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[tauri::command]
pub async fn vault_sourcing_run(
    args: VaultSourcingRunArgs,
) -> Result<SourcingRunReport, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultWrite {
            path_glob: ".ctrl/review-queue/".to_string(),
        },
    )?;
    let root = vault_root()?;
    vault_sourcing::run(&root, &args.date).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
pub struct VaultSourcingPendingReply {
    pub count: usize,
}

#[tauri::command]
pub async fn vault_sourcing_pending(
    args: VaultEmptyArgs,
) -> Result<VaultSourcingPendingReply, String> {
    check_cap(
        args.keycap_id.as_deref(),
        &CapToken::VaultRead {
            path_glob: "sourcing/".to_string(),
        },
    )?;
    let root = vault_root()?;
    Ok(VaultSourcingPendingReply {
        count: vault_sourcing::count_pending(&root),
    })
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
