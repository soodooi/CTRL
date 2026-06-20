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
pub mod cache;
pub mod capability;
pub mod capability_resolver;
pub mod channel;
pub mod effect;
pub mod event;
pub mod local_storage;
pub mod mcp_host;
pub mod mcp_server;
pub mod persistence;
// BYO-CLI driver projection (ADR-001 §4 projector / ADR-002 § projection) —
// materialize the kernel MCP gate into the user's CLI driver native config
// (project-scoped `.mcp.json`) so the driver auto-discovers it on launch.
pub mod projector;
pub mod provider;
pub mod query;
pub mod runtime;
pub mod scheduler;
// Vault embeddings substrate (ADR-002 v5 §10) — local Ollama
// nomic-embed-text + SQLite BLOB flat cosine search. Memory
// `decision_vault_adr_002_section_8`.
pub mod vault_embeddings;
// Mcp output capture (ADR-002 v5 §9) — single SmartTable per mcp.
pub mod mcp_capture;
// Daily-cron tick for vault sourcing. Spawned from Runtime::boot. See
// ADR-002 substrate § vault v1 §8.4 + memory
// `decision_vault_adr_002_section_8`.
pub mod sourcing_scheduler;
pub mod stss_bridge;
pub mod subprocess_actor;
pub mod subprocess_stss_adapter;
pub mod vault;
pub mod vault_notes_source;
pub mod vault_smart_table;
// ADR-002 substrate § vault v1 §8.3 #9-15, 2026-06-01 —
// vault_graph: in-memory link/tag/mention/orphan/broken_links/graph_data scanner
// (memory `decision_vault_adr_002_section_8`).
pub mod vault_graph;
pub mod vault_index;
// ADR-002 substrate § vault v1 §8.3 #21, 2026-06-01 — vault_watch:
// notify-backed file-event stream for sourcing trigger (count-threshold path).
pub mod vault_watch;
// ADR-002 substrate § vault v1 §8.4 sourcing-workflow, 2026-06-01 —
// kernel-side seed sourcing routine (memory
// `decision_vault_adr_002_section_8`). Irisy attaches a richer
// LLM-backed version on top of the same review-queue file.
pub mod vault_sourcing;

pub use mcp_server::DEFAULT_LISTEN_ADDR as MCP_SERVER_LISTEN_ADDR;
pub use stss_bridge::{StssBridge, DEFAULT_LISTEN_ADDR as STSS_LISTEN_ADDR};
