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
    // v0.6 base
    UserInput,
    ClipboardSnapshot,
    ScreenSnapshot,
    HardwareReading,
    LlmResponse,
    McpToolResult,
    ApiResponse,
    ContextSnapshot,
    // v0.7 coding-env — mirrors packages/ctrl-stss/src/protocol/kind.ts
    // (lane-C C1 H-2026-05-20-001 spec v0.7). Payload schemas in
    // .olym/specs/stss-protocol/spec.md §2.1.1.
    TerminalOutput,  // payload = { actor, pid, data_b64, len }
    TerminalExit,    // payload = { actor, pid, code: Option<i32>, signal?: i32 }
    LspState,        // payload = { file, function?, cursor_line?, selection? }
    AgentThinking,   // payload = { text, agent_id, ts_ms }
    AgentAction,     // payload = { action_kind, target, args, agent_id }
    EnvStatus,       // payload = { state: "spawning"|"running"|"exited"|"error", detail? }
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
    // ADR-002 substrate mesh layer events — added in ctrl-mesh baseline before athena Sprint 2.
    // Emitted by the mesh sync layer when remote peers contribute Automerge
    // changes to a document; consumed by the same kernel event bus that all
    // local Ops flow through (preserves ADR-001 spine §3.2 invariant "Op is the
    // only mutation message").
    MeshDeviceJoined,
    MeshDeviceLeft,
    MeshKeycapAdded,
    MeshKeycapRemoved,
    MeshKeycapUsedAt,
    MeshPreferenceUpdated,
    // ADR-002 substrate § subprocess v1 §3 — SubprocessActor 6 lifecycle events (kernel-internal,
    // NOT for ST-SS wire emission; the subprocess_stss_adapter translates
    // these into v0.7 CellKind / OpKind values before broadcast).
    // Inbound (PWA → kernel → actor):
    SubprocessStdin,    // payload = { data_b64: String }
    SubprocessResize,   // payload = { cols: u16, rows: u16 }
    SubprocessSignal,   // payload = { signal: "SIGINT"|"SIGTERM"|"SIGKILL" }
    // Outbound (actor → kernel → adapter → ST-SS bridge):
    SubprocessStdout,   // payload = { actor, pid, data_b64, len }
    SubprocessExit,     // payload = { actor, pid, code: Option<i32>, signal?: i32 }
    SubprocessSpawned,  // payload = { actor, pid, command, mem_cap_bytes }
    // v0.7 coding-env ops — mirrors lane-C kind.ts. Inbound from PWA via
    // ST-SS wire; the adapter translates these to SubprocessStdin / etc.
    AgentPrompt,        // payload = { text, agent_id?, request_id? }
    AgentInterrupt,     // payload = { agent_id?, reason? }
    EnvSignal,          // payload = { signal: "SIGINT"|"SIGTERM"|"SIGKILL" }
    FileRequest,        // payload = { uri, range? } — LSP-style document/range query
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
