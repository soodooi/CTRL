// Kernel commands — mcp CRUD + MCP introspection/invocation.
//
// Sub-PR d: real wire via `tauri::State<KernelHandle>`. Stub data lives in
// a fallback path while the manifest registry + persistence schema lands
// in sub-PR e (which also removes win/ and consolidates the tool registry).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::shell::KernelHandle;

/// Resolve the on-disk mcp directory ($HOME/.ctrl/mcps). Errors out
/// when HOME isn't set — typically a misconfigured CI env, not a user
/// failure mode.
// pub(crate) so the :17873 gate tools (mcp_server.rs mcp_pack_*) resolve the
// same install dir the Tauri commands use (bao 2026-06-25: Irisy installs/uses
// feature packs through the gate).
pub(crate) fn mcp_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
    Ok(PathBuf::from(home).join(".ctrl").join("mcps"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpSummary {
    pub id: String,
    pub name: String,
    pub mcp_color: String,
    pub icon: String,
    // D1 envelope (ADR-001 spine amendment 2026-05-25) — populated from manifest
    // when present. All optional so legacy mcps without these fields
    // continue to render (PWA treats `None` as "field unknown / default").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adjustment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_schema: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<serde_json::Value>,
}

/// Build a McpSummary projection from a parsed manifest JSON value.
/// Defaults keep a manifest missing a field renderable as a card.
fn manifest_to_summary(manifest: &serde_json::Value, id: &str) -> McpSummary {
    let string_field = |key: &str| -> Option<String> {
        manifest
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    // `source` lives under manifest.source.type (per .olym/specs/tool-manifest/spec.md),
    // not at the top level — read both shapes so PWA gets a value either way.
    let source = manifest
        .get("source")
        .and_then(|s| s.get("type"))
        .and_then(|v| v.as_str())
        .or_else(|| manifest.get("source").and_then(|v| v.as_str()))
        .map(|s| s.to_string());
    McpSummary {
        id: id.to_string(),
        name: string_field("name").unwrap_or_else(|| id.to_string()),
        mcp_color: string_field("mcp_color").unwrap_or_else(|| "cobalt".to_string()),
        icon: string_field("icon").unwrap_or_else(|| "◆".to_string()),
        target: string_field("target"),
        source,
        adjustment: string_field("adjustment"),
        config_schema: manifest.get("config_schema").cloned(),
        upstream: manifest.get("upstream").cloned(),
    }
}

/// Scan a mcp directory and return summaries for every well-formed
/// child. Malformed entries (missing manifest.json, bad JSON, missing id)
/// are skipped silently — they'll surface in trace logs but shouldn't
/// crash the keyboard render.
///
/// pub(crate) so kernel::provider::http_endpoint /tool/<name>
/// dispatcher reuses it (ADR-002 substrate § brain v7 §1.1, 2026-06-04).
pub(crate) fn list_installed_in(dir: &Path) -> Vec<McpSummary> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(), // dir doesn't exist yet — fresh install
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let bytes = match fs::read(&manifest_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let manifest: serde_json::Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(?path, error = %e, "skipping mcp with malformed manifest");
                continue;
            }
        };
        let id = match manifest.get("id").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => {
                tracing::warn!(?path, "skipping mcp with missing manifest.id");
                continue;
            }
        };
        out.push(manifest_to_summary(&manifest, &id));
    }
    out
}

#[tauri::command]
pub async fn list_mcps(_kernel: State<'_, KernelHandle>) -> Result<Vec<McpSummary>, String> {
    let dir = mcp_dir()?;
    // Installed mcps only — a fresh install shows an empty Pool/Keyboard
    // until the user installs a mcp.
    Ok(list_installed_in(&dir))
}

#[derive(Debug, Deserialize)]
pub struct InstallMcpArgs {
    /// The validated manifest (Zod-checked PWA side). Must carry a string `id`.
    pub manifest: serde_json::Value,
    /// MCP server source code (TypeScript or Python).
    pub server_code: String,
    /// Filename to write `server_code` under. Restricted to a safe basename.
    pub server_code_filename: String,
}

/// Validate that an id is safe to use as a directory name. Rejects `..`,
/// path separators, empty strings, and over-long values that could hit
/// filesystem limits.
fn validate_mcp_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("manifest.id is empty".into());
    }
    if id.len() > 128 {
        return Err(format!("manifest.id too long ({} > 128)", id.len()));
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("manifest.id contains illegal characters: {id}"));
    }
    // Allow lowercase alphanumerics + `-` + `_` + `.` — the same shape
    // npm / Linux package ids use; rejects spaces and shell-meta.
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(format!("manifest.id has non-alphanumeric chars: {id}"));
    }
    Ok(())
}

/// Reduce a user-supplied filename to a safe basename. Empty / unsafe
/// inputs fall back to `server.ts`.
fn sanitize_server_filename(raw: &str) -> String {
    let basename = raw.rsplit('/').next().unwrap_or("").rsplit('\\').next().unwrap_or("");
    let safe: String = basename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() || safe.starts_with('.') {
        "server.ts".to_string()
    } else {
        safe
    }
}

