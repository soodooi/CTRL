// irisy_chat_stream — Irisy → Pi brain MCP → stream back.
//
// ADR-002 substrate: Pi is the sole brain. Every Irisy turn goes through the
// `@ctrl/pi-plugin` MCP server (`ctrl-pi-mcp` on 127.0.0.1:17874) — no
// `active-brain` branch, no LLM-port fallback. The Pi process inside
// the plugin loads the `@ctrl/pi-bridge` extension at spawn so its LLM
// calls go back through the kernel provider sub-system (ADR-002 substrate § provider v2).
//
// Contract (mirrors chat_stream's wire so the PWA's ChatStreamTransport
// works unchanged):
//   invoke('irisy_chat_stream', { args: { request_id, messages, model?,
//                                          temperature?, max_tokens? } })
//   listen('chat-stream-delta', payload => { request_id, delta, done, error? })
//
// Wire format (Pi plugin SSE):
//   event: delta
//   data: {"delta": "<token>"}
//
//   event: done
//   data: {"jsonrpc":"2.0","id":...,"result":{"content":[...],...}}
//
//   event: error
//   data: {"message":"..."}
//
// Errors surface specific causes (not infinite spinner):
//   - "Pi brain not started (supervisor: <last_error>)" — supervisor
//     hasn't spawned the child yet or install failed
//   - "Pi brain not reachable at <url>: <io error>" — TCP connect /
//     connection-refused
//   - "Pi brain stalled (no chunk in 5 s)" — connected but provider
//     dropped the stream
//
// "BrainRouter inline" per ADR-001 spine amendment (2026-05-25): the lookup
// is a ≤100-LOC helper inside this command, not a separate substrate
// module.

use std::time::Duration;

use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::time::timeout;

use crate::commands::chat::MessageWire;
use crate::shell::KernelHandle;

/// The Pi brain MCP server's loopback endpoint. Matches the default in
/// `@ctrl/pi-plugin`'s mcp-server.ts (port 17874).
const PI_BRAIN_MCP_URL: &str = "http://127.0.0.1:17874/mcp";

/// Hard ceiling on time we wait for the first SSE chunk after a
/// successful POST. Past this, we assume the provider is stalled and
/// surface a specific error instead of an infinite spinner.
const FIRST_CHUNK_DEADLINE: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize)]
pub struct IrisyChatStreamArgs {
    pub request_id: String,
    pub messages: Vec<MessageWire>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    // bao 2026-06-04 (3-mode P0): cap = a "hat" Pi wears for one turn.
    // When `skill_id` is set, the kernel loads the matching SKILL.md
    // (via `list_local_skills`) and prepends it as a system message so
    // Pi operates under that skill for this turn. No subprocess spawn,
    // no claude-CLI detour — same text.chat path Irisy already uses.
    #[serde(default)]
    pub skill_id: Option<String>,
    // Pi 3-mode session hint ("assistant" | "coding" | "cap"). Currently
    // informational — `skill_id.is_some()` is the de-facto cap-mode
    // signal. Reserved for v2.x history scope + workdir routing.
    #[serde(default)]
    pub mode: Option<String>,
    // Coding-mode project directory (Pi's cwd). Reserved for v2.x.
    #[serde(default)]
    pub project_dir: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct StreamDelta {
    request_id: String,
    delta: String,
    done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    // ADR-009 P3 — when Pi emits a role=custom message (slash command
    // intent, e.g. /discover, /switch), the MCP server relays it as
    // SSE `event:custom`. We forward the same payload to PWA through
    // the existing chat-stream-delta event so the chat hook stays one
    // listener instead of two.
    #[serde(skip_serializing_if = "Option::is_none")]
    custom: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn irisy_chat_stream(
    args: IrisyChatStreamArgs,
    _kernel: State<'_, KernelHandle>,
    app: AppHandle,
) -> Result<(), String> {
    // Fail-fast surface: if the supervisor knows the brain isn't up,
    // surface its specific reason instead of a 5 s TCP timeout.
    if let Some(reason) = crate::shell::brain_supervisor::last_error() {
        let request_id = args.request_id.clone();
        let app_clone = app.clone();
        let msg = format!("Pi brain not started: {reason}");
        tokio::spawn(async move {
            emit_done(&app_clone, &request_id, Some(msg));
        });
        return Ok(());
    }

    let request_id = args.request_id.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        if let Err(e) = forward_to_brain(&app_clone, &request_id, args).await {
            emit_done(&app_clone, &request_id, Some(e));
        }
    });

