// Actor — independent execution unit with mailbox.
//
// Each actor owns its state (no shared mutable across actors). Handler
// is pure: (state, msg, ctx) → (state', effects). No direct IO, no direct
// LLM — all via Effect.
//
// Mirrors @ctrl/kernel-sdk actor.ts.

use crate::kernel::capability::Capability;
use crate::kernel::effect::Effect;
use crate::kernel::event::Event;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ActorId(pub String);

impl ActorId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
    pub fn from_str(s: impl Into<String>) -> Self {
        Self(s.into())
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ActorId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Default for ActorId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone)]
pub struct ActorContext {
    pub self_id: ActorId,
    pub parent_id: Option<ActorId>,
    pub capability: Capability,
    pub deadline_ms: Option<u64>,
}

/// Priority class for the scheduler. Lower number = higher priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorPriority {
    /// Hardware sources (camera, audio, hotkey, sensor). Preempts everything.
    Hardware = 0,
    /// LLM streaming chunks.
    LlmStream = 1,
    /// User-initiated keycap invocation, UI.
    UserAction = 2,
    /// Background analytics, market sync.
    Background = 3,
    /// Idle.
    Idle = 4,
}

impl Default for ActorPriority {
    fn default() -> Self {
        Self::UserAction
    }
}

/// The core actor trait. Each actor is a state machine handling Events
/// and emitting Effects. Implementations stay pure — no direct IO.
#[async_trait]
pub trait Actor: Send + 'static {
    /// Handle one incoming event. Returns the list of effects to execute.
    /// State mutation happens via &mut self.
    async fn handle(&mut self, msg: Event, ctx: &ActorContext) -> Vec<Effect>;

    /// Called once when the actor is spawned. Optional hook.
    async fn on_spawn(&mut self, _ctx: &ActorContext) -> Vec<Effect> {
        Vec::new()
    }

    /// Called when the actor is being terminated.
    async fn on_shutdown(&mut self) {}

    /// Human-readable name for logging.
    fn name(&self) -> &str;

    /// Scheduling priority class.
    fn priority(&self) -> ActorPriority {
        ActorPriority::default()
    }
}

/// Manifest describing how to instantiate an actor. Loaded from
/// tool manifest JSON (see .olym/specs/tool-manifest/spec.md).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActorManifest {
    pub prototype: String,
    pub capability: Capability,
    #[serde(default)]
    pub priority: ActorPriority,
    pub initial_state: serde_json::Value,
}

/// Handle to a running actor instance. Held by the scheduler.
/// P2.1 skeleton — wiring in P2.4.
pub struct ActorHandle {
    pub id: ActorId,
    pub manifest: ActorManifest,
}
