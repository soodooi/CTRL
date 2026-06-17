// Kernel ACP client — drives hermes (the assistant brain) over the Agent
// Client Protocol (ADR-002 substrate §1.8). Newline-delimited JSON-RPC 2.0
// on stdio: initialize -> session/new -> session/prompt, streaming the
// agent_message_chunk text back to the caller via an on_delta callback.
//
// Design (§1.8.1 single door):
// - ONE persistent hermes-acp process + ONE ACP session, reused across turns
//   (held in the `singleton()` Mutex). Only the first prompt pays uvx/plugin
//   startup (~7s); later turns are warm.
// - Single-tasked: prompts serialize through the Mutex, and one read loop on
//   the calling task handles notifications + answers agent->client requests
//   inline, so no concurrent reader is needed (mirrors the JS probe).
// - Verified end-to-end by scripts/probes/hermes-acp-probe.mjs (2026-06-17).
//
// MCP-bus passthrough (§1.8.2): `session/new` passes CTRL's :17873 bus as the
// agent's MCP server (build_mcp_servers), so hermes reaches the FULL CTRL tool
// surface — Notes / clipboard / OCR / provider router (fal.ai image/video) /
// Obsidian (via mcp.proxy_*) / skills — through the single ACP door. This is how
// the functions ACP itself scopes out (messaging/cron) are supplied by CTRL's
// own layers instead of hermes's upgrade-fragile internal protocol.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

/// Per-line read budget — covers uvx cold start + first-token model latency.
const READ_TIMEOUT: Duration = Duration::from_secs(180);

pub struct AcpClient {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    session_id: String,
    next_id: i64,
    /// Whether the CTRL capability preamble has been sent this session (§1.8.2).
    primed: bool,
}

/// One-time capability brief prepended to the first turn so hermes KNOWS it can
/// drive CTRL's tools (the user's notes / Obsidian vault are reachable via the
/// `ctrl` MCP server passed in session/new) instead of answering from its own
/// memory (ADR-002 substrate §1.8.2 v23). Concise so it doesn't fight SOUL.md.
const CTRL_CAPABILITY_BRIEF: &str = "\
[CTRL context — you are Irisy, the user's assistant inside CTRL. The `ctrl` MCP \
server (already connected) gives you tools to read / write / search the user's \
notes and Obsidian vault at ~/Documents/CTRL/Notes (vault.* tools), plus \
clipboard, OCR and image/video generation. When the user asks about their notes, \
Obsidian, or knowledge, USE these tools — do not answer from memory alone.]";

/// Process-wide persistent client. `None` until the first turn starts it;
/// reset to `None` on any error so the next turn restarts cleanly.
pub fn singleton() -> &'static Mutex<Option<AcpClient>> {
    static ACP: OnceLock<Mutex<Option<AcpClient>>> = OnceLock::new();
    ACP.get_or_init(|| Mutex::new(None))
}

/// Best-effort kill of the persistent hermes-acp process at app shutdown
/// (RunEvent::ExitRequested with an explicit code). try_lock so a turn in
/// flight never blocks exit; the OS reclaims the child either way.
pub fn shutdown() {
    if let Ok(mut g) = singleton().try_lock() {
        if let Some(mut c) = g.take() {
            let _ = c.child.start_kill();
        }
    }
}

fn notes_dir() -> Result<PathBuf> {
    let base = directories::BaseDirs::new().ok_or_else(|| anyhow!("home dir"))?;
    let p = base.home_dir().join("Documents").join("CTRL").join("Notes");
    std::fs::create_dir_all(&p).context("create Notes dir")?;
    Ok(p)
}

