// Kernel event stream — the PWA's subscribe handle for the local event WS.
//
// ST-SS as a protocol abstraction is deprecated (ADR-010 communication
// § transports v5, SC6): the local kernel->PWA stream is just a plain WS that
// ships CBOR Event payloads (Cell/Op), not a semantic-stream protocol. The
// inbound `publish` / `list_streams` / `get_bridge_token` command surface
// retired (dead — no PWA caller; the bridge URL already carries the token).
// What remains is the one load-bearing call: hand the PWA the authed WS URL so
// `useCellStream` / `useSubprocessChannel` can receive the live event stream.

use serde::{Deserialize, Serialize};
use tauri::State;

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
