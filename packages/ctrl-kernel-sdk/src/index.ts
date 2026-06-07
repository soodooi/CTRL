// @ctrl/kernel-sdk — L2 syscall surface for CTRL L1 Rust Kernel.
//
// Exposes 5 primitives mirrored from Rust kernel:
//   Actor / Capability / Event / Channel / Effect
//
// Userland actors (L3 mcps) target this SDK. Concrete implementation
// routes via Tauri invoke to L1 Kernel. P2 will wire the bridge.

export type { Event, Cell, Op, CellKind, OpKind, EventFilter } from './event.js';
export type { Capability, CapToken } from './capability.js';
export { capability, hasToken } from './capability.js';
export type {
  Effect,
  LlmCallEffect,
  McpInvokeEffect,
  EmitEventEffect,
  SpawnActorEffect,
  PersistEventEffect,
  ShellExecEffect,
  HttpRequestEffect,
} from './effect.js';
export { Eff } from './effect.js';
export type { ActorId, ActorContext, ActorHandler, ActorManifest } from './actor.js';
export { defineActor } from './actor.js';
export type { Channel, ChannelTx, ChannelRx, DropPolicy, ChannelOptions } from './channel.js';
