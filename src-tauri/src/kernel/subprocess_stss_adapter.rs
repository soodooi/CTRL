// SubprocessActor ↔ ST-SS bridge translator + forwarder.
//
// PR #6 ADR-012 left SubprocessActor with an outbox mpsc::Sender<Event> using
// kernel-internal OpKind names (SubprocessStdout / SubprocessExit /
// SubprocessSpawned). lane-C C1 (spec v0.7) standardised the ST-SS wire
// vocabulary with publisher-neutral CellKind / OpKind values
// (terminal_output / terminal_exit / env_status / agent_prompt / env_signal).
//
// This module bridges the two:
//   • Receives Events from a SubprocessActor outbox channel
//   • Translates kernel-internal naming → ST-SS wire naming per spec v0.7
//   • Re-emits via StssBridge.publish_cell / publish_op (broadcast to
//     subscribed PWA clients)
//
// Inverse direction (Op inbound from PWA → SubprocessActor) lives in the
// commands::code_space module: a Tauri command receives the spec-v0.7 Op
// (agent_prompt / env_signal) and posts the kernel-internal equivalent
// (SubprocessStdin / SubprocessSignal) into the actor's mailbox.

use crate::kernel::event::{Cell, CellKind, Event, Op, OpKind};
use crate::kernel::stss_bridge::StssBridge;
use tokio::sync::mpsc;
use tracing::{debug, warn};

/// Forwarder task — drains a SubprocessActor outbox into the ST-SS bridge.
///
/// Spawn one per actor (the actor's lifetime owns the channel; when the
/// child exits and the outbox closes, this task exits cleanly).
///
/// `stream_id` is what PWA subscribers filter on (typically the actor's
/// name, mirrored from the manifest).
///
/// `StssBridge` is `Clone` and internally `Arc`-backed (broadcast::Sender),
/// so we take ownership of a clone rather than re-wrapping in `Arc<...>`.
pub async fn forward_subprocess_outbox(
    mut outbox: mpsc::Receiver<Event>,
    bridge: StssBridge,
    stream_id: String,
) {
    debug!(stream_id = %stream_id, "subprocess_stss_adapter: forwarder started");
    while let Some(event) = outbox.recv().await {
        translate_and_publish(event, &bridge, &stream_id);
    }
    debug!(stream_id = %stream_id, "subprocess_stss_adapter: forwarder ended (outbox closed)");
}

/// Translate one kernel-internal Event into the spec-v0.7 wire shape and
/// publish via the bridge. Unknown / non-translatable Ops are dropped with
/// a debug log (forward-compat: receivers tolerate unknown kinds).
fn translate_and_publish(event: Event, bridge: &StssBridge, stream_id: &str) {
    match event {
        Event::Op(op) => translate_op(op, bridge, stream_id),
        Event::Cell(cell) => {
            // SubprocessActor today never emits a Cell directly, but if a
            // future actor variant does, pass through (re-stamp stream_id
            // so all wire events share the same source identity).
            let restamped = Cell {
                stream_id: Some(stream_id.into()),
                ..cell
            };
            bridge.publish_cell(restamped);
        }
    }
}