/// MCP-bus passthrough (ADR-002 §1.8.2): expose CTRL's kernel MCP server
/// (:17873, streamable-http + bearer) to hermes so the 3 faces (MCP / API /
/// Skills) reach the agent. Gated on the kernel having published its port +
/// token (set by kernel_supervisor); absent in unit tests -> no passthrough.
fn build_mcp_servers() -> Vec<Value> {
    let token = match std::env::var("CTRL_KERNEL_MCP_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => return Vec::new(),
    };
    let port = std::env::var("CTRL_KERNEL_MCP_PORT").unwrap_or_else(|_| "17873".to_string());
    vec![json!({
        "type": "http",
        "name": "ctrl",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "headers": [{ "name": "Authorization", "value": format!("Bearer {token}") }]
    })]
}

impl AcpClient {
    /// Spawn hermes-acp, handshake (initialize), and open one ACP session.
    /// `provider_env` is the active CTRL BYOK provider env (ADR-002 §1.3);
    /// hermes also reads its own ~/.hermes/.env.
    pub async fn start(provider_env: &BTreeMap<String, String>) -> Result<Self> {
        use crate::shell::agent_installer::{read_manifest, AgentName, HERMES_PYTHON};
        let manifest =
            read_manifest(&AgentName::Hermes).ok_or_else(|| anyhow!("hermes not installed"))?;
        let mut argv = manifest.entry_cmd.clone();
        if argv.is_empty() {
            return Err(anyhow!("hermes manifest.entry_cmd empty"));
        }
        // Stale manifests lack the Python pin hermes-agent[acp] needs (>=3.11);
        // inject it so uvx fetches a managed CPython (see agent_installer).
        if argv[0].ends_with("uvx") && !argv.iter().any(|a| a == "--python") {
            argv.splice(1..1, ["--python".to_string(), HERMES_PYTHON.to_string()]);
        }

        // Mirror CTRL's active provider into ~/.hermes/.env BEFORE spawn —
        // hermes reads it at startup, not from process env (ADR-002 §1.3).
        // Merge, never clobber; no managed key -> file untouched.
        let _ = crate::commands::agents::write_hermes_dotenv(provider_env);

        let cwd = notes_dir()?;
        let mut cmd = Command::new(&argv[0]);
        cmd.args(&argv[1..]);
        for (k, v) in provider_env {
            cmd.env(k, v);
        }
        cmd.current_dir(&cwd);
        // stdout = JSON-RPC wire (clean); hermes logs go to stderr → discard
        // so the pipe can't fill. kill_on_drop ties the child to this struct.
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);

        let mut child = cmd.spawn().context("spawn hermes-acp")?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let mut s = AcpClient {
            child,
            stdin,
            reader: BufReader::new(stdout),
            session_id: String::new(),
            next_id: 0,
            primed: false,
        };

