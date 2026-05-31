// L1 Kernel — CTRL microkernel.
//
// 5 primitives (mirrors @ctrl/kernel-sdk in TypeScript):
//   - Actor     : independent execution unit with mailbox
//   - Capability: static token bundle declaring what an actor may do
//   - Event     : ST-SS cell+op unified message format
//   - Channel   : typed pipe between actors (back-pressure)
//   - Effect    : first-class side effect (returned from actor handlers)
//
// Architecture lock: see .olym/decisions/001-system-architecture.md
// Spec detail:       see .olym/specs/kernel/spec.md
//
// `#[allow(dead_code)]` is retained here because several primitive
// surfaces are publicly exported for the Tauri command layer / the TS
// SDK mirror but only a subset is actively dispatched. Without it the
// build emits warnings on intentionally-unused exports.

#![allow(dead_code)]

pub mod actor;
pub mod brain_config;
pub mod cache;
pub mod capability;
pub mod capability_resolver;
pub mod channel;
pub mod effect;
pub mod event;
pub mod local_storage;
pub mod llm_adapters;
pub mod llm_port;
pub mod mcp_host;
pub mod mcp_server;
pub mod persistence;
pub mod provider;
pub mod runtime;
pub mod scheduler;
pub mod stss_bridge;
pub mod subprocess_actor;
pub mod subprocess_stss_adapter;
pub mod vault;
pub mod vault_index;

pub use actor::{Actor, ActorContext, ActorHandle, ActorId, ActorManifest, ActorPriority};
pub use capability::{CapToken, Capability, CapabilityBroker, CapabilityError};
pub use channel::{Channel, ChannelError, ChannelOptions, ChannelRx, ChannelTx, DropPolicy};
pub use effect::{Effect, EffectExecutor, HttpMethod};
pub use event::{Cell, CellKind, Event, EventBus, EventFilter, Op, OpKind};
pub use llm_port::{LlmAdapter, LlmChunk, LlmError, LlmMessage, LlmPortRouter, LlmPrompt};
pub use mcp_host::{McpHost, McpServerDescriptor, McpServerSource, McpToolDescriptor};
pub use mcp_server::{McpServerHandle, DEFAULT_LISTEN_ADDR as MCP_SERVER_LISTEN_ADDR};
pub use persistence::EventStore;
pub use runtime::{KernelBootError, KernelRuntime};
pub use scheduler::{ActorEntry, Scheduler, SchedulerError, SpawnResult};
pub use stss_bridge::{StssBridge, DEFAULT_LISTEN_ADDR as STSS_LISTEN_ADDR};
pub use subprocess_actor::{
    PtySpec, SubprocessActor, SubprocessOutbox, SubprocessSpawnError, SubprocessSpec,
    DEFAULT_MEM_CAP_BYTES, DEFAULT_OUTBOX_CAPACITY,
};