    Ok(())
}

/// Load the SKILL.md body for a given skill id (the user-facing cap name).
/// Reuses `list_local_skills` so the discovery rules (~/.claude/skills/ +
/// plugin caches) stay in one place — bao 2026-06-04 (`feedback_no_redundancy_one_ssot`).
/// Returns `None` if the skill is not found or the SKILL.md cannot be read;
/// the caller falls back to the default (no system prompt) so Irisy still
/// works when a stale skill_id is passed.
async fn load_skill_system_prompt(skill_id: &str) -> Option<String> {
    let skills =
        crate::commands::skills::list_local_skills(Some(skill_id.to_string()))
            .await
            .ok()?;
    let skill = skills.into_iter().find(|s| s.name == skill_id)?;
    std::fs::read_to_string(&skill.path).ok()
}

/// Build the mode-specific system header prepended to every Pi turn so
/// the agent knows which session mode it is in and (for `coding`) which
/// directory it should treat as cwd. We do NOT restart the Pi process
/// to change cwd — that would be a heavy supervisor handshake for a
/// signal Pi can already read from prompt context. Per Pi philosophy
/// ("No MCP. Build CLI tools with READMEs.") the agent reads this hint
/// and uses its built-in shell tool to cd as needed.
fn build_mode_system_header(mode: Option<&str>, project_dir: Option<&str>) -> Option<String> {
    let mode = mode.unwrap_or("personal");
    match mode {
        "coding" => {
            let dir = project_dir.unwrap_or("~");
            Some(format!(
                "You are operating in CTRL's Coding mode. The user's \
                 active project directory is `{dir}`. Treat this as your \
                 working directory for the rest of this turn — `cd` there \
                 with your shell tool before running build / test / git \
                 commands. Prefer making changes inside this directory \
                 rather than the user's home folder."
            ))
        }
        "cap" => {
            // Cap mode prepends the SKILL.md body (loaded separately) —
            // no extra mode header needed; the SKILL.md is the prompt.
            None
        }
        _ => {
            // personal mode = default Irisy companion; no header needed
            // because the PWA-side `buildSystemPrompt` already injects
            // the Irisy persona + memory + keycap context.
            None
        }
    }
}