        let mut noop = |_: &str| {};
        s.request(
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false } }
            }),
            &mut noop,
        )
        .await
        .context("ACP initialize")?;

        // §1.8.2: try with the MCP-bus passthrough; if hermes rejects the
        // entry (format / transport), retry WITHOUT it so the agent still runs
        // (worst case = no CTRL tools, never a disabled hermes).
        let mcp_servers = build_mcp_servers();
        let had_mcp = !mcp_servers.is_empty();
        let cwd_str = cwd.to_string_lossy().to_string();
        let ns = match s
            .request(
                "session/new",
                json!({ "cwd": cwd_str, "mcpServers": mcp_servers }),
                &mut noop,
            )
            .await
        {
            Ok(v) => v,
            Err(e) if had_mcp => {
                eprintln!("[acp] session/new with MCP passthrough failed ({e}); retrying without tools");
                s.request(
                    "session/new",
                    json!({ "cwd": cwd_str, "mcpServers": [] }),
                    &mut noop,
                )
                .await
                .context("ACP session/new")?
            }
            Err(e) => return Err(e.context("ACP session/new")),
        };
        s.session_id = ns
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("session/new returned no sessionId"))?
            .to_string();
        Ok(s)
    }

    /// Run one prompt turn; `on_delta` receives streamed text as it arrives.
    /// Returns the ACP stopReason.
    pub async fn prompt(
        &mut self,
        text: &str,
        mut on_delta: impl FnMut(&str) + Send,
    ) -> Result<String> {
        let sid = self.session_id.clone();
        // Prime the first turn with the CTRL capability brief so hermes knows it
        // can drive the user's notes / Obsidian via the bus tools (§1.8.2).
        let turn_text = if self.primed {
            text.to_string()
        } else {
            self.primed = true;
            format!("{CTRL_CAPABILITY_BRIEF}\n\n{text}")
        };
        let res = self
            .request(
                "session/prompt",
                json!({ "sessionId": sid, "prompt": [{ "type": "text", "text": turn_text }] }),
                &mut on_delta,
            )
            .await?;
        Ok(res
            .get("stopReason")
            .and_then(|v| v.as_str())
            .unwrap_or("end_turn")
            .to_string())
    }

    async fn write_msg(&mut self, v: &Value) -> Result<()> {
        let mut line = serde_json::to_string(v)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    /// Send a JSON-RPC request, then pump stdout until its response arrives,
    /// streaming agent_message_chunk text to `on_delta` and answering any
    /// agent->client requests (permission / fs) minimally so the turn never
    /// stalls.
    async fn request(
        &mut self,
        method: &str,
        params: Value,
        on_delta: &mut (dyn FnMut(&str) + Send),
    ) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        self.write_msg(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;

        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(READ_TIMEOUT, self.reader.read_line(&mut line))
                .await
                .map_err(|_| anyhow!("hermes-acp read timed out"))??;
            if n == 0 {
                return Err(anyhow!("hermes-acp closed stdout"));
            }
            let line = line.trim();
            if !line.starts_with('{') {
                continue;
            }
            let v: Value = match serde_json::from_str(line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            // Response to our request?
            if v.get("id").and_then(|i| i.as_i64()) == Some(id)
                && (v.get("result").is_some() || v.get("error").is_some())
            {
                if let Some(err) = v.get("error") {
                    return Err(anyhow!("ACP error: {err}"));
                }
                return Ok(v.get("result").cloned().unwrap_or(Value::Null));
            }

            // session/update notification → stream chunk text.
            if v.get("method").and_then(|m| m.as_str()) == Some("session/update") {
                if let Some(u) = v.get("params").and_then(|p| p.get("update")) {
                    if u.get("sessionUpdate").and_then(|s| s.as_str()) == Some("agent_message_chunk")
                    {
                        if let Some(t) = u
                            .get("content")
                            .and_then(|c| c.get("text"))
                            .and_then(|t| t.as_str())
                        {
                            on_delta(t);
                        }
                    }
                }
                continue;
            }

            // Agent → client request (id + method) → minimal reply.
            if let (Some(req_id), Some(req_method)) = (
                v.get("id").and_then(|i| i.as_i64()),
                v.get("method").and_then(|m| m.as_str()),
            ) {
                let result = if req_method == "session/request_permission" {
                    json!({ "outcome": { "outcome": "cancelled" } })
                } else if req_method == "fs/read_text_file" {
                    json!({ "content": "" })
                } else {
                    Value::Null
                };
                self.write_msg(&json!({ "jsonrpc": "2.0", "id": req_id, "result": result }))
                    .await?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real end-to-end: spawn hermes-acp via the kernel client, run one
    /// streamed prompt turn. Network + uvx + a configured hermes provider.
    /// Run: `cargo test acp_smoke -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn acp_smoke() {
        let env = BTreeMap::new();
        let mut client = AcpClient::start(&env).await.expect("start hermes-acp");
        let mut answer = String::new();
        let stop = client
            .prompt("Reply with exactly: ACP OK", |d| answer.push_str(d))
            .await
            .expect("prompt turn");
        println!("\nANSWER: {answer:?}  stopReason={stop}");
        assert!(!answer.trim().is_empty(), "no streamed text from hermes");
    }
}
