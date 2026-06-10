// ADR-002 substrate §1 v19 (2026-06-09, H-2026-06-09-002) — 3-agent aggregator.
//
// On-demand launcher for the 3 external agents. No supervisor loop —
// PWA retries on launch_agent failure. Each launch spawns the entry_cmd
// from the agent's manifest, parses the endpoint (port from stdout for
// opencode, stdio pipe handle for hermes, webview URL for kairo), and
// returns the endpoint descriptor to the caller.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};

use super::agent_installer::{read_manifest, AgentName};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEndpoint {
    HttpPort { port: u16 },
    McpStdio { pid: u32 },
    Webview { workspace_path: String },
}

#[derive(Debug)]
pub struct LaunchedAgent {
    pub endpoint: AgentEndpoint,
    pub child: Child,
}

pub fn launch(name: &AgentName) -> Result<LaunchedAgent> {
    let manifest = read_manifest(name)
        .ok_or_else(|| anyhow!("agent not installed — call install_agent first"))?;

    let mut iter = manifest.entry_cmd.iter();
    let program = iter
        .next()
        .ok_or_else(|| anyhow!("manifest.entry_cmd empty"))?;
    let args: Vec<&String> = iter.collect();

    let mut cmd = Command::new(program);
    for a in args {
        cmd.arg(a);
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let child = cmd.spawn().map_err(|e| anyhow!("spawn agent: {}", e))?;
    let pid = child.id();

    // Endpoint discovery — TODO: per-agent stdout parsing. opencode prints
    // "Listening on http://127.0.0.1:<port>"; hermes inherits stdio so the
    // pipe handle IS the endpoint; kairo opens its own window and we point
    // a webview at workspace_path. For the initial wire we return the PID
    // and let PWA's per-agent client do the protocol-specific handshake.
    let endpoint = match manifest.endpoint_type.as_str() {
        "http-port" => AgentEndpoint::HttpPort { port: 0 },
        "mcp-stdio" => AgentEndpoint::McpStdio { pid },
        "webview" => AgentEndpoint::Webview {
            workspace_path: ctrl_notes_path()?,
        },
        other => return Err(anyhow!("unknown endpoint_type: {}", other)),
    };

    Ok(LaunchedAgent { endpoint, child })
}

fn ctrl_notes_path() -> Result<String> {
    let base = directories::BaseDirs::new().ok_or_else(|| anyhow!("home_dir"))?;
    let path = base
        .home_dir()
        .join("Documents")
        .join("CTRL")
        .join("Notes");
    std::fs::create_dir_all(&path).map_err(|e| anyhow!("create Notes dir: {}", e))?;
    Ok(path.display().to_string())
}
