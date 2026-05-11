// Effect — first-class side effect. Returned from actor handlers.
//
// Kernel executes effects asynchronously, checking capability before each.
// Effects carry `reply_to` ActorId for async result delivery.
// Mirrors @ctrl/kernel-sdk effect.ts.

use crate::kernel::actor::ActorId;
use crate::kernel::capability::Capability;
use crate::kernel::event::Event;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "PascalCase")]
pub enum Effect {
    LlmCall {
        model: String,
        prompt: serde_json::Value,
        deadline_ms: u64,
        reply_to: ActorId,
    },
    McpInvoke {
        server: String,
        tool: String,
        args: serde_json::Value,
        reply_to: ActorId,
    },
    EmitEvent {
        target: ActorId,
        event: Event,
    },
    SpawnActor {
        prototype: String,
        capability: Capability,
        parent_id: ActorId,
        initial_state: serde_json::Value,
    },
    PersistEvent {
        event: Event,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        index: Vec<String>,
    },
    ShellExec {
        cmd: String,
        args: Vec<String>,
        reply_to: ActorId,
    },
    HttpRequest {
        method: HttpMethod,
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<serde_json::Value>,
        reply_to: ActorId,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Delete,
}

/// Executes effects asynchronously, checking capability + deadlines.
/// P2.1 skeleton — concrete execution wired in P2.4-P2.7.
pub struct EffectExecutor;

impl EffectExecutor {
    pub fn new() -> Self {
        Self
    }
}

impl Default for EffectExecutor {
    fn default() -> Self {
        Self::new()
    }
}
