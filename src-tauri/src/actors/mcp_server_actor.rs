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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::actor::ActorId;
    use crate::kernel::capability::Capability;
    use crate::kernel::event::Op;
    use serde_json::json;

    fn ctx() -> ActorContext {
        ActorContext {
            self_id: ActorId::from_str("test-actor"),
            parent_id: None,
            capability: Capability::empty(),
            deadline_ms: None,
        }
    }

    #[tokio::test]
    async fn handle_keycap_invoked_emits_mcp_invoke_effect() {
        let mut actor = McpServerActor::new("bazi-mcp", "Bazi MCP");
        let op = Op {
            kind: OpKind::KeycapInvoked,
            ts_ms: 0,
            stream_id: None,
            payload: json!({"tool": "compute_chart", "args": {"date": "2026-05-17"}}),
        };
        let effects = actor.handle(Event::Op(op), &ctx()).await;
        assert_eq!(effects.len(), 1);
        match &effects[0] {
            Effect::McpInvoke { server, tool, args, .. } => {
                assert_eq!(server, "bazi-mcp");
                assert_eq!(tool, "compute_chart");
                assert_eq!(args["date"], "2026-05-17");
            }
            other => panic!("expected McpInvoke, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn handle_unrelated_op_emits_nothing() {
        let mut actor = McpServerActor::new("bazi-mcp", "Bazi MCP");
        let op = Op {
            kind: OpKind::HotkeyTriggered,
            ts_ms: 0,
            stream_id: None,
            payload: json!({}),
        };
        let effects = actor.handle(Event::Op(op), &ctx()).await;
        assert!(effects.is_empty());
    }

    #[test]
    fn name_returns_display_name() {
        let actor = McpServerActor::new("id-x", "Display Name");
        assert_eq!(actor.name(), "Display Name");
    }
}
