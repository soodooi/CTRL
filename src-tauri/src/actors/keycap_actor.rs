// KeycapActor — wraps a Tool manifest as a kernel::Actor.
//
// Lifetime: spawned on keycap invocation, terminates after completion.
// On `keycap_invoked` Op, runs the action's steps (each step → Effect),
// emits `keycap_completed` Op when done. Capability check happens at
// effect-execution boundary (kernel::EffectExecutor + CapabilityBroker).
//
// P2.5 stage: skeleton. The real `handle()` implementation that walks
// `Action.steps` and translates each Step to one or more Effects lands
// in P5 (manifest-driven execution). For now it logs and exits.

use crate::domain::tool::Tool;
use crate::kernel::actor::{Actor, ActorContext, ActorPriority};
use crate::kernel::effect::Effect;
use crate::kernel::event::{Event, OpKind};
use async_trait::async_trait;

pub struct KeycapActor {
    pub tool: Tool,
    pub current_action_id: Option<String>,
}

impl KeycapActor {
    pub fn new(tool: Tool) -> Self {
        Self {
            tool,
            current_action_id: None,
        }
    }
}

#[async_trait]
impl Actor for KeycapActor {
    async fn handle(&mut self, msg: Event, _ctx: &ActorContext) -> Vec<Effect> {
        match &msg {
            Event::Op(op) if op.kind == OpKind::KeycapInvoked => {
                tracing::info!(
                    tool = %self.tool.id,
                    "keycap_invoked received (P2.5 stub — full step execution in P5)"
                );
                // Future: walk self.tool.actions, translate each Step to Effect,
                // return Vec<Effect>. For now no-op.
                Vec::new()
            }
            _ => Vec::new(),
        }
    }

    fn name(&self) -> &str {
        &self.tool.name
    }

    fn priority(&self) -> ActorPriority {
        // User-initiated keycap invocation. Hardware actors preempt this.
        ActorPriority::UserAction
    }
}
