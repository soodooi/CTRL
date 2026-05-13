// ST-SS commands — stream subscribe / publish / list.
//
// Sub-PR d: real wire to `kernel::stss_bridge::StssBridge`. The bridge is
// already serving WS on 127.0.0.1:17872; these commands let the PWA publish
// Cells/Ops through the same channel without holding a WS itself when running
// in-Tauri (saves an unnecessary loopback hop).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::kernel::event::{Cell, Op, OpKind};
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
    _kernel: State<'_, KernelHandle>,
) -> Result<StreamHandle, String> {
    // The kernel bridge always serves on the canonical local URL. PWA running
    // in-Tauri can either connect directly to this URL or push through publish().
    Ok(StreamHandle {
        stream_id: args.stream_id,
        bridge_url: format!("ws://{}", crate::kernel::STSS_LISTEN_ADDR),
    })
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
    // Map free-form `kind` string to OpKind. Unknown kinds become KeycapInvoked
    // for now (matches the lone-Ctrl summon UX). Strict mapping in sub-PR e.
    let kind = match args.kind.as_str() {
        "hotkey_triggered" => OpKind::HotkeyTriggered,
        "keycap_invoked" => OpKind::KeycapInvoked,
        "keycap_completed" => OpKind::KeycapCompleted,
        "app_focus_changed" => OpKind::AppFocusChanged,
        _ => OpKind::KeycapInvoked,
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

// Allow Cell to be referenced (used by future publish_cell wrapper).
#[allow(dead_code)]
fn _retain_cell_import(_c: Cell) {}
