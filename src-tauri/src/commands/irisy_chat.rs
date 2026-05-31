// irisy_chat_stream — Irisy → Pi brain MCP → stream back.
//
// ADR-003: Pi is the sole brain. Every Irisy turn goes through the
// `@ctrl/pi-plugin` MCP server (`ctrl-pi-mcp` on 127.0.0.1:17874) — no
// `active-brain` branch, no LLM-port fallback. The Pi process inside
// the plugin loads the `@ctrl/pi-bridge` extension at spawn so its LLM
// calls go back through the kernel provider sub-system (ADR-004 §9.1).
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
// "BrainRouter inline" per ADR-001 amendment (2026-05-25): the lookup
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
}

#[derive(Debug, Serialize, Clone)]
struct StreamDelta {
    request_id: String,
    delta: String,
    done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
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

async fn forward_to_brain(
    app: &AppHandle,
    request_id: &str,
    args: IrisyChatStreamArgs,
) -> Result<(), String> {
    let body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "text.chat",
            "arguments": {
                "messages": args.messages
                    .into_iter()
                    .map(|m| json!({ "role": m.role, "content": m.content }))
                    .collect::<Vec<_>>(),
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
        },
    );
}
