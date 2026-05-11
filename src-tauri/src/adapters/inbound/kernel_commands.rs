// Kernel-side Tauri commands — bridges frontend kernel-sdk to L1 Rust kernel.
//
// New command surface added in P2.8. Coexists with the legacy command path
// in tauri_commands.rs. Frontend at packages/ctrl-kernel-sdk can route
// through these via @tauri-apps/api invoke().
//
// Commands:
//   mcp_register_server  -> register descriptor (no spawn)
//   mcp_connect          -> spawn + handshake
//   mcp_list_tools       -> tools advertised by connected server
//   mcp_invoke           -> call tool with JSON args
//   mcp_list_installed   -> all registered descriptors
//   mcp_disconnect       -> close connection
//   kernel_health        -> sanity ping returning runtime state

use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource};
use crate::kernel::runtime::KernelRuntime;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

pub struct KernelAppState {
    pub runtime: Arc<KernelRuntime>,
}

#[derive(Debug, Serialize)]
pub struct KernelHealthReport {
    pub ok: bool,
    pub mcp_servers_registered: usize,
    pub note: &'static str,
}

#[tauri::command]
pub async fn kernel_health(
    state: State<'_, KernelAppState>,
) -> Result<KernelHealthReport, String> {
    let installed = state.runtime.mcp_host.list_installed().await;
    Ok(KernelHealthReport {
        ok: true,
        mcp_servers_registered: installed.len(),
        note: "L1 Kernel runtime online. P2.8 stage — scheduler not yet driving traffic.",
    })
}

#[derive(Debug, Deserialize)]
pub struct McpRegisterArgs {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub source: McpServerSource,
}

#[tauri::command]
pub async fn mcp_register_server(
    state: State<'_, KernelAppState>,
    args: McpRegisterArgs,
) -> Result<(), String> {
    let desc = McpServerDescriptor {
        id: args.id,
        name: args.name,
        version: if args.version.is_empty() {
            "0.0.0".into()
        } else {
            args.version
        },
        description: args.description,
        tools: Vec::new(),
        source: args.source,
    };
    state.runtime.mcp_host.register(desc).await;
    Ok(())
}

#[tauri::command]
pub async fn mcp_connect(
    state: State<'_, KernelAppState>,
    server_id: String,
) -> Result<(), String> {
    state
        .runtime
        .mcp_host
        .connect(&server_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_list_tools(
    state: State<'_, KernelAppState>,
    server_id: String,
) -> Result<serde_json::Value, String> {
    let tools = state
        .runtime
        .mcp_host
        .list_tools(&server_id)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(tools).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
pub struct McpInvokeArgs {
    pub server_id: String,
    pub tool_name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

#[tauri::command]
pub async fn mcp_invoke(
    state: State<'_, KernelAppState>,
    args: McpInvokeArgs,
) -> Result<serde_json::Value, String> {
    state
        .runtime
        .mcp_host
        .invoke(&args.server_id, &args.tool_name, args.arguments)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_list_installed(
    state: State<'_, KernelAppState>,
) -> Result<serde_json::Value, String> {
    let installed = state.runtime.mcp_host.list_installed().await;
    serde_json::to_value(installed).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_disconnect(
    state: State<'_, KernelAppState>,
    server_id: String,
) -> Result<(), String> {
    state
        .runtime
        .mcp_host
        .disconnect(&server_id)
        .await
        .map_err(|e| e.to_string())
}
