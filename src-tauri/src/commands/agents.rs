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

use crate::shell::agent_installer::{install, is_installed, AgentName};
use crate::shell::agent_launcher::{launch, AgentEndpoint};
use serde::Serialize;

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
