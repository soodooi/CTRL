// ST-SS commands — stream subscribe / publish / list.
//
// Sub-PR d: real wire to `kernel::stss_bridge::StssBridge`. The bridge is
// already serving WS on 127.0.0.1:17872; these commands let the PWA publish
// Cells/Ops through the same channel without holding a WS itself when running
// in-Tauri (saves an unnecessary loopback hop).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::kernel::event::{Op, OpKind};
use crate::shell::KernelHandle;

#[derive(Debug, Deserialize)]
pub struct SubscribeArgs {
    pub stream_id: String,
}

#[derive(Debug, Serialize)]
pub struct StreamHandle {
    pub stream_id: String,
    pub bridge_url: String,
}

#[tauri::command]
pub async fn subscribe(
    args: SubscribeArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<StreamHandle, String> {
    // Bridge URL carries the per-process auth token as a query string. The
    // PWA must use exactly this URL — connections without it (or with a
    // stale token from a previous boot) get 401.
    Ok(StreamHandle {
        stream_id: args.stream_id,
        bridge_url: format!(
            "ws://{}?token={}",
            crate::kernel::STSS_LISTEN_ADDR,
            kernel.bridge.auth_token()
        ),
    })
}

/// Returns the current bridge token. PWA reads this once and passes it on
/// every WS reconnect attempt. Token rotates every kernel boot — viewers
/// must re-fetch on reconnect failure (401).
#[tauri::command]
pub async fn get_bridge_token(kernel: State<'_, KernelHandle>) -> Result<String, String> {
    Ok(kernel.bridge.auth_token().to_string())
}

#[derive(Debug, Deserialize)]
pub struct PublishArgs {
    pub stream_id: String,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub async fn publish(
    args: PublishArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<(), String> {
    // Strict OpKind mapping — pre-merge review flagged the previous silent
    // fallback to McpInvoked. Unknown kinds now return an error so caller
    // bugs (typo in the kind string) surface instead of producing
    // semantically wrong events.
    let kind = match args.kind.as_str() {
        "hotkey_triggered" => OpKind::HotkeyTriggered,
        "mcp_invoked" => OpKind::McpInvoked,
        "mcp_completed" => OpKind::McpCompleted,
        "mcp_failed" => OpKind::McpFailed,
        "actor_spawned" => OpKind::ActorSpawned,
        "actor_terminated" => OpKind::ActorTerminated,
        "llm_call_started" => OpKind::LlmCallStarted,
        "llm_call_chunk" => OpKind::LlmCallChunk,
        "llm_call_finished" => OpKind::LlmCallFinished,
        "app_focus_changed" => OpKind::AppFocusChanged,
        "file_saved" => OpKind::FileSaved,
        "cursor_moved" => OpKind::CursorMoved,
        other => return Err(format!("unknown op kind: {other}")),
    };
    let op = Op {
        kind,
        ts_ms: now_ms(),
        stream_id: Some(args.stream_id),
        payload: args.payload,
    };
    kernel.bridge.publish_op(op);
    Ok(())
}

#[tauri::command]
pub async fn list_streams(_kernel: State<'_, KernelHandle>) -> Result<Vec<String>, String> {
    // sub-PR e: enumerate registered stream IDs (currently only the kernel
    // canonical desktop stream).
    Ok(vec!["ctrl-desktop".into()])
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

