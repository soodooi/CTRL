// ST-SS commands — stream subscribe / publish / list.
//
// PWA subscribes to a stream via this command; the handler bridges to the
// in-process ST-SS WS server promoted from share/stss-spike/. Once promoted
// in sub-PR c, the WS server in `crate::kernel::stss_bridge` becomes the
// canonical event bus for cross-process + cross-device flow.

use serde::{Deserialize, Serialize};

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
pub async fn subscribe(args: SubscribeArgs) -> Result<StreamHandle, String> {
    // sub-PR c: register subscriber in kernel::stss_bridge and return WS URL
    // for the PWA to connect (same machine -> ws://127.0.0.1:17872).
    Ok(StreamHandle {
        stream_id: args.stream_id,
        bridge_url: "ws://127.0.0.1:17872".into(),
    })
}

#[derive(Debug, Deserialize)]
pub struct PublishArgs {
    pub stream_id: String,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[tauri::command]
pub async fn publish(args: PublishArgs) -> Result<(), String> {
    // sub-PR c: forward to kernel::event_bus + ST-SS WS bridge.
    tracing::info!("stss::publish (stub) stream={} kind={}", args.stream_id, args.kind);
    Ok(())
}

#[tauri::command]
pub async fn list_streams() -> Result<Vec<String>, String> {
    // sub-PR c: read active streams from kernel::stss_bridge.
    Ok(vec!["spike-desktop-001".into()])
}
