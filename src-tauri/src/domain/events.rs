// Domain value types. Stable contracts that flow across boundaries.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct HotkeyEvent {
    pub kind: String,
    pub captured_text: Option<String>,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub latency_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionState {
    Granted,
    PendingRestart,
}
