// Kernel commands — keycap CRUD + MCP introspection/invocation.
//
// Skeleton stage. Sub-PR c connects each to `crate::kernel::*` modules.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct KeycapSummary {
    pub id: String,
    pub name: String,
    pub keycap_color: String,
    pub icon: String,
}

#[tauri::command]
pub async fn list_keycaps() -> Result<Vec<KeycapSummary>, String> {
    // sub-PR c: read from kernel persistence + manifest registry.
    Ok(Vec::new())
}

#[derive(Debug, Deserialize)]
pub struct McpInstallArgs {
    pub server_url: String,
    pub tool_name: String,
    pub display_name: String,
    pub keycap_color: Option<String>,
    pub icon: Option<String>,
}

#[tauri::command]
pub async fn install_keycap_from_mcp(args: McpInstallArgs) -> Result<KeycapSummary, String> {
    // sub-PR c: kernel::mcp_host::list_tools + derive manifest + persist.
    Err(format!(
        "install_keycap_from_mcp not implemented yet (would install {}/{})",
        args.server_url, args.tool_name
    ))
}

#[derive(Debug, Deserialize)]
pub struct RunKeycapArgs {
    pub keycap_id: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct RunKeycapResult {
    pub output: serde_json::Value,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn run_keycap(args: RunKeycapArgs) -> Result<RunKeycapResult, String> {
    // sub-PR c: route to kernel::scheduler::run_actor + Effect dispatch.
    Err(format!("run_keycap not implemented yet (id={})", args.keycap_id))
}

#[derive(Debug, Deserialize)]
pub struct McpCallArgs {
    pub server_url: String,
    pub tool_name: String,
    pub args: serde_json::Value,
}

#[tauri::command]
pub async fn mcp_call(args: McpCallArgs) -> Result<serde_json::Value, String> {
    // sub-PR c: kernel::mcp_host::invoke + capability check.
    Err(format!(
        "mcp_call not implemented yet (server={}, tool={})",
        args.server_url, args.tool_name
    ))
}

#[tauri::command]
pub async fn list_mcp_servers() -> Result<Vec<String>, String> {
    // sub-PR c: read kernel::mcp_host::list_servers + cache.
    Ok(Vec::new())
}