fn translate_op(op: Op, bridge: &StssBridge, stream_id: &str) {
    match op.kind {
        OpKind::SubprocessStdout => {
            // Internal Op → spec v0.7 Cell { kind: terminal_output }.
            // Conceptually a stream observation (latest chunk of bytes
            // emitted by the child), so Cell is the right wire envelope.
            bridge.publish_cell(Cell {
                kind: CellKind::TerminalOutput,
                ts_ms: op.ts_ms,
                stream_id: Some(stream_id.into()),
                payload: op.payload,
            });
        }
        OpKind::SubprocessExit => {
            // Exit is a one-shot terminal state — Cell (snapshot of final
            // state) per spec v0.7. PWA renders it as a footer banner.
            bridge.publish_cell(Cell {
                kind: CellKind::TerminalExit,
                ts_ms: op.ts_ms,
                stream_id: Some(stream_id.into()),
                payload: op.payload,
            });
        }
        OpKind::SubprocessSpawned => {
            // Spawned is a status transition — re-emit as env_status Cell
            // with payload.state = "running" so the PWA header pill updates.
            let payload = match op.payload {
                serde_json::Value::Object(mut map) => {
                    map.insert(
                        "state".into(),
                        serde_json::Value::String("running".into()),
                    );
                    serde_json::Value::Object(map)
                }
                other => serde_json::json!({ "state": "running", "original": other }),
            };
            bridge.publish_cell(Cell {
                kind: CellKind::EnvStatus,
                ts_ms: op.ts_ms,
                stream_id: Some(stream_id.into()),
                payload,
            });
        }
        // Inbound-only kinds (PWA → kernel → actor); the actor never emits
        // these outbound. Defensive log + drop.
        //
        // Two families: (a) kernel-internal Subprocess* family routed by
        // commands::code_space; (b) v0.7 wire-facing family that PWA may
        // re-emit if it echoes its own ops (forward-compat). Both share
        // the same "outbound from actor outbox = bug or future-future"
        // contract, so we drop both with a single arm to prevent silent
        // wire-spec violations (themis HIGH).
        OpKind::SubprocessStdin
        | OpKind::SubprocessResize
        | OpKind::SubprocessSignal
        | OpKind::AgentPrompt
        | OpKind::AgentInterrupt
        | OpKind::EnvSignal
        | OpKind::FileRequest => {
            warn!(
                stream_id = %stream_id,
                kind = ?op.kind,
                "subprocess_stss_adapter: outbox emitted an inbound-only OpKind — dropping"
            );
        }
        // Other kernel OpKinds (kernel-wide events not belonging to this
        // actor): pass through unchanged so subscribers can observe them
        // if they want. They keep their kernel-internal kind.
        _ => {
            bridge.publish_op(Op {
                stream_id: Some(stream_id.into()),
                ..op
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::broadcast;

    /// Helper: instantiate a bridge and capture the next published Event
    /// from its broadcast channel.
    async fn bridge_with_receiver() -> (StssBridge, broadcast::Receiver<Event>) {
        let bridge = StssBridge::new();
        // Subscribe BEFORE any publish (broadcast has zero-buffer for new
        // subscribers).
        let rx = bridge.subscribe_events();
        (bridge, rx)
    }

    fn fake_op(kind: OpKind, payload: serde_json::Value) -> Op {
        Op {
            kind,
            ts_ms: 1_700_000_000_000,
            stream_id: Some("actor-original".into()),
            payload,
        }
    }

    #[tokio::test]
    async fn stdout_translates_to_terminal_output_cell() {
        let (bridge, mut rx) = bridge_with_receiver().await;
        let op = fake_op(
            OpKind::SubprocessStdout,
            serde_json::json!({"actor": "x", "pid": 42, "data_b64": "aGk=", "len": 2}),
        );

        translate_and_publish(Event::Op(op), &bridge, "stream-xyz");

        let ev = rx.try_recv().expect("expected published event");
        match ev {
            Event::Cell(cell) => {
                assert_eq!(cell.kind, CellKind::TerminalOutput);
                assert_eq!(cell.stream_id.as_deref(), Some("stream-xyz"));
                assert_eq!(cell.payload["data_b64"], "aGk=");
            }
            _ => panic!("expected Cell, got {ev:?}"),
        }
    }

    #[tokio::test]
    async fn exit_translates_to_terminal_exit_cell() {
        let (bridge, mut rx) = bridge_with_receiver().await;
        let op = fake_op(
            OpKind::SubprocessExit,
            serde_json::json!({"actor": "x", "pid": 42, "code": 7}),
        );

        translate_and_publish(Event::Op(op), &bridge, "stream-xyz");

        let ev = rx.try_recv().expect("expected published event");
        match ev {
            Event::Cell(cell) => {
                assert_eq!(cell.kind, CellKind::TerminalExit);
                assert_eq!(cell.payload["code"], 7);
            }
            _ => panic!("expected Cell"),
        }
    }

    #[tokio::test]
    async fn spawned_translates_to_env_status_running() {
        let (bridge, mut rx) = bridge_with_receiver().await;
        let op = fake_op(
            OpKind::SubprocessSpawned,
            serde_json::json!({"actor": "x", "pid": 42, "command": "bash"}),
        );

        translate_and_publish(Event::Op(op), &bridge, "stream-xyz");

        let ev = rx.try_recv().expect("expected published event");
        match ev {
            Event::Cell(cell) => {
                assert_eq!(cell.kind, CellKind::EnvStatus);
                assert_eq!(cell.payload["state"], "running");
                // Original fields preserved
                assert_eq!(cell.payload["pid"], 42);
            }
            _ => panic!("expected Cell"),
        }
    }

    #[tokio::test]
    async fn inbound_only_kinds_are_dropped() {
        let (bridge, mut rx) = bridge_with_receiver().await;
        for kind in [
            OpKind::SubprocessStdin,
            OpKind::SubprocessResize,
            OpKind::SubprocessSignal,
        ] {
            let op = fake_op(kind, serde_json::json!({}));
            translate_and_publish(Event::Op(op), &bridge, "stream-xyz");
        }
        // Nothing should have reached the wire.
        assert!(rx.try_recv().is_err());
    }
}
