// Scheduler — actor scheduling with priority + deadline awareness.
//
// RTOS-inspired:
//   - Priority preemption: hardware actors > LLM stream > user action > background > idle
//   - Deadline awareness: every LLM call carries deadline_ms, scheduler fails over on timeout
//   - Static resource budget: actor declares budget at spawn, scheduler rejects over-allocation
//
// P2.1 skeleton — extended in H-2026-05-19-001 (ADR-012) with
// `spawn_from_manifest`: the entry point the runtime calls when a manifest
// of `prototype: "subprocess"` lands. Other prototypes return
// `SchedulerError::UnknownPrototype` until their well-known Actor subclass
// is wired in (KeycapActor wiring is P5, MCPServerActor is its own handoff).

use crate::kernel::actor::{Actor, ActorContext, ActorHandle, ActorId, ActorManifest, ActorPriority};
use crate::kernel::capability::Capability;
use crate::kernel::channel::Channel;
use crate::kernel::event::Event;
use crate::kernel::subprocess_actor::{SubprocessActor, DEFAULT_OUTBOX_CAPACITY};
use futures::FutureExt;
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

pub struct Scheduler {
    actors: Arc<RwLock<BTreeMap<ActorId, ActorEntry>>>,
}

pub struct ActorEntry {
    pub handle: ActorHandle,
    pub capability: Capability,
    pub priority: ActorPriority,
    pub mailbox: Channel,
}

/// Returned from `spawn_from_manifest`. Caller posts inbound events to
/// `mailbox` and consumes outbound events from `outbox`.
pub struct SpawnResult {
    pub actor_id: ActorId,
    pub mailbox: mpsc::Sender<Event>,
    pub outbox: mpsc::Receiver<Event>,
}

#[derive(Debug, thiserror::Error)]
pub enum SchedulerError {
    #[error("manifest parse: {0}")]
    ManifestParse(String),
    #[error("unknown prototype: {0}")]
    UnknownPrototype(String),
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            actors: Arc::new(RwLock::new(BTreeMap::new())),
        }
    }

    /// Spawn an actor from an ActorManifest. Branches on `manifest.prototype`.
    ///
    /// Lifecycle task runs `on_spawn` once, then loops on the mailbox calling
    /// `handle` per event. `on_shutdown` runs when the mailbox closes (last
    /// mailbox sender dropped) or when the task is aborted.
    ///
    /// Supervisor (ADR-012 §5):
    ///   - each `handle()` invocation wrapped in catch_unwind: an actor's
    ///     panic does NOT crash the kernel; the failing message is skipped,
    ///     the actor stays alive for subsequent messages.
    pub async fn spawn_from_manifest(
        &self,
        manifest: ActorManifest,
    ) -> Result<SpawnResult, SchedulerError> {
        let id = ActorId::new();
        let (mailbox_tx, mut mailbox_rx) = mpsc::channel::<Event>(DEFAULT_OUTBOX_CAPACITY);
        let (outbox_tx, outbox_rx) = mpsc::channel::<Event>(DEFAULT_OUTBOX_CAPACITY);

        let ctx = ActorContext {
            self_id: id.clone(),
            parent_id: None,
            capability: manifest.capability.clone(),
            deadline_ms: None,
        };

        let mut actor: Box<dyn Actor> = match manifest.prototype.as_str() {
            "subprocess" => {
                let a = SubprocessActor::from_manifest_state(
                    id.as_str().to_string(),
                    manifest.initial_state.clone(),
                    outbox_tx.clone(),
                )
                .map_err(|e| SchedulerError::ManifestParse(e.to_string()))?;
                Box::new(a)
            }
            other => return Err(SchedulerError::UnknownPrototype(other.into())),
        };

        let actor_name = actor.name().to_string();

        tokio::spawn(async move {
            // on_spawn — wrapped in catch_unwind to honor supervisor #1.
            let spawn_fut = std::panic::AssertUnwindSafe(actor.on_spawn(&ctx)).catch_unwind();
            if let Err(_panic) = spawn_fut.await {
                tracing::error!(actor = %actor_name, "on_spawn panicked");
            }
            // Mailbox loop.
            loop {
                let Some(msg) = mailbox_rx.recv().await else {
                    break; // all senders dropped
                };
                let handle_fut =
                    std::panic::AssertUnwindSafe(actor.handle(msg, &ctx)).catch_unwind();
                match handle_fut.await {
                    Ok(_effects) => {
                        // Effect dispatch lane lands in P5 (EffectExecutor wiring).
                    }
                    Err(_) => {
                        tracing::error!(actor = %actor_name, "handle() panicked — skipping message");
                    }
                }
            }
            actor.on_shutdown().await;
        });

        Ok(SpawnResult {
            actor_id: id,
            mailbox: mailbox_tx,
            outbox: outbox_rx,
        })
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::actor::ActorManifest;
    use crate::kernel::capability::Capability;
    use crate::kernel::event::{Event, OpKind};

    #[tokio::test]
    async fn unknown_prototype_rejected() {
        let s = Scheduler::new();
        let m = ActorManifest {
            prototype: "no-such-prototype".into(),
            capability: Capability::empty(),
            priority: ActorPriority::default(),
            initial_state: serde_json::Value::Null,
        };
        match s.spawn_from_manifest(m).await {
            Err(SchedulerError::UnknownPrototype(_)) => {}
            Err(other) => panic!("wrong error: {other:?}"),
            Ok(_) => panic!("expected UnknownPrototype error"),
        }
    }

    #[tokio::test]
    async fn subprocess_manifest_parse_error_when_missing_command() {
        let s = Scheduler::new();
        let m = ActorManifest {
            prototype: "subprocess".into(),
            capability: Capability::empty(),
            priority: ActorPriority::default(),
            initial_state: serde_json::json!({ "args": ["x"] }),
        };
        match s.spawn_from_manifest(m).await {
            Err(SchedulerError::ManifestParse(_)) => {}
            Err(other) => panic!("wrong error: {other:?}"),
            Ok(_) => panic!("expected ManifestParse error"),
        }
    }

    /// Spawn a subprocess actor from a manifest, verify the lifecycle path
    /// emits Spawned + Exit through the outbox.
    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn spawn_from_manifest_subprocess_emits_spawned_and_exit() {
        let s = Scheduler::new();
        let m = ActorManifest {
            prototype: "subprocess".into(),
            capability: Capability::empty(),
            priority: ActorPriority::default(),
            initial_state: serde_json::json!({
                "command": "bash",
                "args": ["-c", "exit 0"],
                "pty": { "cols": 80, "rows": 24 },
            }),
        };
        let mut result = s.spawn_from_manifest(m).await.expect("spawn ok");
        let mut saw_spawned = false;
        let mut saw_exit = false;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(remaining, result.outbox.recv()).await {
                Ok(Some(Event::Op(op))) => match op.kind {
                    OpKind::SubprocessSpawned => saw_spawned = true,
                    OpKind::SubprocessExit => {
                        saw_exit = true;
                        break;
                    }
                    _ => {}
                },
                _ => break,
            }
        }
        assert!(saw_spawned, "missing SubprocessSpawned");
        assert!(saw_exit, "missing SubprocessExit");
    }
}
