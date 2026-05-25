// L1 Kernel — CTRL microkernel.
//
// 5 primitives (mirrors @ctrl/kernel-sdk in TypeScript):
//   - Actor     : independent execution unit with mailbox
//   - Capability: static token bundle declaring what an actor may do
//   - Event     : ST-SS cell+op unified message format
//   - Channel   : typed pipe between actors (back-pressure)
//   - Effect    : first-class side effect (returned from actor handlers)
//
// Architecture lock: `.olym/decisions/001-system-architecture.md` §3
// Spec detail:       `.olym/specs/kernel/spec.md`
//
// Status: live. `runtime.rs` composes Scheduler / EventBus / CapabilityBroker
// / McpHost / EffectExecutor / EventStore / LlmPortRouter / LocalStorage at
// boot. Tauri commands in `crate::commands::*` dispatch through this module.

// dead-code allow keeps the public re-exports below cheap to maintain — many
// are part of the L1 kernel's public surface (consumed by future SDK / WASM
// keycap runtime) even when no in-tree caller exists today. Drop it once the
// kernel-sdk consumer ships.
#![allow(dead_code)]

pub mod actor;
pub mod brain_router;
pub mod cache;
pub mod capability;
pub mod composition;
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
pub mod runtime;
pub mod sandbox;
pub mod scheduler;
pub mod stss_bridge;
pub mod subprocess_actor;
pub mod subprocess_stss_adapter;
pub mod vault;
pub mod vault_index;

pub use actor::{Actor, ActorContext, ActorHandle, ActorId, ActorManifest, ActorPriority};
pub use brain_router::{BrainEndpoint, BrainRouter, BrainRouterError};
pub use capability::{CapToken, Capability, CapabilityBroker, CapabilityError};
pub use channel::{Channel, ChannelError, ChannelOptions, ChannelRx, ChannelTx, DropPolicy};
pub use effect::{Effect, EffectExecutor, HttpMethod};
pub use event::{Cell, CellKind, Event, EventBus, EventFilter, Op, OpKind};
pub use llm_port::{LlmAdapter, LlmChunk, LlmError, LlmMessage, LlmPortRouter, LlmPrompt};
pub use mcp_host::{McpHost, McpServerDescriptor, McpServerSource, McpToolDescriptor};
pub use mcp_server::{
    McpServerHandle, DEFAULT_LISTEN_ADDR as MCP_SERVER_LISTEN_ADDR,
};
pub use persistence::EventStore;
pub use runtime::{KernelBootError, KernelRuntime};
pub use sandbox::{SandboxConfig, WasmSandbox};
pub use scheduler::{ActorEntry, Scheduler, SchedulerError, SpawnResult};
pub use stss_bridge::{StssBridge, DEFAULT_LISTEN_ADDR as STSS_LISTEN_ADDR};
pub use subprocess_actor::{
    PtySpec, SubprocessActor, SubprocessOutbox, SubprocessSpawnError, SubprocessSpec,
    DEFAULT_MEM_CAP_BYTES, DEFAULT_OUTBOX_CAPACITY,
};
