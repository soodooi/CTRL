// irisy_chat_stream Tauri command — Irisy → active brain keycap → stream back.
//
// Contract (mirrors chat_stream's wire so the PWA's existing ChatStreamTransport
// works with only the command name swapped):
//   invoke('irisy_chat_stream', { args: { request_id, messages, model?,
//                                          temperature?, max_tokens? } })
//   listen('chat.stream.delta', payload => { request_id, delta, done, error? })
//
// Difference from `chat_stream` (raw LLM): this command resolves the user's
// **active brain keycap** (~/.ctrl/active-brain → keycap id) and forwards the
// request to that keycap's MCP server. The brain (e.g. Pi) runs its own agent
// loop with its own provider config; CTRL is provider-passthrough.
//
// "BrainRouter inline" per ADR-001 amendment (2026-05-25): the lookup is a
// ≤100-LOC helper inside this command, not a separate substrate module.
//
// v1.0 scope:
//   - Only "pi" brain is wired (the @ctrl/pi-plugin MCP server on 127.0.0.1:17874).
//   - The kernel does NOT yet supervise the pi-plugin subprocess — users start it
//     manually via `npm start` in packages/ctrl-pi-plugin/. Supervisor lands next.
//   - active-brain file is a single line of text. Absent / empty → "pi" default.
//
// Wire format (Pi plugin SSE):
//   event: delta
//   data: {"delta": "<token>"}
//
//   event: done
//   data: {"jsonrpc":"2.0","id":...,"result":{"content":[{"type":"text","text":"..."}],...}}
//
//   event: error
//   data: {"message":"..."}

use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

use crate::commands::chat::MessageWire;

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
    app: AppHandle,
) -> Result<(), String> {
    let brain_id = resolve_active_brain();
    let url = brain_mcp_url(&brain_id).ok_or_else(|| {
        format!(
            "active brain '{brain_id}' has no known MCP endpoint. \
             v1.0 supports 'pi' only (edit ~/.ctrl/active-brain)."
        )
    })?;

    let request_id = args.request_id.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        if let Err(e) = forward_to_brain(&app_clone, &request_id, &url, args).await {
            emit_done(&app_clone, &request_id, Some(e));
        }
    });

    Ok(())
}

// ── BrainRouter inline (≤100 LOC, ADR-001 amendment 2026-05-25) ──────────────

fn resolve_active_brain() -> String {
    let path = active_brain_path();
    match std::fs::read_to_string(&path) {
        Ok(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                "pi".to_string()
            } else {
                trimmed.to_string()
            }
        }
        Err(_) => "pi".to_string(),
    }
}

fn active_brain_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(".ctrl").join("active-brain")
}

/// Map a brain keycap id to its MCP endpoint. v1.0 hardcoded — future
/// reads `~/.ctrl/keycaps/<id>/keycap.md` `bridge` + supervisor-assigned port.
fn brain_mcp_url(brain_id: &str) -> Option<String> {
    match brain_id {
        "pi" => Some("http://127.0.0.1:17874/mcp".to_string()),
        _ => None,
    }
}

// ── HTTP + SSE forwarding ────────────────────────────────────────────────────

async fn forward_to_brain(
    app: &AppHandle,
    request_id: &str,
    url: &str,
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
        .post(url)
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream");
    if let Ok(token) = std::env::var("CTRL_PI_TOKEN") {
        if !token.is_empty() {
            req = req.bearer_auth(token);
        }
    }

    let response = req.json(&body).send().await.map_err(|e| {
        format!(
            "Pi brain not reachable at {url}: {e}. \
             Start it with `cd packages/ctrl-pi-plugin && npm start`."
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

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream read error: {e}"))?;
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
                "chat.stream.delta",
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
        "chat.stream.delta",
        StreamDelta {
            request_id: request_id.to_string(),
            delta: String::new(),
            done: true,
            error,
        },
    );
}
