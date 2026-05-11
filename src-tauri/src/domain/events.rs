// Domain value types. Stable contracts that flow across boundaries.
//
// HotkeyEvent is bridged to the kernel ST-SS Event bus via `From` impl
// (returns kernel::Event::Op with kind=HotkeyTriggered, payload=HotkeyEvent
// as JSON). Domain layer stays free of kernel types; conversion at boundary.

use crate::kernel::event::{Event, Op, OpKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyEvent {
    pub kind: HotkeyKind,
    pub captured_text: Option<String>,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub latency_ms: u64,
    /// Epoch milliseconds at event creation. Set automatically by use cases.
    #[serde(default)]
    pub ts_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HotkeyKind {
    /// User pressed the trigger combination, panel should open.
    OpenPanel,
    /// Trigger detected but suppressed (e.g., user already in a focused input).
    Suppressed,
    /// Hotkey listener could not start (e.g., Accessibility denied on macOS).
    ListenerError,
}

impl HotkeyKind {
    pub fn as_str(self) -> &'static str {
        match self {
            HotkeyKind::OpenPanel => "open-panel",
            HotkeyKind::Suppressed => "suppressed",
            HotkeyKind::ListenerError => "listener-error",
        }
    }
}

impl From<HotkeyEvent> for Event {
    fn from(h: HotkeyEvent) -> Self {
        let payload = serde_json::to_value(&h).unwrap_or(serde_json::Value::Null);
        Event::Op(Op {
            kind: OpKind::HotkeyTriggered,
            ts_ms: h.ts_ms,
            stream_id: Some("ctrl-hotkey".into()),
            payload,
        })
    }
}

impl From<&HotkeyEvent> for Event {
    fn from(h: &HotkeyEvent) -> Self {
        h.clone().into()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionState {
    Granted,
    PendingRestart,
}
