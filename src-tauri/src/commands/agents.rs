// ADR-002 substrate §1 v19 (2026-06-09, H-2026-06-09-002) — 3-agent aggregator.
//
// Tauri commands surfacing agent_installer + agent_launcher to the PWA.
// PWA flow:
//   onboarding → install_agent(name) for hermes / opencode / kairo in parallel
//   route mount → launch_agent(name) returns endpoint descriptor
//   route unmount → stop_agent(name)
//
// No supervise — PWA owns retry on errors. Agents installed once, launched
// per-PWA-session, stopped when the PWA route unmounts.

use crate::shell::agent_installer::{install, is_installed, read_manifest, AgentName};
use crate::shell::agent_launcher::{launch, AgentEndpoint};
use crate::shell::KernelHandle;
use serde::Serialize;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub name: String,
    pub version: String,
    pub install_at: String,
    pub already_installed: bool,
}

#[tauri::command]
pub async fn install_agent(name: String, force: Option<bool>) -> Result<InstallResult, String> {
    let agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    let already = is_installed(&agent) && !force.unwrap_or(false);
    let manifest = install(agent, force.unwrap_or(false)).map_err(|e| e.to_string())?;
    Ok(InstallResult {
        name: manifest.name,
        version: manifest.version,
        install_at: manifest.install_at,
        already_installed: already,
    })
}

#[tauri::command]
pub async fn launch_agent(name: String) -> Result<AgentEndpoint, String> {
    let agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    // The child handle is dropped here; on Unix the child inherits SIGHUP
    // and is reaped when the parent exits. For long-lived launches we'll
    // hold the handle in a process registry, but for the initial wire we
    // surface the endpoint and let the PWA own the lifecycle.
    let launched = launch(&agent).map_err(|e| e.to_string())?;
    Ok(launched.endpoint)
}

#[tauri::command]
pub async fn stop_agent(name: String) -> Result<(), String> {
    let _agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    // Process registry to stop a specific launch is TODO — PWA can kill the
    // window which cascades SIGHUP to the agent subprocess. Returning Ok
    // here keeps the command surface stable until the registry lands.
    Ok(())
}

#[tauri::command]
pub async fn agent_status(name: String) -> Result<bool, String> {
    let agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    Ok(is_installed(&agent))
}

#[derive(Debug, Serialize)]
pub struct ConnectedAgentMcp {
    pub server_id: String,
    pub tools: Vec<String>,
}

/// Connect an mcp-stdio agent (hermes) to the kernel MCP bus per
/// ADR-002 substrate §1 v19 (2026-06-09) §1.3 — the MCP bus is one of
/// the four things the kernel owns. mcp_host spawns and owns the stdio
/// child; the PWA then chats via the existing `mcp_call` command.
/// Idempotent: re-registering the same descriptor and re-connecting an
/// already-connected server are both no-ops at the mcp_host layer.
#[tauri::command]
pub async fn connect_agent_mcp(
    name: String,
    kernel: State<'_, KernelHandle>,
) -> Result<ConnectedAgentMcp, String> {
    use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource};

    let agent = AgentName::from_str(&name).map_err(|e| e.to_string())?;
    let manifest = read_manifest(&agent)
        .ok_or_else(|| format!("agent {} not installed — call install_agent first", name))?;
    if manifest.endpoint_type != "mcp-stdio" {
        return Err(format!(
            "agent {} endpoint_type is {} — only mcp-stdio agents connect to the MCP bus",
            name, manifest.endpoint_type
        ));
    }

    let mut iter = manifest.entry_cmd.iter();
    let command = iter
        .next()
        .cloned()
        .ok_or_else(|| format!("agent {} manifest entry_cmd is empty", name))?;
    let args: Vec<String> = iter.cloned().collect();

    let server_id = format!("agent-{}", agent.as_str());
    let host = kernel.runtime.mcp_host.clone();
    host.register(McpServerDescriptor {
        id: server_id.clone(),
        name: agent.as_str().to_string(),
        version: manifest.version.clone(),
        description: format!("{} agent (3-agent aggregator)", agent.as_str()),
        tools: Vec::new(),
        source: McpServerSource::Local { command, args },
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

    Ok(ConnectedAgentMcp { server_id, tools })
}

#[tauri::command]
pub async fn list_agents() -> Result<Vec<String>, String> {
    Ok(["hermes", "opencode", "kairo"]
        .iter()
        .filter(|n| {
            AgentName::from_str(n)
                .map(|a| is_installed(&a))
                .unwrap_or(false)
        })
        .map(|s| s.to_string())
        .collect())
}
