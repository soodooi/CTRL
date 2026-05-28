// Brain switcher Tauri commands (ADR-021).
//
// Surface for the `/settings/brain` Settings UI:
//   - brain_list    → registry of brain candidates (defaults + user
//                     overrides), each with detected $PATH state, active
//                     flag, and reachability.
//   - brain_detect  → re-run `which <command>` for every brain entry.
//                     Returns the same shape as brain_list.
//   - brain_set_active → persist the chosen brain id to
//                        `~/.ctrl/active-brain`.
//
// `irisy_chat_stream` reads the active id every turn from
// `kernel::brain_config::active_brain_id`; setting it here is enough to
// switch — no daemon restart needed for the routing decision itself.

use crate::kernel::brain_config::{self, BrainEntry};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct BrainView {
    pub id: String,
    pub label: String,
    pub command: String,
    pub mcp_port: Option<u16>,
    pub mcp_url: Option<String>,
    pub description: String,
    pub adapter: Option<String>,
    /// Resolved absolute path of `command` on the user's $PATH. `None`
    /// when the binary is not installed (UI greys the radio).
    pub binary_path: Option<String>,
    /// Version string reported by `<command> --version`, when the
    /// binary exists and exits 0 with parseable output.
    pub version: Option<String>,
    /// True when `<healthz_url>` returns 200 within probe timeout.
    /// Lets the UI show "running" vs "binary present but not serving".
    pub reachable: bool,
    /// Whether this brain is currently selected as the active one.
    pub active: bool,
    /// True iff a CTRL-shipped MCP adapter exists for this brain (Pi
    /// in v1; others scaffold the UI but can't be activated yet).
    pub adapter_available: bool,
}

#[derive(Debug, Serialize)]
pub struct BrainListReply {
    pub brains: Vec<BrainView>,
    pub active_id: String,
}

#[derive(Debug, Deserialize)]
pub struct BrainSetActiveArgs {
    pub id: String,
}

#[tauri::command]
pub async fn brain_list() -> Result<BrainListReply, String> {
    inspect_registry(brain_config::load(), brain_config::active_brain_id()).await
}

#[tauri::command]
pub async fn brain_detect() -> Result<BrainListReply, String> {
    // Detect re-uses load() — both reflect disk truth. The split exists
    // so a future "force-rescan" can short-circuit caching if we add any.
    inspect_registry(brain_config::load(), brain_config::active_brain_id()).await
}

#[tauri::command]
pub async fn brain_set_active(args: BrainSetActiveArgs) -> Result<BrainListReply, String> {
    let id = args.id.trim().to_string();
    if id.is_empty() {
        return Err("brain id cannot be empty".to_string());
    }
    let brains = brain_config::load();
    let target = brains.iter().find(|b| b.id == id).ok_or_else(|| {
        format!(
            "unknown brain id {id:?}; known: {}",
            brains
                .iter()
                .map(|b| b.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;
    if target.adapter.is_none() {
        return Err(format!(
            "brain {id:?} has no shipped MCP adapter yet; pick one with an adapter or wait for the next release"
        ));
    }
    brain_config::set_active_brain(&id).map_err(|e| format!("failed to persist active brain: {e}"))?;
    inspect_registry(brains, id).await
}

async fn inspect_registry(
    brains: Vec<BrainEntry>,
    active_id: String,
) -> Result<BrainListReply, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .map_err(|e| format!("reqwest client build failed: {e}"))?;

    let mut out: Vec<BrainView> = Vec::with_capacity(brains.len());
    for entry in brains.into_iter() {
        let binary_path = which_binary(&entry.command);
        let version = match &binary_path {
            Some(path) => probe_version(path).await,
            None => None,
        };
        let reachable = match entry.healthz_url() {
            Some(url) => probe_healthz(&client, &url).await,
            None => false,
        };
        let adapter_available = entry.adapter.is_some();
        let mcp_url = entry.mcp_url();
        out.push(BrainView {
            active: entry.id == active_id,
            id: entry.id,
            label: entry.label,
            command: entry.command,
            mcp_port: entry.mcp_port,
            mcp_url,
            description: entry.description,
            adapter: entry.adapter,
            binary_path,
            version,
            reachable,
            adapter_available,
        });
    }
    Ok(BrainListReply {
        brains: out,
        active_id,
    })
}

fn which_binary(command: &str) -> Option<String> {
    let path_env = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_env) {
        let candidate = dir.join(command);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}

async fn probe_version(binary_path: &str) -> Option<String> {
    use tokio::process::Command;
    let output = Command::new(binary_path)
        .arg("--version")
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            None
        } else {
            Some(stderr)
        }
    } else {
        Some(stdout)
    }
}

async fn probe_healthz(client: &reqwest::Client, url: &str) -> bool {
    match client.get(url).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}
