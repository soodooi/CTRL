// Event — event-stream cell+op unified message format.
//
// All inter-actor communication uses Event. Wire format = event-stream protocol
// when crossing process/device boundary. Same shape as @ctrl/kernel-sdk
// TypeScript Event (mirrors event.ts).

use crate::kernel::audit::InternalMsg;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

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
    // v0.7 coding-env CellKinds. These ship as plain CBOR-framed event
    // payloads over the kernel->PWA WS (the event-stream protocol abstraction is
    // retired, ADR-010 § transports v5/v8 SC6).
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
    McpInvoked,
    McpCompleted,
    McpFailed,
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
    MeshMcpAdded,
    MeshMcpRemoved,
    MeshMcpUsedAt,
    MeshPreferenceUpdated,
    // ADR-002 substrate § subprocess v1 §3 — SubprocessActor 6 lifecycle events (kernel-internal,
    // NOT for direct WS emission; the subprocess_channel_adapter translates
    // these into v0.7 CellKind / OpKind values before broadcast).
    // Inbound (PWA → kernel → actor):
    SubprocessStdin,    // payload = { data_b64: String }
    SubprocessResize,   // payload = { cols: u16, rows: u16 }
    SubprocessSignal,   // payload = { signal: "SIGINT"|"SIGTERM"|"SIGKILL" }
    // Outbound (actor → kernel → adapter → event-stream bridge):
    SubprocessStdout,   // payload = { actor, pid, data_b64, len }
    SubprocessExit,     // payload = { actor, pid, code: Option<i32>, signal?: i32 }
    SubprocessSpawned,  // payload = { actor, pid, command, mem_cap_bytes }
    // v0.7 coding-env ops — mirrors lane-C kind.ts. Inbound from PWA via
    // event-stream wire; the adapter translates these to SubprocessStdin / etc.
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

/// Pub-sub bus routing internal actor<->actor traffic (ADR-010 communication
/// § trust-domains v3, SC1). The bus is the INTERNAL trust-domain boundary: it
/// only accepts `InternalMsg` (Internal-by-construction), so a `GateRequest`
/// (External) has no path onto it — the compiler keeps cross-domain traffic off
/// the internal bus. Backed by a tokio broadcast so any actor can `subscribe`.
pub struct EventBus {
    tx: broadcast::Sender<Event>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        // Buffered broadcast: late subscribers miss old events (live stream,
        // not a log — the durable trail is `EventStore`). Capacity bounds lag.
        let (tx, _rx) = broadcast::channel(1024);
        Self { tx }
    }

    /// Publish internal actor->actor traffic onto the bus. Takes an
    /// `InternalMsg` so ONLY in-kernel (Internal-domain) traffic can be routed
    /// here — external/gate calls cannot construct one. Returns the number of
    /// live subscribers the event reached (0 when none are listening).
    pub fn publish(&self, msg: InternalMsg) -> usize {
        self.tx.send(msg.into_event()).unwrap_or(0)
    }

    /// Subscribe to the live internal event stream.
    pub fn subscribe(&self) -> broadcast::Receiver<Event> {
        self.tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::actor::ActorId;

    fn sample_op() -> Event {
        Event::Op(Op {
            kind: OpKind::ActorSpawned,
            ts_ms: 1,
            stream_id: None,
            payload: serde_json::json!({ "a": 1 }),
        })
    }

    #[test]
    fn publish_only_accepts_internal_msg_and_reaches_subscriber() {
        // The bus signature takes `InternalMsg` (Internal-by-construction), so a
        // GateRequest (External) has no way onto the internal bus — the domain
        // separation is enforced at the type level, verified here at runtime.
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        let reached = bus.publish(InternalMsg::from_actor(ActorId::from_str("actor-a"), sample_op()));
        assert_eq!(reached, 1, "the one live subscriber receives the event");
        match rx.try_recv().expect("subscriber receives the published event") {
            Event::Op(op) => assert_eq!(op.kind, OpKind::ActorSpawned),
            other => panic!("unexpected event {other:?}"),
        }
    }

    #[test]
    fn publish_with_no_subscribers_is_zero_not_an_error() {
        let bus = EventBus::new();
        let reached = bus.publish(InternalMsg::from_actor(ActorId::from_str("actor-a"), sample_op()));
        assert_eq!(reached, 0, "no subscribers => zero reached, never an error");
    }
}
