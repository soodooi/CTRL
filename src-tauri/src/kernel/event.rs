// Event — ST-SS cell+op unified message format.
//
// All inter-actor communication uses Event. Wire format = ST-SS protocol
// when crossing process/device boundary. Same shape as @ctrl/kernel-sdk
// TypeScript Event (mirrors event.ts).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The single message format in the kernel. Either a `Cell` (snapshot value)
/// or an `Op` (event/mutation).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Cell(Cell),
    Op(Op),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cell {
    pub kind: CellKind,
    pub ts_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_id: Option<String>,
    /// CBOR-encoded shape, kept as raw JSON for now to avoid CBOR dep until P3.
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Op {
    pub kind: OpKind,
    pub ts_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_id: Option<String>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CellKind {
    UserInput,
    ClipboardSnapshot,
    ScreenSnapshot,
    HardwareReading,
    LlmResponse,
    McpToolResult,
    ApiResponse,
    ContextSnapshot,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    KeycapInvoked,
    KeycapCompleted,
    KeycapFailed,
    ActorSpawned,
    ActorTerminated,
    HotkeyTriggered,
    LlmCallStarted,
    LlmCallChunk,
    LlmCallFinished,
    AppFocusChanged,
    FileSaved,
    CursorMoved,
}

/// Filter for subscribing to a subset of events on the bus.
#[derive(Debug, Clone, Default)]
pub struct EventFilter {
    pub cell_kind: Option<CellKind>,
    pub op_kind: Option<OpKind>,
    pub stream_id: Option<String>,
}

impl EventFilter {
    pub fn matches(&self, event: &Event) -> bool {
        match event {
            Event::Cell(c) => {
                if let Some(k) = self.cell_kind {
                    if k != c.kind {
                        return false;
                    }
                }
                if let Some(ref s) = self.stream_id {
                    if c.stream_id.as_deref() != Some(s) {
                        return false;
                    }
                }
                true
            }
            Event::Op(o) => {
                if let Some(k) = self.op_kind {
                    if k != o.kind {
                        return false;
                    }
                }
                if let Some(ref s) = self.stream_id {
                    if o.stream_id.as_deref() != Some(s) {
                        return false;
                    }
                }
                true
            }
        }
    }
}

/// Pub-sub bus for routing events. P2.1 skeleton — full impl in P2.5.
pub struct EventBus {
    // Future: subscriptions, persistence handle, etc.
    _subscriptions: BTreeMap<u64, ()>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            _subscriptions: BTreeMap::new(),
        }
    }
}
