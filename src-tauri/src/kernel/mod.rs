// L1 Kernel — CTRL microkernel.
//
// 5 primitives (mirrors @ctrl/kernel-sdk in TypeScript):
//   - Actor     : independent execution unit with mailbox
//   - Capability: static token bundle declaring what an actor may do
//   - Event     : ST-SS cell+op unified message format
//   - Channel   : typed pipe between actors (back-pressure)
//   - Effect    : first-class side effect (returned from actor handlers)
//
// Architecture lock: see ../../../.claude/ADR/001-system-architecture.md §3
// Spec detail:       see ../../../.olym/specs/kernel/spec.md
//
// Status: P2.1 — skeleton stage. Trait + enum + struct shells. No live wiring
// yet. Existing application/use_cases.rs path keeps running independently.
// Full integration in P2.4-P2.7.

pub mod actor;
pub mod capability;
pub mod channel;
pub mod effect;
pub mod event;
pub mod llm_port;
pub mod mcp_host;
pub mod persistence;
pub mod sandbox;
pub mod scheduler;

pub use actor::{Actor, ActorContext, ActorHandle, ActorId, ActorManifest, ActorPriority};
pub use capability::{CapToken, Capability, CapabilityBroker, CapabilityError};
pub use channel::{Channel, ChannelError, ChannelOptions, ChannelRx, ChannelTx, DropPolicy};
pub use effect::{Effect, EffectExecutor, HttpMethod};
pub use event::{Cell, CellKind, Event, EventBus, EventFilter, Op, OpKind};
pub use llm_port::{LlmAdapter, LlmChunk, LlmError, LlmMessage, LlmPortRouter, LlmPrompt};
pub use mcp_host::{McpHost, McpServerDescriptor, McpServerSource, McpToolDescriptor};
pub use persistence::EventStore;
pub use sandbox::{SandboxConfig, WasmSandbox};
pub use scheduler::{ActorEntry, Scheduler};
