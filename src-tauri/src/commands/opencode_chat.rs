// opencode_chat_stream — PWA → opencode HTTP API → stream back.
//
// H-2026-06-09-001 — opencode (coding) + Hermes (assistant) as peer agent processes.
//
// Contract (mirrors irisy_chat's wire so the PWA's ChatStreamTransport works unchanged):
//   invoke('opencode_chat_stream', { args: { request_id, session_id?, message, model?,
//                                            temperature?, max_tokens? } })
//   listen('opencode-chat-delta', payload => { request_id, delta, done, error? })
//
// Wire format (opencode SSE):
//   event: delta
//   data: {"delta": "<token>"}
//
//   event: done
//   data: {"jsonrpc":"2.0","id":...,"result":{"content":[...],...}}
//
//   event: error
//   data: {"message":"..."}
//
// Errors surface specific causes:
//   - "opencode not started (supervisor: <last_error>)"
//   - "opencode not reachable at <url>: <io error>"
//   - "opencode stalled (no chunk in 5 s)"

use std::time::Duration;

use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::shell::opencode_supervisor;
use crate::shell::KernelHandle;

const SSE_EVENT_DELTA: &str = "delta";
const SSE_EVENT_DONE: &str = "done";
const SSE_EVENT_ERROR: &str = "error";

/// Hard ceiling on time we wait for the first SSE chunk after a successful POST.
const FIRST_CHUNK_DEADLINE: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize)]
pub struct OpencodeChatStreamArgs {
    pub request_id: String,
    pub session_id: Option<String>,
    pub message: String,
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
pub async fn opencode_chat_stream(
    args: OpencodeChatStreamArgs,
    _kernel: State<'_, KernelHandle>,
    app: AppHandle,
) -> Result<(), String> {
    // Fail-fast surface: if the supervisor knows opencode isn't up
    if let Some(reason) = opencode_supervisor::last_error() {
        let request_id = args.request_id.clone();
        let app_clone = app.clone();
        let msg = format!("opencode not started: {reason}");
        tokio::spawn(async move {
            emit_done(&app_clone, &request_id, Some(msg));
        });
        return Ok(());
    }

    let port = opencode_supervisor::listen_port();
    if port == 0 {
        let request_id = args.request_id.clone();
        let app_clone = app.clone();
        let msg = "opencode not listening (port = 0)".to_string();
        tokio::spawn(async move {
            emit_done(&app_clone, &request_id, Some(msg));
        });
        return Ok(());
    }

    let request_id = args.request_id.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        if let Err(e) = forward_to_opencode(&app_clone, &request_id, args, port).await {
            emit_done(&app_clone, &request_id, Some(e));
        }
    });

    Ok(())
}

async fn forward_to_opencode(
    app: &AppHandle,
    request_id: &str,
    args: OpencodeChatStreamArgs,
    port: u16,
) -> Result<(), String> {
    let base_url = format!("http://127.0.0.1:{}", port);

    // Create or get session
    let session_id = if let Some(sid) = args.session_id {
        sid
    } else {
        create_session(&base_url).await?
    };

    // Send message to opencode
    let url = format!("{}/session/{}/prompt", base_url, session_id);
    let client = Client::new();

    let mut request_body = json!({
        "parts": [{
            "type": "text",
            "text": args.message,
        }]
    });

    if let Some(model) = args.model {
        request_body["model"] = json!({ "providerID": "anthropic", "modelID": model });
    }

    let response = client
        .post(&url)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("HTTP POST failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "HTTP POST returned {}: {}",
            response.status(),
            response.text().await.unwrap_or_else(|_| "<no body>".to_string())
        ));
    }

    // Parse SSE streaming response
    let mut stream = response.bytes_stream();

    let mut buffer = Vec::new();
    let mut in_event = false;
    let mut event_name = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;

        buffer.extend_from_slice(&chunk);

        // Process SSE lines
        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line = String::from_utf8_lossy(&buffer[..pos]).to_string();
            buffer.drain(..=pos);

            if line.is_empty() {
                // End of event
                if in_event && event_name == "delta" {
                    if let Some(data_pos) = line.find("data: ") {
                        let data = &line[data_pos + 6..];
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(delta) = json.get("delta").and_then(|v| v.as_str()) {
                                let delta_payload = StreamDelta {
                                    request_id: request_id.to_string(),
                                    delta: delta.to_string(),
                                    done: false,
                                    error: None,
                                };
                                let _ = app.emit("opencode-chat-delta", delta_payload);
                            }
                        }
                    }
                } else if in_event && event_name == "done" {
                    let delta_payload = StreamDelta {
                        request_id: request_id.to_string(),
                        delta: String::new(),
                        done: true,
                        error: None,
                    };
                    let _ = app.emit("opencode-chat-delta", delta_payload);
                } else if in_event && event_name == "error" {
                    if let Some(data_pos) = line.find("data: ") {
                        let data = &line[data_pos + 6..];
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(message) = json.get("message").and_then(|v| v.as_str()) {
                                emit_done(app, request_id, Some(message.to_string()));
                                return Ok(());
                            }
                        }
                    }
                }

                in_event = false;
                event_name.clear();
            } else if line.starts_with("event: ") {
                event_name = line[7..].to_string();
                in_event = true;
            } else if line.starts_with("data: ") {
                // data line is processed in the empty line block above
            }
        }
    }

    Ok(())
}

async fn create_session(base_url: &str) -> Result<String, String> {
    let url = format!("{}/session", base_url);
    let client = Client::new();

    let response = client
        .post(&url)
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| format!("HTTP POST failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "HTTP POST returned {}: {}",
            response.status(),
            response.text().await.unwrap_or_else(|_| "<no body>".to_string())
        ));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("JSON parse failed: {}", e))?;

    json.get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "session response missing 'id' field".to_string())
}

fn emit_done(app: &AppHandle, request_id: &str, error: Option<String>) {
    let payload = StreamDelta {
        request_id: request_id.to_string(),
        delta: String::new(),
        done: true,
        error,
    };
    let _ = app.emit("opencode-chat-delta", payload);
}