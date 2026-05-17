// MCPServerActor — well-known Actor subclass that wraps a single MCP server
// connection. Per ADR-010 §2, MCP is the SOLE external interface for keycaps;
// every keycap (builtin / external / OAuth-wrapped / CLI-wrapped) presents
// itself as an MCP server, and this actor is how the kernel embodies one
// running instance.
//
// Lifetime:
//   on_spawn   → ensure McpHost::connect for `server_id` (lazy if cold)
//   handle(Op::McpInvoke{server, tool, args}) where server == self.server_id
//     → emit Effect::McpInvoke; capability checked at executor boundary
//   on_shutdown → optional McpHost::disconnect (idle-suspend policy P3.9)
//
// Not embedded in this skeleton (deferred to P5):
//   - tool list caching with TTL
//   - mcp notifications → ST-SS bridge (Pattern F, see stss-protocol spec)
//   - resource quota per server (CPU / mem / call budget)

use crate::kernel::actor::{Actor, ActorContext, ActorPriority};
use crate::kernel::effect::Effect;
use crate::kernel::event::{Event, OpKind};
use async_trait::async_trait;

pub struct McpServerActor {
    /// MCP server descriptor id registered with McpHost.
    pub server_id: String,
    /// Display name for logs/UX.
    pub name: String,
}

impl McpServerActor {
    pub fn new(server_id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            server_id: server_id.into(),
            name: name.into(),
        }
    }
}

#[async_trait]
impl Actor for McpServerActor {
    async fn on_spawn(&mut self, _ctx: &ActorContext) -> Vec<Effect> {
        tracing::info!(
            server = %self.server_id,
            "MCPServerActor spawned (lazy connect on first invoke)"
        );
        Vec::new()
    }

    async fn handle(&mut self, msg: Event, ctx: &ActorContext) -> Vec<Effect> {
        match &msg {
            // KeycapInvoked is the kernel-side trigger. Payload is expected
            // to carry { tool, args } scoped to this server. The actor
            // re-emits as Effect::McpInvoke so the executor performs the
            // capability check + dispatch via McpHost.
            Event::Op(op) if op.kind == OpKind::KeycapInvoked => {
                let payload = &op.payload;
                let tool = payload
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let args = payload
                    .get("args")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);

                vec![Effect::McpInvoke {
                    server: self.server_id.clone(),
                    tool,
                    args,
                    reply_to: ctx.self_id.clone(),
                }]
            }
            _ => Vec::new(),
        }
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn priority(&self) -> ActorPriority {
        ActorPriority::UserAction
    }
}
