// hermes_chat_stream — PWA → Hermes MCP → stream back.
//
// H-2026-06-09-001 — opencode (coding) + Hermes (assistant) as peer agent processes.
//
// Contract (mirrors irisy_chat's wire so the PWA's ChatStreamTransport works unchanged):
//   invoke('hermes_chat_stream', { args: { request_id, messages, model?,
//                                          temperature?, max_tokens? } })
//   listen('hermes-chat-delta', payload => { request_id, delta, done, error? })
//
// This implementation uses rmcp to connect to Hermes via stdio.

use serde::{Deserialize, Serialize};
use std::io::{BufRead, Write};
use tauri::{AppHandle, Emitter, State};

use crate::shell::hermes_supervisor;
use crate::shell::KernelHandle;

#[derive(Debug, Deserialize)]
pub struct HermesChatStreamArgs {
    pub request_id: String,
    pub messages: Vec<serde_json::Value>,
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
pub async fn hermes_chat_stream(
    args: HermesChatStreamArgs,
    _kernel: State<'_, KernelHandle>,
    app: AppHandle,
) -> Result<(), String> {
    // Fail-fast surface: if the supervisor knows Hermes isn't up
    if let Some(reason) = hermes_supervisor::last_error() {
        let request_id = args.request_id.clone();
        let app_clone = app.clone();
        let msg = format!("Hermes not started: {reason}");
        tokio::spawn(async move {
            emit_done(&app_clone, &request_id, Some(msg));
        });
        return Ok(());
    }

    // Get Hermes child process from supervisor
    let child = match hermes_supervisor::get_hermes_child() {
        Some(c) => c,
        None => {
            let request_id = args.request_id.clone();
            let app_clone = app.clone();
            tokio::spawn(async move {
                emit_done(&app_clone, &request_id, Some("Hermes child not available".to_string()));
            });
            return Ok(());
        }
    };

    // Build MCP request for Hermes
    let mcp_request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "chat",
            "arguments": {
                "messages": args.messages,
                "model": args.model.unwrap_or_else(|| "claude-3-5-sonnet-20241022".to_string()),
                "temperature": args.temperature.unwrap_or(0.7),
                "max_tokens": args.max_tokens.unwrap_or(4096),
                "stream": true
            }
        }
    });

    let request_id = args.request_id.clone();
    let app_clone = app.clone();

    // Use spawn_blocking for stdio operations
    tokio::task::spawn_blocking(move || {
        // Lock child to get stdio access (this is inside spawn_blocking, so it's OK)
        let mut child_lock = match child.lock() {
            Ok(l) => l,
            Err(e) => {
                handle_stdin_error_sync(&app_clone, &request_id, format!("Failed to lock Hermes child: {}", e), "Lock error");
                return;
            }
        };

        let mut stdin = match child_lock.as_mut().and_then(|c| c.stdin.take()) {
            Some(s) => s,
            None => {
                handle_stdin_error_sync(&app_clone, &request_id, "Hermes stdin not available".to_string(), "Stdin error");
                return;
            }
        };

        let stdout = match child_lock.as_mut().and_then(|c| c.stdout.take()) {
            Some(s) => s,
            None => {
                handle_stdin_error_sync(&app_clone, &request_id, "Hermes stdout not available".to_string(), "Stdout error");
                return;
            }
        };

        // Send MCP request to Hermes
        let request_str = match serde_json::to_string(&mcp_request) {
            Ok(s) => s,
            Err(e) => {
                handle_stdin_error_sync(&app_clone, &request_id, format!("Failed to serialize request: {}", e), "Serialization error");
                return;
            }
        };

        if let Err(err) = stdin.write_all(request_str.as_bytes()) {
            handle_stdin_error_sync(&app_clone, &request_id, format!("Failed to write to Hermes: {}", err), "Write error");
            return;
        }
        if let Err(err) = stdin.write_all(b"\n") {
            handle_stdin_error_sync(&app_clone, &request_id, format!("Failed to write newline: {}", err), "Write error");
            return;
        }
        if let Err(err) = stdin.flush() {
            handle_stdin_error_sync(&app_clone, &request_id, format!("Failed to flush stdin: {}", err), "Flush error");
            return;
        }

        // Read Hermes responses and emit deltas
        let reader = std::io::BufReader::new(stdout);

        for line_result in reader.lines() {
            match line_result {
                Ok(line) => {
                    if line.is_empty() {
                        continue;
                    }

                    if let Ok(response) = serde_json::from_str::<serde_json::Value>(&line) {
                        if let Some(result) = response.get("result") {
                            if let Some(content) = result.get("content") {
                                if let Some(text_array) = content.as_array() {
                                    for item in text_array {
                                        if let Some(text_obj) = item.as_object() {
                                            if let (Some("text"), Some(delta)) = (
                                                text_obj.get("type").and_then(|t| t.as_str()),
                                                text_obj.get("text").and_then(|t| t.as_str()),
                                            ) {
                                                let payload = StreamDelta {
                                                    request_id: request_id.clone(),
                                                    delta: delta.to_string(),
                                                    done: false,
                                                    error: None,
                                                };
                                                let _ = app_clone.emit("hermes-chat-delta", payload);
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if response.get("id").and_then(|i| i.as_u64()) == Some(1) {
                            if response.get("result").is_some() {
                                emit_done_sync(&app_clone, &request_id, None);
                                return;
                            }
                            if let Some(error) = response.get("error") {
                                let error_msg = error.get("message")
                                    .and_then(|m| m.as_str())
                                    .unwrap_or("Unknown error");
                                emit_done_sync(&app_clone, &request_id, Some(error_msg.to_string()));
                                return;
                            }
                        }
                    }
                }
                Err(e) => {
                    emit_done_sync(&app_clone, &request_id, Some(format!("Failed to read Hermes output: {}", e)));
                    return;
                }
            }
        }

        emit_done_sync(&app_clone, &request_id, None);
    });

    Ok(())
}

fn emit_done(app: &AppHandle, request_id: &str, error: Option<String>) {
    let payload = StreamDelta {
        request_id: request_id.to_string(),
        delta: String::new(),
        done: true,
        error,
    };
    let _ = app.emit("hermes-chat-delta", payload);
}

/// Synchronous helper for emit_done in spawn_blocking context
fn emit_done_sync(app: &AppHandle, request_id: &str, error: Option<String>) {
    let payload = StreamDelta {
        request_id: request_id.to_string(),
        delta: String::new(),
        done: true,
        error,
    };
    let _ = app.emit("hermes-chat-delta", payload);
}

/// Synchronous helper for handle_stdin_error in spawn_blocking context
fn handle_stdin_error_sync(app: &AppHandle, request_id: &str, msg: String, _context: &str) {
    emit_done_sync(app, request_id, Some(msg));
}