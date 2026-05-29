// irisy_chat_stream Tauri command — Irisy → active brain keycap → stream back.
//
// Contract (mirrors chat_stream's wire so the PWA's existing ChatStreamTransport
// works with only the command name swapped):
//   invoke('irisy_chat_stream', { args: { request_id, messages, model?,
//                                          temperature?, max_tokens? } })
//   listen('chat-stream-delta', payload => { request_id, delta, done, error? })
//
// Difference from `chat_stream` (raw LLM): this command resolves the user's
// **active brain keycap** (~/.ctrl/active-brain → keycap id) and forwards the
// request to that keycap's MCP server. The brain (e.g. Pi) runs its own agent
// loop with its own provider config; CTRL is provider-passthrough.
//
// "BrainRouter inline" per ADR-001 amendment (2026-05-25): the lookup is a
// ≤100-LOC helper inside this command, not a separate substrate module.
//
// Brain selection (ADR-021):
//   - The active brain id lives at `~/.ctrl/active-brain` (single line of text;
//     absent / empty → "pi" default).
//   - Brain registry + per-brain MCP port + adapter flag are read from
//     `kernel::brain_config` (defaults + user overrides in
//     `~/.ctrl/brains.toml`). NO brain id is hardcoded in this file.
//   - Switching brains is a UI action (`/settings/brain`). The kernel does
//     NOT yet supervise the brain MCP subprocess — users start `ctrl-pi-mcp`
//     manually via `npm start` in packages/ctrl-pi-plugin/ for now.
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

use std::sync::Arc;

use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::commands::chat::MessageWire;
use crate::kernel::llm_port::{LlmAdapter, LlmMessage, LlmPrompt};
use crate::shell::KernelHandle;

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
    kernel: State<'_, KernelHandle>,
    app: AppHandle,
) -> Result<(), String> {
    let brain_id = resolve_active_brain();
    // Route by the active integration's adapter type (大模型集成 / Model
    // Integration — ADR-021 / cc-switch): "pi" runs as an MCP server (the
    // pi-plugin); any other adapter name is an LLM-port adapter (e.g.
    // claude_cli = the `claude` CLI subprocess) — stream via the LLM port,
    // no MCP server needed. Either way the same `chat-stream-delta` events
    // go to the PWA, so the transport is identical.
    let adapter_name = crate::kernel::brain_config::load()
        .into_iter()
        .find(|b| b.id == brain_id)
        .and_then(|b| b.adapter);

    let request_id = args.request_id.clone();
    let app_clone = app.clone();

    match adapter_name.as_deref() {
        Some("pi") | None => {
            let url = brain_mcp_url(&brain_id).ok_or_else(|| {
                format!(
                    "active integration '{brain_id}' has no MCP endpoint. Open \
                     Settings → Model Integration and pick one with an adapter."
                )
            })?;
            tokio::spawn(async move {
                if let Err(e) = forward_to_brain(&app_clone, &request_id, &url, args).await {
                    emit_done(&app_clone, &request_id, Some(e));
                }
            });
        }
        Some(llm_adapter) => {
            let adapter = kernel
                .runtime
                .llm_port
                .adapter_for(llm_adapter)
                .ok_or_else(|| {
                    format!(
                        "integration '{brain_id}' uses LLM adapter '{llm_adapter}', which \
                         isn't registered. Configure it in ~/.ctrl/config.toml or log in to \
                         the CLI (e.g. run `claude`)."
                    )
                })?
                .clone();
            let model = args.model.clone().unwrap_or_default();
            tokio::spawn(async move {
                stream_via_llm_adapter(&app_clone, &request_id, adapter, model, args).await;
            });
        }
    }

    Ok(())
}

/// Stream a chat turn through an LLM-port adapter (e.g. the `claude` CLI via
/// the claude_cli adapter) and emit the same `chat-stream-delta` events the
/// MCP path does, so the PWA transport is identical regardless of which
/// integration powers Irisy. Mirrors `chat::chat_stream`'s worker loop.
async fn stream_via_llm_adapter(
    app: &AppHandle,
    request_id: &str,
    adapter: Arc<dyn LlmAdapter>,
    model: String,
    args: IrisyChatStreamArgs,
) {
    let prompt = LlmPrompt {
        // The PWA bakes Irisy's persona + tool instructions into the messages.
        system: None,
        messages: args
            .messages
            .into_iter()
            .map(|m| LlmMessage {
                role: m.role,
                content: m.content,
            })
            .collect(),
        temperature: args.temperature,
        max_tokens: args.max_tokens,
    };
    let mut rx = match adapter.stream_chat(&model, &prompt, 120_000).await {
        Ok(rx) => rx,
        Err(e) => {
            emit_done(app, request_id, Some(e.to_string()));
            return;
        }
    };
    let mut saw_finish = false;
    while let Some(item) = rx.recv().await {
        match item {
            Ok(chunk) => {
                let done_now = chunk.finish_reason.is_some();
                let _ = app.emit(
                    "chat-stream-delta",
                    StreamDelta {
                        request_id: request_id.to_string(),
                        delta: chunk.delta,
                        done: done_now,
                        error: None,
                    },
                );
                if done_now {
                    saw_finish = true;
                    break;
                }
            }
            Err(e) => {
                emit_done(app, request_id, Some(e.to_string()));
                return;
            }
        }
    }
    if !saw_finish {
        emit_done(app, request_id, None);
    }
}

// ── BrainRouter inline (ADR-021) ────────────────────────────────────────────
//
// Brain id + MCP URL come from `kernel::brain_config`. The router does
// not hardcode any brain id — switching brains is a matter of writing
// the new id to `~/.ctrl/active-brain` (via the Settings UI's
// `brain_set_active` command) and reloading the registry.

fn resolve_active_brain() -> String {
    crate::kernel::brain_config::active_brain_id()
}

fn brain_mcp_url(brain_id: &str) -> Option<String> {
    crate::kernel::brain_config::brain_mcp_url(brain_id)
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
