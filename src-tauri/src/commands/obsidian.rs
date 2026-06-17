// Obsidian Local REST API connector (ADR-002 substrate §1.9.1).
//
// The Obsidian "Local REST API" community plugin ships its own MCP server at
// https://127.0.0.1:<port>/mcp/ (bearer-authed). We detect it (token from the
// vault's plugin data) and register that MCP endpoint on the kernel MCP bus
// (:17873 host side) via mcp_host's HTTP transport, so Irisy/hermes reach the
// user's REAL Obsidian vault — read / search / operate-on-active-note / run any
// plugin command. Optional, opt-in tier: when Obsidian isn't running this stays
// absent and Irisy falls back to the baseline kernel notes-MCP over the folder.
//
// NOTE (verification): the detection + token read + registration are unit-safe;
// the live MCP round-trip requires a machine running Obsidian + this plugin and
// has NOT been verified here. The plugin's /mcp/ is expected to speak Streamable
// HTTP (GET-SSE + POST); if it uses the older HTTP+SSE shape this connector
// needs a transport-variant tweak.

use serde::Serialize;
use tauri::State;

use crate::shell::KernelHandle;

const DEFAULT_HTTPS_PORT: u16 = 27124;

#[derive(Debug, Serialize)]
pub struct ObsidianStatus {
    pub plugin_data_found: bool,
    pub has_token: bool,
    pub mcp_url: Option<String>,
}

fn notes_vault_dir() -> Option<std::path::PathBuf> {
    let base = directories::BaseDirs::new()?;
    Some(base.home_dir().join("Documents").join("CTRL").join("Notes"))
}

/// Read the Local REST API plugin's `data.json` from the CTRL Notes vault and
/// return (apiKey, https port). None if the plugin isn't installed there. The
/// token is the USER'S own credential (lives in their vault), never a CTRL one.
fn read_plugin_config() -> Option<(String, u16)> {
    let path = notes_vault_dir()?
        .join(".obsidian")
        .join("plugins")
        .join("obsidian-local-rest-api")
        .join("data.json");
    let body = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let key = v.get("apiKey")?.as_str()?.to_string();
    let port = v
        .get("port")
        .and_then(|p| p.as_u64())
        .map(|p| p as u16)
        .unwrap_or(DEFAULT_HTTPS_PORT);
    Some((key, port))
}

/// Build the Authorization header value from the user's own plugin token.
fn authorization_value(token: &str) -> String {
    let mut v = String::from("Bearer ");
    v.push_str(token);
    v
}

/// Detect whether the Obsidian Local REST API plugin is set up for the CTRL
/// Notes vault (surfaces onboarding state; does not connect).
#[tauri::command]
pub async fn obsidian_status() -> Result<ObsidianStatus, String> {
    match read_plugin_config() {
        Some((key, port)) => Ok(ObsidianStatus {
            plugin_data_found: true,
            has_token: !key.is_empty(),
            mcp_url: Some(format!("https://127.0.0.1:{port}/mcp/")),
        }),
        None => Ok(ObsidianStatus {
            plugin_data_found: false,
            has_token: false,
            mcp_url: None,
        }),
    }
}

#[derive(Debug, Serialize)]
pub struct ObsidianConnected {
    pub server_id: String,
    pub tools: Vec<String>,
}

/// Register the Obsidian Local REST API MCP server on the kernel bus and
/// connect (ADR-002 §1.9.1). Idempotent at the mcp_host layer.
#[tauri::command]
pub async fn obsidian_connect(
    kernel: State<'_, KernelHandle>,
) -> Result<ObsidianConnected, String> {
    use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource};

    let (key, port) = read_plugin_config().ok_or_else(|| {
        "Obsidian Local REST API plugin not found for the CTRL Notes vault — install it \
         in Obsidian and open ~/Documents/CTRL/Notes as a vault"
            .to_string()
    })?;
    if key.is_empty() {
        return Err("Obsidian Local REST API token is empty — set it in Obsidian → Local REST API".into());
    }

    let server_id = "obsidian".to_string();
    let host = kernel.runtime.mcp_host.clone();
    host.register(McpServerDescriptor {
        id: server_id.clone(),
        name: "Obsidian".to_string(),
        version: "local-rest-api".to_string(),
        description: "User's Obsidian vault via Local REST API (ADR-002 §1.9.1)".to_string(),
        tools: Vec::new(),
        source: McpServerSource::Http {
            url: format!("https://127.0.0.1:{port}/mcp/"),
            auth_header: Some(authorization_value(&key)),
        },
    })
    .await;
    host.connect(&server_id).await.map_err(|e| e.to_string())?;
    let tools = host
        .list_tools(&server_id)
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|t| t.name.to_string())
        .collect();

    Ok(ObsidianConnected { server_id, tools })
}
