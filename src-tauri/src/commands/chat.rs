// chat_stream Tauri command — true streaming LLM responses.
//
// Contract (defined by PWA's ChatStreamTransport, lib/llm-transport.ts):
//   invoke('chat_stream', { args: { request_id, messages, model?,
//                                   temperature?, max_tokens? } })
//   listen('chat.stream.delta', payload => { request_id, delta, done,
//                                            error? })
//
// The command returns immediately; deltas land on the event channel.
// A background tokio task drives the LLM adapter's stream and emits
// every chunk as a Tauri event. `request_id` lets the PWA multiplex
// multiple concurrent streams across the same listener.
//
// Capability gating: optional `keycap_id` arg lets a caller declare
// the keycap context for future per-keycap LlmCall token checks.
// Absent = trusted "ctrl-system" (Settings UI / direct dev call).

use crate::kernel::capability::{CapToken, CapabilityBroker};
use crate::kernel::capability_resolver;
use crate::kernel::llm_port::{LlmMessage, LlmPrompt};
use crate::shell::KernelHandle;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Deserialize)]
pub struct ChatStreamArgs {
    pub request_id: String,
    pub messages: Vec<MessageWire>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// Optional caller keycap id. Future hardening will require this
    /// for non-trusted contexts; today absent → "ctrl-system".
    #[serde(default)]
    pub keycap_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MessageWire {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Clone)]
struct ChatStreamDelta {
    request_id: String,
    delta: String,
    done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tauri::command]
pub async fn chat_stream(
    args: ChatStreamArgs,
    kernel: State<'_, KernelHandle>,
    app: AppHandle,
) -> Result<(), String> {
    // Capability check — LlmCall, model name is the glob target.
    let model = args.model.clone().unwrap_or_default();
    {
        let id = args.keycap_id.as_deref().unwrap_or("ctrl-system");
        let cap = capability_resolver::resolve_for_keycap(id);
        let required = CapToken::LlmCall {
            model: if model.is_empty() {
                "*".to_string()
            } else {
                model.clone()
            },
            max_tokens: args.max_tokens,
        };
        let broker = CapabilityBroker::new();
        broker.check(&cap, &required).map_err(|e| {
            tracing::warn!(keycap_id = %id, model = %model, error = %e, "chat_stream: capability rejected");
            format!("capability denied for keycap {id:?}: {e}")
        })?;
    }

    let adapter = kernel
        .runtime
        .llm_port
        .primary_adapter()
        .ok_or_else(|| {
            "No LLM adapter registered. Edit ~/.ctrl/config.toml \
             [providers.volc] api_key = \"...\" then restart CTRL."
                .to_string()
        })?
        .clone();

    let prompt = LlmPrompt {
        // PWA bakes the system prompt into the messages array; we pass
        // it through without injecting our own.
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

    let request_id = args.request_id;

    // Spawn the streaming worker so the Tauri command returns immediately.
    // PWA's ChatStreamTransport awaits invoke() then drains events; if
    // we held the command open, the listener would never get a chance to
    // attach before our first delta fires.
    tokio::spawn(async move {
        let result = adapter.stream_chat(&model, &prompt, 30_000).await;
        let mut rx = match result {
            Ok(rx) => rx,
            Err(e) => {
                emit_done(&app, &request_id, Some(e.to_string()));
                return;
            }
        };
        let mut saw_finish = false;
        while let Some(item) = rx.recv().await {
            match item {
                Ok(chunk) => {
                    let done_now = chunk.finish_reason.is_some();
                    let _ = app.emit(
                        "chat.stream.delta",
                        ChatStreamDelta {
                            request_id: request_id.clone(),
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
                    emit_done(&app, &request_id, Some(e.to_string()));
                    return;
                }
            }
        }
        // Stream closed gracefully without an explicit finish_reason —
        // emit a synthetic done so the PWA's while-loop exits.
        if !saw_finish {
            emit_done(&app, &request_id, None);
        }
    });

    Ok(())
}

fn emit_done(app: &AppHandle, request_id: &str, error: Option<String>) {
    let _ = app.emit(
        "chat.stream.delta",
        ChatStreamDelta {
            request_id: request_id.to_string(),
            delta: String::new(),
            done: true,
            error,
        },
    );
}
