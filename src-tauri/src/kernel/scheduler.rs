// Scheduler — actor scheduling with priority + deadline awareness.
//
// RTOS-inspired:
//   - Priority preemption: hardware actors > LLM stream > user action > background > idle
//   - Deadline awareness: every LLM call carries deadline_ms, scheduler fails over on timeout
//   - Static resource budget: actor declares budget at spawn, scheduler rejects over-allocation
//
// P2.1 skeleton — full wiring in P2.5.

use crate::kernel::actor::{ActorHandle, ActorId, ActorPriority};
use crate::kernel::capability::Capability;
use crate::kernel::channel::Channel;
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct Scheduler {
    actors: Arc<RwLock<BTreeMap<ActorId, ActorEntry>>>,
}

pub struct ActorEntry {
    pub handle: ActorHandle,
    pub capability: Capability,
    pub priority: ActorPriority,
    pub mailbox: Channel,
}

impl Scheduler {
    pub fn new() -> Self {
        Self {
            actors: Arc::new(RwLock::new(BTreeMap::new())),
        }
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}