async fn forward_to_brain(
    app: &AppHandle,
    request_id: &str,
    args: IrisyChatStreamArgs,
) -> Result<(), String> {
    // Pi 3-mode injection: when `skill_id` is set, prepend the SKILL.md
    // body as a system message — Pi "wears the cap" for this turn.
    // When `mode == "coding"` and `project_dir` is set, prepend a
    // shorter system header naming the cwd so Pi can route its tools
    // there. Falls through silently if the skill is not found (stale id
    // from a refresh race), preserving the conversation rather than 500ing.
    let mut messages: Vec<serde_json::Value> = Vec::new();
    if let Some(skill_id) = args.skill_id.as_deref() {
        if let Some(prompt) = load_skill_system_prompt(skill_id).await {
            messages.push(json!({ "role": "system", "content": prompt }));
        }
    }
    if let Some(header) =
        build_mode_system_header(args.mode.as_deref(), args.project_dir.as_deref())
    {
        messages.push(json!({ "role": "system", "content": header }));
    }
    for m in args.messages.into_iter() {
        messages.push(json!({ "role": m.role, "content": m.content }));
    }

    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "text.chat",
            "arguments": {
                "messages": messages,
                "model": args.model,
            }
        }
    });

    let mut req = Client::new()
        .post(PI_BRAIN_MCP_URL)
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream");
    if let Ok(token) = std::env::var("CTRL_PI_TOKEN") {
        if !token.is_empty() {
            req = req.bearer_auth(token);
        }
    }

    let response = req.json(&body).send().await.map_err(|e| {
        let hint = crate::shell::brain_supervisor::last_error()
            .map(|r| format!(" (supervisor: {r})"))
            .unwrap_or_default();
        format!(
            "Pi brain not reachable at {PI_BRAIN_MCP_URL}: {e}{hint}"
        )
    })?;

    if !response.status().is_success() {
        return Err(format!(
            "Pi brain returned HTTP {}: {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    let mut stream = response.bytes_stream();
    let mut buf = String::new();
    let mut current_event = String::new();
    let mut saw_first_chunk = false;

    loop {
        let next = if saw_first_chunk {
            // Once we've seen any chunk, fall back to indefinite wait —
            // the provider may legitimately produce slow tokens.
            stream.next().await
        } else {
            match timeout(FIRST_CHUNK_DEADLINE, stream.next()).await {
                Ok(item) => item,
                Err(_) => {
                    return Err(format!(
                        "Pi brain stalled (no chunk in {} s); provider may be \
                         unreachable",
                        FIRST_CHUNK_DEADLINE.as_secs()
                    ));
                }
            }
        };
        let Some(chunk) = next else {
            break;
        };
        let bytes = chunk.map_err(|e| format!("Pi brain stream read error: {e}"))?;
        saw_first_chunk = true;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim_end_matches('\r').to_string();
            buf.drain(..=nl);
            if line.is_empty() {
                current_event.clear();
                continue;
            }
            if let Some(rest) = line.strip_prefix("event: ") {
                current_event = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("data: ") {
                if let Err(e) = handle_sse_payload(app, request_id, &current_event, rest) {
                    return Err(e);
                }
                if current_event == "done" || current_event == "error" {
                    return Ok(());
                }
            }
        }
    }

    // Stream ended without explicit done — synthesise so PWA loop exits.
    emit_done(app, request_id, None);
    Ok(())
}

fn handle_sse_payload(
    app: &AppHandle,
    request_id: &str,
    event: &str,
    data: &str,
) -> Result<(), String> {
    match event {
        "delta" => {
            #[derive(Deserialize)]
            struct DeltaPayload {
                delta: String,
            }
            let p: DeltaPayload = serde_json::from_str(data)
                .map_err(|e| format!("malformed delta SSE payload: {e}"))?;
            let _ = app.emit(
                "chat-stream-delta",
                StreamDelta {
                    request_id: request_id.to_string(),
                    delta: p.delta,
                    done: false,
                    error: None,
                    custom: None,
                },
            );
        }
        "custom" => {
            // ADR-009 P3 — forward Pi role=custom payloads (slash
            // command intents) to PWA unchanged. The PWA's IrisyChat
            // dispatches on payload.customType to the right renderer.
            // Treat unparseable payloads as a soft drop (Pi may add
            // new customType shapes in future without us breaking).
            let payload: serde_json::Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => return Ok(()),
            };
            let _ = app.emit(
                "chat-stream-delta",
                StreamDelta {
                    request_id: request_id.to_string(),
                    delta: String::new(),
                    done: false,
                    error: None,
                    custom: Some(payload),
                },
            );
        }
        "done" => {
            emit_done(app, request_id, None);
        }
        "error" => {
            #[derive(Deserialize)]
            struct ErrorPayload {
                message: String,
            }
            let p: ErrorPayload = serde_json::from_str(data)
                .map_err(|e| format!("malformed error SSE payload: {e}"))?;
            emit_done(app, request_id, Some(p.message));
        }
        _ => {
            // Unknown event — ignore (forward-compatibility).
        }
    }
    Ok(())
}

fn emit_done(app: &AppHandle, request_id: &str, error: Option<String>) {
    let _ = app.emit(
        "chat-stream-delta",
        StreamDelta {
            request_id: request_id.to_string(),
            delta: String::new(),
            done: true,
            error,
            custom: None,
        },
    );
}