/// pub(crate) for kernel::provider::http_endpoint /tool/<name>
/// dispatcher reuse (ADR-002 substrate § brain v7 §1.1, 2026-06-04).
pub(crate) fn install_into(
    dir: &Path,
    args: &InstallMcpArgs,
) -> Result<McpSummary, String> {
    let id = args
        .manifest
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "manifest.id missing or not a string".to_string())?
        .to_string();
    validate_mcp_id(&id)?;

    // ECC review C2 (2026-05-30): refuse to write `server_code` for any
    // manifest variant whose runtime executor doesn't exist yet. The
    // historical install_mcp path expected `variant: "mcp-server"`
    // (Pattern D) where `server_code` is a TS file spawned as an MCP
    // server. Pattern G / A / others have no executor for arbitrary user
    // TS today; writing the file would just dead-code it on disk and
    // create a future attack surface when an executor wires up without
    // anyone reading this code path again.
    //
    // Empty server_code is always fine. Non-empty server_code is only
    // accepted when the manifest declares `variant: "mcp-server"` (or
    // the legacy `source.type == "mcp"` shape that pre-dates the v0.2
    // schema migration).
    if !args.server_code.is_empty() {
        let variant = args
            .manifest
            .get("variant")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let source_type = args
            .manifest
            .get("source")
            .and_then(|s| s.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let mcp_shape = variant == "mcp-server" || source_type == "mcp";
        if !mcp_shape {
            return Err(format!(
                "install_mcp refuses non-empty server_code for variant '{variant}' / \
                 source.type '{source_type}' — only Pattern D (variant=mcp-server) has a \
                 runtime executor for arbitrary TS. Submit an empty server_code or \
                 declare a manifest with variant=mcp-server."
            ));
        }
    }

    let target = dir.join(&id);
    fs::create_dir_all(&target).map_err(|e| format!("create dir {target:?}: {e}"))?;

    let manifest_bytes = serde_json::to_vec_pretty(&args.manifest)
        .map_err(|e| format!("serialize manifest: {e}"))?;
    fs::write(target.join("manifest.json"), &manifest_bytes)
        .map_err(|e| format!("write manifest.json: {e}"))?;

    if !args.server_code.is_empty() {
        let server_filename = sanitize_server_filename(&args.server_code_filename);
        fs::write(target.join(&server_filename), &args.server_code)
            .map_err(|e| format!("write {server_filename}: {e}"))?;
    }

    Ok(manifest_to_summary(&args.manifest, &id))
}

