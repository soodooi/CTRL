// ADR-002 substrate §1 v20 (2026-06-10, H-2026-06-09-002) — 3-agent aggregator.
//
// On-demand launcher for the 3 external agents. No supervisor loop —
// PWA retries on launch_agent failure. Endpoint discovery per agent,
// verified against real upstreams 2026-06-10:
// - opencode: `opencode serve --port <picked> --hostname 127.0.0.1`;
//   announce line on stdout is `opencode server listening on http://...`
//   (the official SDK parses the same line).
// - hermes: ACP stdio server (`hermes-acp` via uvx) — the pipe handle is
//   the endpoint; pid returned for bookkeeping.
// Notes/KB = the user's Obsidian (ADR-002 §1.9 v25), not a launched agent.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use super::agent_installer::{read_manifest, AgentName};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEndpoint {
    HttpPort { port: u16 },
    AcpStdio { pid: u32 },
}

#[derive(Debug)]
pub struct LaunchedAgent {
    pub endpoint: AgentEndpoint,
    #[allow(dead_code)]
    pub child: Child,
}

/// Ask the OS for a free loopback port. The tiny bind/release race window
/// is acceptable for local single-user launches.
fn pick_free_port() -> Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| anyhow!("port probe: {e}"))?;
    Ok(listener.local_addr().map_err(|e| anyhow!("port probe: {e}"))?.port())
}

/// Block until `predicate` matches a stdout line or the deadline passes.
/// The reader thread keeps draining stdout afterwards so the child never
/// blocks on a full pipe.
fn wait_for_stdout_line(
    child: &mut Child,
    predicate: impl Fn(&str) -> bool + Send + 'static,
    deadline: Duration,
) -> Result<String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("agent stdout not piped"))?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut sent = false;
        for line in reader.lines().map_while(|l| l.ok()) {
            if !sent && predicate(&line) {
                let _ = tx.send(line);
                sent = true;
            }
            // keep draining to EOF
        }
    });
    rx.recv_timeout(deadline)
        .map_err(|_| anyhow!("agent did not announce its endpoint within {deadline:?}"))
}

#[allow(dead_code)]
pub fn launch(name: &AgentName) -> Result<LaunchedAgent> {
    launch_with_env(name, &std::collections::BTreeMap::new())
}

/// Launch with a unified provider env injection (ADR-002 §1.3): the
/// caller passes the active CTRL provider's env (ANTHROPIC_API_KEY /
/// OPENAI_API_KEY + BASE_URL) so opencode + hermes use the SAME BYOK
/// config the user picked in CTRL — configure once, every face uses it.
pub fn launch_with_env(
    name: &AgentName,
    provider_env: &std::collections::BTreeMap<String, String>,
) -> Result<LaunchedAgent> {
    // opencode retired (bao 2026-06-25) — unwired; never launch it.
    if matches!(name, AgentName::Opencode) {
        return Err(anyhow!("opencode retired — unwired"));
    }
    let manifest = read_manifest(name)
        .ok_or_else(|| anyhow!("agent not installed — call install_agent first"))?;

    let mut iter = manifest.entry_cmd.iter();
    let program = iter
        .next()
        .ok_or_else(|| anyhow!("manifest.entry_cmd empty"))?;
    let mut rest: Vec<String> = iter.cloned().collect();

    // Stale manifests installed before the --python fix lack the Python pin
    // hermes-agent[acp] needs (>=3.11); inject it so uvx fetches a managed
    // CPython instead of failing on the system Python (3.9 on macOS). Belt
    // for the source fix in agent_installer::install_via_uvx. ADR-002 §1.8.4.
    if program.ends_with("uvx") && !rest.iter().any(|a| a == "--python") {
        rest.splice(
            0..0,
            [
                "--python".to_string(),
                super::agent_installer::HERMES_PYTHON.to_string(),
            ],
        );
    }

    let mut cmd = Command::new(program);
    for a in &rest {
        cmd.arg(a);
    }
    for (k, v) in provider_env {
        cmd.env(k, v);
    }

    // Light up hermes's BUILT-IN web tools for Irisy (ADR-002 § brain: ride
    // hermes's tools, don't rebuild native). hermes-agent ships `web_search`
    // + `web_extract` (fetch + extract a URL) and auto-selects a backend from
    // env (TAVILY_API_KEY / EXA_API_KEY / …). CTRL already holds a Tavily key
    // in the keychain (its own `web_search` uses it), so forward it — Irisy
    // gets web search + data-fetch with zero CTRL-native tool. bao 2026-06-27.
    if matches!(name, AgentName::Hermes) {
        if let Some(key) = crate::kernel::provider::registry::read_credential("tavily") {
            cmd.env("TAVILY_API_KEY", key);
        }
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    match manifest.endpoint_type.as_str() {
        "http-port" => {
            let port = pick_free_port()?;
            cmd.args(["--port", &port.to_string(), "--hostname", "127.0.0.1"]);
            let mut child = cmd.spawn().map_err(|e| anyhow!("spawn agent: {}", e))?;
            // Verified announce format (opencode 1.17 serve.ts):
            //   "opencode server listening on http://127.0.0.1:<port>"
            let line = wait_for_stdout_line(
                &mut child,
                |l| l.contains("listening on"),
                Duration::from_secs(15),
            )?;
            let announced = line
                .rsplit("on ")
                .next()
                .and_then(|url| url.trim().rsplit(':').next())
                .and_then(|p| p.trim_end_matches('/').parse::<u16>().ok())
                .unwrap_or(port);
            Ok(LaunchedAgent {
                endpoint: AgentEndpoint::HttpPort { port: announced },
                child,
            })
        }
        "acp-stdio" => {
            let child = cmd.spawn().map_err(|e| anyhow!("spawn agent: {}", e))?;
            let pid = child.id();
            Ok(LaunchedAgent {
                endpoint: AgentEndpoint::AcpStdio { pid },
                child,
            })
        }
        other => Err(anyhow!("unknown endpoint_type: {}", other)),
    }
}
