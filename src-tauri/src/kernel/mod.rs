// L1 Kernel — CTRL microkernel.
//
// 5 primitives (mirrors @ctrl/kernel-sdk in TypeScript):
//   - Actor     : independent execution unit with mailbox
//   - Capability: static token bundle declaring what an actor may do
//   - Event     : event-stream cell+op unified message format
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
pub mod ai_column;
pub mod audit;
pub mod cache;
pub mod capability;
pub mod capability_resolver;
pub mod channel;
pub mod effect;
pub mod event;
pub mod local_storage;
pub mod mcp_host;
pub mod mcp_server;
pub mod pack_sandbox;
pub mod persistence;
pub mod review_gate;
// BYO-CLI driver projection (ADR-001 §4 projector / ADR-002 § projection) —
// materialize the kernel MCP gate into the user's CLI driver native config
// (project-scoped `.mcp.json`) so the driver auto-discovers it on launch.
pub mod projector;
pub mod provider;
pub mod query;
pub mod runtime;
pub mod runtime_sources;
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
pub mod event_ws;
pub mod subprocess_actor;
pub mod subprocess_channel_adapter;
pub mod smart_table_index;
// ADR-002 §7 feature pack (governing `vault/ctrl/ai-native-feature-pack-research.md`)
// — Ghostfolio (self-hosted finance) lifted into a §14 RecordSource: the first
// seed proving "make an open-source app AI-native through the gate", the
// AI-native uplift layer (uniform describe/query) over its raw REST.
pub mod ghostfolio_source;
// Feature-pack provision+auth engine (governing
// `vault/ctrl/feature-pack-provision-auth-engine.md`) — generic runtime that
// makes any self-hosted connector one-click + silent from its manifest data:
// pack_auth = declared bootstrap / token-exchange executors; pack_provision =
// generated-secret + compose provisioning + install orchestration.
pub mod pack_auth;
pub mod pack_provision;
// ADR-002 substrate §14.12 — generic manifest-driven §14 connector source: a REST
// connector's schema + JSON→Row map + endpoints are DATA (`record_source`), one
// generic runtime reproduces the hand-coded connector (ghostfolio = first
// data-driven instance) so adding a connector is zero Rust (§7.4/§7.5).
pub mod manifest_source;
// ADR-002 substrate §14 (LifeOS layer Phase 1, governing
// `vault/ctrl/lifeos-layer-restructure.md`) — tasks as a §14 RecordSource:
// one plain-markdown file per task (vim test), describe/query via the shared
// engine, produce (create/update) through the vault layer.
pub mod tasks_source;
pub mod vault;
pub mod visibility;
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

// Real end-to-end pipeline tests for the smart-table module (ADR-002 §14):
// disk file -> read -> parse -> describe/query/produce -> write, asserting the
// actual outputs (no mocks). Report:
//   cargo test --lib kernel::pipeline_e2e -- --nocapture --test-threads=1
#[cfg(test)]
mod pipeline_e2e;

pub use mcp_server::DEFAULT_LISTEN_ADDR as MCP_SERVER_LISTEN_ADDR;
pub use event_ws::{EventWsBridge, DEFAULT_LISTEN_ADDR as EVENT_WS_LISTEN_ADDR};
