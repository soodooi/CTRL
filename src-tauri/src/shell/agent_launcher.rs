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
// - kairo (SilverBullet): `silverbullet -L 127.0.0.1 -p <picked> <Notes>`
//   with the shell endpoint + runtime API disabled (the upstream default
//   /.shell endpoint executes arbitrary commands — never expose it).

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
    Webview { url: String, workspace_path: String },
}

#[derive(Debug)]
pub struct LaunchedAgent {
    pub endpoint: AgentEndpoint,
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
    for (k, v) in provider_env {
        cmd.env(k, v);
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
        "webview" => {
            let workspace = ctrl_notes_path()?;
            let port = pick_free_port()?;
            // Security posture verified against SilverBullet 2.8.1 source:
            // /.shell executes arbitrary commands unless disabled; the
            // runtime API auto-launches Chrome; the service worker is
            // unreliable inside WKWebView over plain http://localhost.
            cmd.env("SB_SHELL_BACKEND", "off")
                .env("SB_RUNTIME_API", "0")
                .env("SB_DISABLE_SERVICE_WORKER", "1")
                .args(["-L", "127.0.0.1", "-p", &port.to_string()])
                .arg(&workspace);
            let mut child = cmd.spawn().map_err(|e| anyhow!("spawn agent: {}", e))?;
            // Wait until SilverBullet ACTUALLY serves before handing the URL to
            // the webview — otherwise the iframe loads too early (connection
            // refused → blank Notes pane). The announce line is
            // "SilverBullet is now running: http://...". This also drains
            // stdout via the reader thread so the pipe never fills and stalls
            // the process. Timeout is non-fatal: return the URL anyway so a
            // slow start still wires up once it comes online.
            let _ = wait_for_stdout_line(
                &mut child,
                |l| l.contains("is now running"),
                Duration::from_secs(15),
            );
            Ok(LaunchedAgent {
                endpoint: AgentEndpoint::Webview {
                    url: format!("http://127.0.0.1:{port}/"),
                    workspace_path: workspace,
                },
                child,
            })
        }
        other => Err(anyhow!("unknown endpoint_type: {}", other)),
    }
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