#[tauri::command]
pub async fn install_mcp(
    args: InstallMcpArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<McpSummary, String> {
    let dir = mcp_dir()?;
    let summary = install_into(&dir, &args)?;
    tracing::info!(mcp_id = %summary.id, "install_mcp ok");
    Ok(summary)
}

#[derive(Debug, Deserialize)]
pub struct InstallMcpbArgs {
    /// Absolute path to the `.mcpb` bundle on disk.
    pub mcpb_path: String,
}

#[derive(Debug, Serialize)]
pub struct InstallMcpbResult {
    pub summary: McpSummary,
    /// Tool binaries the built-in downloader installed during provision.
    pub provisioned_tools: Vec<String>,
    /// Env keys injected (values omitted — secrets never leave the kernel,
    /// decision 0004).
    pub provisioned_env_keys: Vec<String>,
    /// sha256 of the installed `.mcpb` bundle (ADR-004 §6 integrity floor).
    pub bundle_sha256: String,
}

/// Install a feature pack from a `.mcpb` bundle (Anthropic format — a zip of
/// manifest.json + assets, ADR-002 substrate § composition v21 §7.3):
/// unpack → reuse install_into → copy assets → run provision (toolchain +
/// env/secret inject). Unpack + tool downloads run on a blocking thread.
#[tauri::command]
pub async fn install_mcpb(
    args: InstallMcpbArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<InstallMcpbResult, String> {
    let mcpb_path = PathBuf::from(&args.mcpb_path);
    if !mcpb_path.exists() {
        return Err(format!("mcpb not found: {}", mcpb_path.display()));
    }
    let dir = mcp_dir()?;
    let result = tokio::task::spawn_blocking(move || install_mcpb_blocking(&mcpb_path, &dir))
        .await
        .map_err(|e| format!("install_mcpb task join: {e}"))??;
    tracing::info!(mcp_id = %result.summary.id, "install_mcpb ok");
    Ok(result)
}

/// sha256 of the bundle bytes, hex. The integrity floor (ADR-004 §6 v3):
/// the `.mcpb` spec carries no signature/hash field of its own, so CTRL
/// records what it installed. This closes the "unzip with zero verification"
/// gap and gives a git-diffable on-disk record (`installed.json.bundle_sha256`)
/// a later re-install / update can diff against. It is NOT authorship — the
/// detached-Ed25519 + TOFU layer (researched, ADR-004 §6 v3) adds that next.
fn bundle_sha256(mcpb_path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let bytes = fs::read(mcpb_path).map_err(|e| format!("read mcpb for hashing: {e}"))?;
    let digest = Sha256::digest(&bytes);
    Ok(format!("{digest:x}"))
}

fn install_mcpb_blocking(mcpb_path: &Path, dir: &Path) -> Result<InstallMcpbResult, String> {
    // 0. integrity floor — hash the bundle before we trust anything in it.
    let bundle_sha256 = bundle_sha256(mcpb_path)?;

    // 1. unpack the .mcpb (zip) into a staging dir.
    let staging = dir.join(".mcpb-staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| format!("create staging: {e}"))?;
    let unzip = std::process::Command::new("unzip")
        .arg("-o")
        .arg(mcpb_path)
        .arg("-d")
        .arg(&staging)
        .output()
        .map_err(|e| format!("unzip mcpb (is unzip available?): {e}"))?;
    if !unzip.status.success() {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!(
            "unzip mcpb failed: {}",
            String::from_utf8_lossy(&unzip.stderr)
        ));
    }

    // 2. read + parse manifest.json.
    let manifest_bytes = fs::read(staging.join("manifest.json"))
        .map_err(|e| format!("read manifest.json from mcpb: {e}"))?;
    let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("parse manifest.json: {e}"))?;

    // 3. install (writes manifest into ~/.ctrl/mcps/<id>/) — reuse install_into.
    let install_args = InstallMcpArgs {
        manifest: manifest.clone(),
        server_code: String::new(),
        server_code_filename: String::new(),
    };
    let summary = install_into(dir, &install_args)?;

    // 4. copy bundle assets (everything but manifest.json) into the pack dir.
    let target = dir.join(&summary.id);
    copy_bundle_assets(&staging, &target)?;
    let _ = fs::remove_dir_all(&staging);

    // 4b. record the bundle hash as a git-diffable on-disk pin (ADR-004 §6
    // integrity floor). A later re-install / update diffs against this; the
    // user can `git diff` / `vim` it (plain-text philosophy). Best-effort —
    // a write failure must not abort an otherwise-good install.
    let pin = serde_json::json!({ "bundle_sha256": bundle_sha256 });
    if let Err(e) = fs::write(
        target.join("installed.json"),
        serde_json::to_vec_pretty(&pin).unwrap_or_default(),
    ) {
        tracing::warn!(mcp_id = %summary.id, error = %e, "install_mcpb: failed to write integrity pin");
    }

    // 5. run provision: toolchain install + env/secret injection.
    let provision = crate::shell::provision_runner::run_provision(&summary.id, &manifest)
        .map_err(|e| format!("provision '{}': {e}", summary.id))?;

    Ok(InstallMcpbResult {
        provisioned_tools: provision
            .tool_bins
            .iter()
            .map(|p| p.display().to_string())
            .collect(),
        provisioned_env_keys: provision.env.keys().cloned().collect(),
        summary,
        bundle_sha256,
    })
}

/// Copy every entry under `staging` except manifest.json into `target`.
fn copy_bundle_assets(staging: &Path, target: &Path) -> Result<(), String> {
    for entry in fs::read_dir(staging).map_err(|e| format!("read staging: {e}"))? {
        let entry = entry.map_err(|e| format!("staging entry: {e}"))?;
        if entry.file_name() == "manifest.json" {
            continue;
        }
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy asset: {e}"))?;
        }
    }
    Ok(())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("create {to:?}: {e}"))?;
    for entry in fs::read_dir(from).map_err(|e| format!("read {from:?}: {e}"))? {
        let entry = entry.map_err(|e| format!("entry: {e}"))?;
        let from_p = entry.path();
        let to_p = to.join(entry.file_name());
        if from_p.is_dir() {
            copy_dir_recursive(&from_p, &to_p)?;
        } else {
            fs::copy(&from_p, &to_p).map_err(|e| format!("copy: {e}"))?;
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct RunActionArgs {
    pub mcp_id: String,
    pub action_id: String,
}

/// Execute a feature pack action's shell steps with the pack's provisioned
/// env (tool PATH + {{secret}}-resolved vars from keychain). ADR-002
/// substrate § composition v21 §7.2. Returns concatenated stdout; a failing
/// step surfaces its stdout+stderr as the error (shown in the scene panel).
#[tauri::command]
pub async fn run_action(
    args: RunActionArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<String, String> {
    let dir = mcp_dir()?;
    tokio::task::spawn_blocking(move || run_action_blocking(&dir, &args.mcp_id, &args.action_id))
        .await
        .map_err(|e| format!("run_action task join: {e}"))?
}

// pub(crate) so the gate's mcp_pack_run tool reuses the exact action runner
// (provision + shell steps) the Tauri command uses — no duplicate logic.
pub(crate) fn run_action_blocking(dir: &Path, mcp_id: &str, action_id: &str) -> Result<String, String> {
    let bytes = fs::read(dir.join(mcp_id).join("manifest.json"))
        .map_err(|e| format!("read manifest for '{mcp_id}': {e}"))?;
    let manifest: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse manifest: {e}"))?;

    // Ensure tools + resolve secret env (cheap when already provisioned —
    // each tool's `check` passes and skips reinstall).
    let provision = crate::shell::provision_runner::run_provision(mcp_id, &manifest)
        .map_err(|e| format!("provision '{mcp_id}': {e}"))?;

    let action = manifest
        .get("actions")
        .and_then(|a| a.as_array())
        .and_then(|arr| {
            arr.iter()
                .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(action_id))
        })
        .ok_or_else(|| format!("action '{action_id}' not found in '{mcp_id}'"))?;

    let steps = action
        .get("steps")
        .and_then(|s| s.as_array())
        .ok_or_else(|| format!("action '{action_id}' has no steps"))?;

    let tool_dirs: Vec<String> = provision
        .tool_bins
        .iter()
        .filter_map(|p| p.parent().map(|d| d.display().to_string()))
        .collect();

    // The pack's install root is its single writable scope outside the OS
    // temp dirs (ADR-004 §1 sandbox).
    let pack_dir = dir.join(mcp_id);

    let mut out = String::new();
    let mut ran_any = false;
    for step in steps {
        if step.get("type").and_then(|v| v.as_str()) != Some("shell") {
            continue; // only shell steps execute on run_action's min path
        }
        let command = step
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "shell step missing command".to_string())?;
        ran_any = true;
        out.push_str(&run_shell(command, &provision.env, &tool_dirs, &pack_dir)?);
    }
    if !ran_any {
        return Err(format!(
            "action '{action_id}' has no shell steps (run_action min path)"
        ));
    }
    Ok(out)
}

fn run_shell(
    command: &str,
    env: &std::collections::BTreeMap<String, String>,
    tool_dirs: &[String],
    pack_dir: &Path,
) -> Result<String, String> {
    // A feature-pack shell body is potentially-untrusted third-party code,
    // so it runs inside the OS sandbox (ADR-001 §6 lock #1 + ADR-004 §1):
    // no network, no filesystem write outside the pack dir + OS temp.
    let mut cmd = crate::kernel::pack_sandbox::wrap_shell(command, pack_dir);
    for (k, v) in env {
        cmd.env(k, v);
    }
    if !tool_dirs.is_empty() {
        #[cfg(windows)]
        let sep = ";";
        #[cfg(not(windows))]
        let sep = ":";
        let existing = std::env::var("PATH").unwrap_or_default();
        cmd.env("PATH", format!("{}{}{}", tool_dirs.join(sep), sep, existing));
    }
    let output = cmd.output().map_err(|e| format!("spawn shell: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[derive(Debug, Deserialize)]
pub struct McpInstallArgs {
    /// MCP server source — tells the kernel how to spawn / connect:
    ///   { "kind": "npm",   "package": "@modelcontextprotocol/server-puppeteer", "args": [] }
    ///   { "kind": "pypi",  "package": "mcp-server-fetch", "args": [] }
    ///   { "kind": "local", "command": "/path/to/bin", "args": [] }
    ///   { "kind": "http",  "url": "https://api.example.com/mcp" }
    pub source: crate::kernel::mcp_host::McpServerSource,
    /// Which advertised tool to expose as this mcp (1 tool per mcp).
    pub tool_name: String,
    pub display_name: String,
    pub mcp_color: Option<String>,
    pub icon: Option<String>,
    /// Optional override of the auto-derived id. Generated as
    /// `mcp-<source-hash>-<tool>` when absent.
    pub mcp_id: Option<String>,
    /// Free-form description shown in the mcp details panel.
    pub description: Option<String>,
}

#[tauri::command]
pub async fn install_mcp_from_mcp(
    args: McpInstallArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<McpSummary, String> {
    use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource};

    let host = kernel.runtime.mcp_host.clone();

    // Stable server id derived from the source so a re-install with the
    // same source produces the same entry (no duplicate descriptors after
    // upgrade flow). Hash inputs include kind + identifiers, NOT args.
    let server_id = derive_server_id(&args.source);

    // Server mcp id — either user-supplied or auto-derived. Validated
    // identically to install_mcp's path so the same id-safety rules
    // hold.
    let mcp_id = match args.mcp_id.clone() {
        Some(id) => {
            validate_mcp_id(&id)?;
            id
        }
        None => format!("mcp-{}-{}", server_id.trim_start_matches("mcp-"), slugify(&args.tool_name)),
    };

    // Register descriptor with mcp_host (in-memory) so connect / invoke
    // find the source.
    let descriptor = McpServerDescriptor {
        id: server_id.clone(),
        name: args.display_name.clone(),
        version: "0.0.0".into(), // populated from MCP initialize response (P4).
        description: args.description.clone().unwrap_or_default(),
        tools: Vec::new(), // populated by list_tools below.
        source: args.source.clone(),
    };
    host.register(descriptor.clone()).await;

    // Connect + list_tools to (1) validate the server actually spawns,
    // (2) verify the requested tool exists. Best-effort: http transport
    // isn't wired in this commit, so http installs skip validation and
    // trust the user.
    match args.source {
        McpServerSource::Http { .. } => {}
        _ => {
            let tools = host
                .list_tools(&server_id)
                .await
                .map_err(|e| format!("MCP probe (list_tools) failed: {e}"))?;
            let tool_names: Vec<&str> = tools.iter().map(|t| t.name.as_ref()).collect();
            if !tool_names.iter().any(|n| *n == args.tool_name.as_str()) {
                return Err(format!(
                    "MCP server {server_id:?} does not advertise tool {:?}. Available: {:?}",
                    args.tool_name, tool_names
                ));
            }
        }
    }

    // Persist registry so next boot re-registers without the wizard.
    if let Some(reg_path) = crate::kernel::mcp_host::McpHost::default_registry_path() {
        if let Err(e) = host.save_registry(&reg_path).await {
            tracing::warn!(error = %e, "mcp_host: save_registry failed (continuing — mcp manifest still wrote)");
        }
    }

    // Write a mcp manifest under ~/.ctrl/mcps/<id>/ so list_mcps
    // surfaces the new entry and run_mcp can dispatch via manifest.
    let manifest = serde_json::json!({
        "id": mcp_id,
        "name": args.display_name,
        "version": "0.1.0",
        "description": args.description.clone().unwrap_or_default(),
        "icon": args.icon.clone().unwrap_or_else(|| "◆".into()),
        "mcp_color": args.mcp_color.clone().unwrap_or_else(|| "cobalt".into()),
        "source": {
            "type": "mcp",
            "server_id": server_id,
            "tool_name": args.tool_name,
        },
    });
    let install_args = InstallMcpArgs {
        manifest: manifest.clone(),
        server_code: String::new(),       // MCP-sourced mcps have no local TS server.
        server_code_filename: String::new(),
    };
    let dir = mcp_dir()?;
    let summary = install_into(&dir, &install_args)?;

    tracing::info!(
        mcp_id = %summary.id,
        server_id = %descriptor.id,
        tool = %args.tool_name,
        "install_mcp_from_mcp ok"
    );
    Ok(summary)
}

#[derive(Debug, Deserialize)]
pub struct ConnectRemoteMcpArgs {
    /// mcp id — the sanitized registry server name.
    pub id: String,
    pub name: String,
    /// Remote streamable-http endpoint (the registry server's `remotes[].url`).
    pub url: String,
    /// Optional Authorization header value ("Bearer <token>") when the server
    /// requires auth. Public servers pass null.
    pub auth_header: Option<String>,
    pub description: Option<String>,
}

/// Connect a remote MCP server from the registry (ADR-002 § composition §7.4):
/// register an Http descriptor, connect (validates the endpoint actually
/// responds), list its tools, and persist so it re-registers next boot. Once
/// connected, the gate proxies its tools to the brain (mcp.proxy_list_tools /
/// mcp.proxy_call_tool), so Irisy can call them. Returns the tool names. Same
/// runtime the Obsidian connector uses (mcp_host streamable-http client).
#[tauri::command]
pub async fn connect_remote_mcp(
    args: ConnectRemoteMcpArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<Vec<String>, String> {
    use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource};
    validate_mcp_id(&args.id)?;
    let host = kernel.runtime.mcp_host.clone();
    host.register(McpServerDescriptor {
        id: args.id.clone(),
        name: args.name,
        version: "remote".into(),
        description: args.description.unwrap_or_default(),
        tools: Vec::new(),
        source: McpServerSource::Http {
            url: args.url,
            auth_header: args.auth_header,
        },
    })
    .await;
    host.connect(&args.id)
        .await
        .map_err(|e| format!("connect failed: {e}"))?;
    let tools = host
        .list_tools(&args.id)
        .await
        .map_err(|e| format!("list_tools failed: {e}"))?
        .into_iter()
        .map(|t| t.name.to_string())
        .collect::<Vec<_>>();
    if let Some(reg_path) = crate::kernel::mcp_host::McpHost::default_registry_path() {
        if let Err(e) = host.save_registry(&reg_path).await {
            tracing::warn!(error = %e, "connect_remote_mcp: save_registry failed (continuing)");
        }
    }
    tracing::info!(id = %args.id, tools = tools.len(), "connect_remote_mcp ok");
    Ok(tools)
}

fn derive_server_id(source: &crate::kernel::mcp_host::McpServerSource) -> String {
    use crate::kernel::mcp_host::McpServerSource;
    // Lightweight stable hash via DefaultHasher — collision probability
    // is fine for a per-user registry that holds at most low-hundreds
    // of entries. Avoids pulling sha2 just for cosmetic id strings.
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    match source {
        McpServerSource::Npm { package, .. } => {
            "npm".hash(&mut h);
            package.hash(&mut h);
        }
        McpServerSource::Pypi { package, .. } => {
            "pypi".hash(&mut h);
            package.hash(&mut h);
        }
        McpServerSource::Local { command, .. } => {
            "local".hash(&mut h);
            command.hash(&mut h);
        }
        McpServerSource::Http { url, .. } => {
            "http".hash(&mut h);
            url.hash(&mut h);
        }
    }
    format!("mcp-{:x}", h.finish())
}


#[derive(Debug, Deserialize)]
pub struct RunMcpArgs {
    pub mcp_id: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct RunMcpResult {
    pub output: serde_json::Value,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn run_mcp(
    args: RunMcpArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<RunMcpResult, String> {
    run_mcp_inner(args, &kernel).await
}

/// Tauri-State-free entry point so kernel::provider::http_endpoint
/// /tool/mcp_run can reuse the same body (ADR-002 substrate § brain
/// v7 §1.1 + ADR-005 irisy v4 §7.5, 2026-06-04). Single SSOT for mcp
/// dispatch — Pi-driven invocations publish the same McpInvoked /
/// McpCompleted / McpFailed Ops as user clicks.
pub(crate) async fn run_mcp_inner(
    args: RunMcpArgs,
    kernel: &KernelHandle,
) -> Result<RunMcpResult, String> {
    use crate::kernel::event::{Cell, CellKind, Op, OpKind};

    let started = std::time::Instant::now();
    let stream_id = format!("mcp-{}", args.mcp_id);

    // Publish McpInvoked immediately so the PWA workspace pane sees
    // an event before any work happens.
    kernel.bridge.publish_op(Op {
        kind: OpKind::McpInvoked,
        ts_ms: now_ms(),
        stream_id: Some(stream_id.clone()),
        payload: serde_json::json!({
            "mcp_id": args.mcp_id,
            "input": args.input,
        }),
    });

    // Dispatch: seed LLM-flavored mcps route to the LLM port; anything
    // else falls through to the echo stub until a manifest-driven dispatch
    // path lands.
    let dispatch = classify_mcp(&args.mcp_id);
    let result = match dispatch {
        McpDispatch::TextChat { system } => {
            run_text_chat(kernel, &args, &stream_id, system).await
        }
        McpDispatch::McpInvoke { server_id, tool_name } => {
            run_mcp_invoke(kernel, &args, &stream_id, &server_id, &tool_name).await
        }
        McpDispatch::SkillRun { id, skill } => {
            crate::commands::skills::run_skill(&kernel.bridge, &stream_id, &id, &skill, &args.input)
                .await
        }
        McpDispatch::Stub => Ok(serde_json::json!({
            "stub": true,
            "mcp_id": args.mcp_id,
            "echo_input": args.input,
            "note": "no manifest-driven dispatch yet for this mcp",
        })),
    };

    let duration_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(output) => {
            tracing::info!(
                mcp_id = %args.mcp_id,
                duration_ms,
                "run_mcp ok"
            );
            // ADR-002 v5 §9 smart-table-output — best-effort row append
            // into `notes/mcp-runs/<id>.table.md`. Never blocks the
            // response; errors are warn-logged inside `capture_row`.
            if let Some(root) = crate::kernel::vault::default_vault_root() {
                crate::kernel::mcp_capture::capture_row(
                    &root,
                    &args.mcp_id,
                    &args.input,
                    &output,
                    None,
                    None,
                    None,
                    None,
                );
            }
            kernel.bridge.publish_op(Op {
                kind: OpKind::McpCompleted,
                ts_ms: now_ms(),
                stream_id: Some(stream_id),
                payload: serde_json::json!({
                    "mcp_id": args.mcp_id,
                    "output": output.clone(),
                    "duration_ms": duration_ms,
                }),
            });
            Ok(RunMcpResult { output, duration_ms })
        }
        Err(err_msg) => {
            tracing::error!(
                mcp_id = %args.mcp_id,
                duration_ms,
                error = %err_msg,
                "run_mcp failed"
            );
            // Publish a McpFailed Op AND a LlmResponse cell carrying
            // the error text — the PWA workspace surfaces both, but only
            // the cell content is human-readable inline.
            kernel.bridge.publish_cell(Cell {
                kind: CellKind::LlmResponse,
                ts_ms: now_ms(),
                stream_id: Some(stream_id.clone()),
                payload: serde_json::json!({
                    "delta": format!("\n[error] {err_msg}"),
                    "error": true,
                }),
            });
            kernel.bridge.publish_op(Op {
                kind: OpKind::McpFailed,
                ts_ms: now_ms(),
                stream_id: Some(stream_id),
                payload: serde_json::json!({
                    "mcp_id": args.mcp_id,
                    "error": err_msg.clone(),
                    "duration_ms": duration_ms,
                }),
            });
            Err(err_msg)
        }
    }
}

/// Classify a mcp id into a dispatch path. Installed manifests
/// (~/.ctrl/mcps/<id>/manifest.json) win over the seed lookup so
/// user-installed MCP / builtin mcps take precedence over hardcoded
/// fallbacks.
enum McpDispatch {
    TextChat { system: &'static str },
    McpInvoke { server_id: String, tool_name: String },
    SkillRun { id: String, skill: String },
    Stub,
}

fn classify_mcp(mcp_id: &str) -> McpDispatch {
    if let Some(d) = classify_from_installed_manifest(mcp_id) {
        return d;
    }
    classify_seed(mcp_id)
}

fn classify_from_installed_manifest(mcp_id: &str) -> Option<McpDispatch> {
    let dir = mcp_dir().ok()?;
    let path = dir.join(mcp_id).join("manifest.json");
    let bytes = fs::read(&path).ok()?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let source = manifest.get("source")?;
    let kind = source.get("type").and_then(|v| v.as_str())?;
    match kind {
        "mcp" => {
            let server_id = source.get("server_id").and_then(|v| v.as_str())?.to_string();
            let tool_name = source.get("tool_name").and_then(|v| v.as_str())?.to_string();
            if server_id.is_empty() || tool_name.is_empty() {
                return None;
            }
            Some(McpDispatch::McpInvoke { server_id, tool_name })
        }
        "skill" => {
            // Local skill name — the active brain CLI runs it natively. This is
            // the supported run model (cc-switch-native); a skill source with
            // only a remote `upstream` and no local `skill` isn't runnable yet.
            let skill = source
                .get("skill")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if skill.is_empty() {
                return None;
            }
            Some(McpDispatch::SkillRun {
                id: mcp_id.to_string(),
                skill,
            })
        }
        _ => None,
    }
}

fn classify_seed(mcp_id: &str) -> McpDispatch {
    match mcp_id {
        "ctrl-chat" => McpDispatch::TextChat {
            system: "You are CTRL, a concise AI assistant inside a desktop launcher. \
                     Reply in the user's language. Keep answers terse and useful.",
        },
        "clipboard-ai" => McpDispatch::TextChat {
            system: "You are CTRL's clipboard rewriter. Take the user's input text and \
                     rewrite it for clarity, tone, and grammar without changing meaning. \
                     Reply with the rewritten text only — no preamble.",
        },
        "ai-translate" => McpDispatch::TextChat {
            system: "You are CTRL's translator. Detect the source language of the user's \
                     input and translate it to the other of {English, Chinese} (whichever \
                     it is NOT). Reply with the translation only.",
        },
        "ai-text" => McpDispatch::TextChat {
            system: "You are CTRL's text processor. Help the user transform, summarize, \
                     or restructure their input. Be concise.",
        },
        _ => McpDispatch::Stub,
    }
}

/// Run a text.chat dispatch: pull text from input, call the LLM port's
/// primary adapter with streaming, publish each chunk as a LlmResponse
/// cell on `mcp-<id>`, return accumulated content as the output.
async fn run_text_chat(
    kernel: &KernelHandle,
    args: &RunMcpArgs,
    stream_id: &str,
    system: &'static str,
) -> Result<serde_json::Value, String> {
    use crate::kernel::event::{Cell, CellKind};
    use crate::kernel::provider::{LlmMessage, LlmPrompt};

    let runtime = &kernel.runtime;
    let adapter = runtime
        .provider_registry
        .primary_text_chat()
        .ok_or_else(|| {
            "No text.chat provider available. Open Settings → Brain to pick a provider \
             (Claude Pro via CLI, Volc, Kimi, DeepSeek, Anthropic API key, OpenAI API key)."
                .to_string()
        })?;

    // Accept either input.text (simple shape PWA Irisy sends) or
    // input.messages (full multi-turn). The text shape gets wrapped as
    // a single user turn.
    let user_text = args
        .input
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let messages: Vec<LlmMessage> = if let Some(arr) = args.input.get("messages").and_then(|v| v.as_array()) {
        arr.iter()
            .filter_map(|m| {
                let role = m.get("role")?.as_str()?.to_string();
                let content = m.get("content")?.as_str()?.to_string();
                Some(LlmMessage { role, content })
            })
            .collect()
    } else if !user_text.is_empty() {
        vec![LlmMessage {
            role: "user".into(),
            content: user_text,
        }]
    } else {
        return Err("input must include either `text` (string) or `messages` (array)".into());
    };

    if messages.is_empty() {
        return Err("input.messages is empty after parsing".into());
    }

    let prompt = LlmPrompt {
        system: Some(system.to_string()),
        messages,
        temperature: None,
        max_tokens: None,
    };

    let opts = crate::kernel::provider::ChatOpts {
        model: String::new(),
        deadline_ms: 30_000,
    };
    let mut rx = adapter
        .chat_stream(&prompt, &opts)
        .await
        .map_err(|e| format!("llm chat_stream failed: {e}"))?;

    let mut accumulated = String::new();
    while let Some(item) = rx.recv().await {
        match item {
            Ok(chunk) => {
                if !chunk.delta.is_empty() {
                    accumulated.push_str(&chunk.delta);
                    kernel.bridge.publish_cell(Cell {
                        kind: CellKind::LlmResponse,
                        ts_ms: now_ms(),
                        stream_id: Some(stream_id.to_string()),
                        payload: serde_json::json!({
                            "delta": chunk.delta,
                            "done": false,
                        }),
                    });
                }
                if chunk.finish_reason.is_some() {
                    break;
                }
            }
            Err(e) => return Err(format!("llm stream error: {e}")),
        }
    }

    // Publish a final done cell so the PWA can stop spinners.
    kernel.bridge.publish_cell(Cell {
        kind: CellKind::LlmResponse,
        ts_ms: now_ms(),
        stream_id: Some(stream_id.to_string()),
        payload: serde_json::json!({
            "delta": "",
            "done": true,
        }),
    });

    Ok(serde_json::json!({
        "content": accumulated,
        "adapter": adapter.id(),
    }))
}

/// Run an MCP-dispatch mcp: forward input directly to the connected
/// MCP server's `tool_name`, publish the JSON result as an
/// `McpToolResult` cell so the workspace pane can render it. The mcp_host
/// connects lazily on first invoke; subsequent presses on the same
/// mcp reuse the spawned child.
async fn run_mcp_invoke(
    kernel: &KernelHandle,
    args: &RunMcpArgs,
    stream_id: &str,
    server_id: &str,
    tool_name: &str,
) -> Result<serde_json::Value, String> {
    use crate::kernel::event::{Cell, CellKind};

    let host = kernel.runtime.mcp_host.clone();
    let invoke_args = args.input.clone();
    let result = host
        .invoke(server_id, tool_name, invoke_args)
        .await
        .map_err(|e| format!("mcp invoke failed (server={server_id}, tool={tool_name}): {e}"))?;

    kernel.bridge.publish_cell(Cell {
        kind: CellKind::McpToolResult,
        ts_ms: now_ms(),
        stream_id: Some(stream_id.to_string()),
        payload: serde_json::json!({
            "server_id": server_id,
            "tool_name": tool_name,
            "result": result,
        }),
    });

    Ok(result)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
pub struct McpCallArgs {
    /// Either the stable server_id from the descriptor registry, or
    /// `server_url` kept as a back-compat alias (PWA hasn't migrated
    /// yet; both names route through the same lookup).
    #[serde(alias = "server_url")]
    pub server_id: String,
    pub tool_name: String,
    pub args: serde_json::Value,
}

#[tauri::command]
pub async fn mcp_call(
    args: McpCallArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<serde_json::Value, String> {
    kernel
        .runtime
        .mcp_host
        .invoke(&args.server_id, &args.tool_name, args.args)
        .await
        .map_err(|e| format!("mcp_call failed: {e}"))
}

#[tauri::command]
pub async fn list_mcp_servers(
    kernel: State<'_, KernelHandle>,
) -> Result<Vec<crate::kernel::mcp_host::McpServerDescriptor>, String> {
    Ok(kernel.runtime.mcp_host.list_installed().await)
}

/// Open the dedicated workspace window for a mcp activation.
///
/// Per bao 2026-05-14 directive: the workspace is a SECOND window separate
/// from the launcher pool. PWA pool.tsx handleActivate calls this on every
/// mcp click; the workspace window navigates to /workspace?mcp_id=...
/// and is shown / focused. Closing the workspace doesn't quit the app.
#[tauri::command]
pub async fn open_workspace(mcp_id: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::shell::WindowController::open_workspace(&app, &mcp_id).map_err(|e| e.to_string())
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

// ── Irisy lifecycle commands (Config / Debug / Improvement / Retire) ──

#[derive(Debug, Deserialize)]
pub struct UninstallMcpArgs {
    pub mcp_id: String,
}

/// Remove an installed mcp's on-disk directory. Surfacing an error on
/// "already gone" (instead of silent no-op) lets Irisy give the user a
/// clear "X was not installed" reply rather than pretending success.
#[tauri::command]
pub async fn uninstall_mcp(
    args: UninstallMcpArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<(), String> {
    validate_mcp_id(&args.mcp_id)?;
    let dir = mcp_dir()?;
    let target = dir.join(&args.mcp_id);
    if !target.exists() {
        return Err(format!("mcp {} not installed", args.mcp_id));
    }
    fs::remove_dir_all(&target).map_err(|e| format!("remove {target:?}: {e}"))?;
    tracing::info!(mcp_id = %args.mcp_id, "uninstall_mcp ok");
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ReadMcpManifestArgs {
    pub mcp_id: String,
}

/// Return the parsed manifest.json for an installed mcp so Irisy can
/// inspect declared config schemas, source bindings, and metadata when
/// answering debug / improvement questions.
#[tauri::command]
pub async fn read_mcp_manifest(
    args: ReadMcpManifestArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<serde_json::Value, String> {
    validate_mcp_id(&args.mcp_id)?;
    let dir = mcp_dir()?;
    let path = dir.join(&args.mcp_id).join("manifest.json");
    let bytes = fs::read(&path).map_err(|e| format!("read {path:?}: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("parse manifest.json: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetMcpConfigArgs {
    pub mcp_id: String,
    /// Free-form JSON object that REPLACES the previous config override.
    /// Pass `{}` to clear all overrides.
    pub config: serde_json::Value,
}

/// Write the per-user override config for a mcp. Dispatch reads this
/// alongside the upstream manifest at run_mcp time (Config tier of
/// the 3-tier adjustment model: Config / Patch / Fork).
#[tauri::command]
pub async fn set_mcp_config(
    args: SetMcpConfigArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<(), String> {
    validate_mcp_id(&args.mcp_id)?;
    if !args.config.is_object() {
        return Err("config must be a JSON object".into());
    }
    let dir = mcp_dir()?;
    let target = dir.join(&args.mcp_id);
    if !target.exists() {
        return Err(format!("mcp {} not installed", args.mcp_id));
    }
    let path = target.join("config.json");
    let body = serde_json::to_vec_pretty(&args.config)
        .map_err(|e| format!("serialize config: {e}"))?;
    fs::write(&path, &body).map_err(|e| format!("write {path:?}: {e}"))?;
    tracing::info!(mcp_id = %args.mcp_id, "set_mcp_config ok");
    Ok(())
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
        p.push(format!("ctrl-mcps-test-{label}-{pid}-{nanos}"));
        p
    }

    #[test]
    fn validate_mcp_id_rejects_path_traversal() {
        assert!(validate_mcp_id("").is_err());
        assert!(validate_mcp_id("..").is_err());
        assert!(validate_mcp_id("../etc").is_err());
        assert!(validate_mcp_id("foo/bar").is_err());
        assert!(validate_mcp_id("foo\\bar").is_err());
        assert!(validate_mcp_id("name with space").is_err());
        assert!(validate_mcp_id("clipboard-ai").is_ok());
        assert!(validate_mcp_id("ctrl.builtin.text-chat").is_ok());
    }

    #[test]
    fn sanitize_server_filename_drops_paths_and_falls_back() {
        assert_eq!(sanitize_server_filename(""), "server.ts");
        assert_eq!(sanitize_server_filename(".."), "server.ts");
        assert_eq!(sanitize_server_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_server_filename("server.py"), "server.py");
        assert_eq!(sanitize_server_filename("ok name.ts"), "okname.ts");
    }

    #[test]
    fn install_then_list_roundtrip() {
        let dir = fresh_tmp("roundtrip");
        let manifest = serde_json::json!({
            "id": "test-mcp",
            "name": "Test Mcp",
            "icon": "T",
            "mcp_color": "amber",
            "version": "0.1.0",
            // ECC review C2: server_code with non-mcp variant is now refused.
            // The test passes server_code so declare a variant the gate
            // accepts.
            "variant": "mcp-server",
        });
        let args = InstallMcpArgs {
            manifest: manifest.clone(),
            server_code: "// noop\n".to_string(),
            server_code_filename: "server.ts".to_string(),
        };
        let summary = install_into(&dir, &args).expect("install ok");
        assert_eq!(summary.id, "test-mcp");
        assert_eq!(summary.name, "Test Mcp");
        assert_eq!(summary.mcp_color, "amber");

        let listed = list_installed_in(&dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "test-mcp");

        // Verify files actually landed.
        let mcp_path = dir.join("test-mcp");
        assert!(mcp_path.join("manifest.json").exists());
        assert!(mcp_path.join("server.ts").exists());

        // Cleanup so we don't leave temp dirs.
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_rejects_dangerous_id() {
        let dir = fresh_tmp("dangerous");
        let manifest = serde_json::json!({
            "id": "../escaped",
            "name": "Evil",
        });
        let args = InstallMcpArgs {
            manifest,
            server_code: String::new(),
            server_code_filename: "server.ts".to_string(),
        };
        let err = install_into(&dir, &args).unwrap_err();
        assert!(err.contains("illegal"), "expected illegal-chars error, got: {err}");
    }

    #[test]
    fn list_installed_skips_malformed_dirs() {
        let dir = fresh_tmp("malformed");
        fs::create_dir_all(&dir).unwrap();
        // Empty dir (no manifest)
        fs::create_dir_all(dir.join("no-manifest")).unwrap();
        // Malformed JSON
        fs::create_dir_all(dir.join("bad-json")).unwrap();
        fs::write(dir.join("bad-json/manifest.json"), b"not valid json").unwrap();
        // Missing id
        fs::create_dir_all(dir.join("no-id")).unwrap();
        fs::write(
            dir.join("no-id/manifest.json"),
            b"{\"name\":\"orphan\"}",
        )
        .unwrap();

        let listed = list_installed_in(&dir);
        assert_eq!(listed.len(), 0, "all three are malformed; expected empty");

        let _ = fs::remove_dir_all(&dir);
    }
}
