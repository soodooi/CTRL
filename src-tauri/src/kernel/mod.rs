// L1 Kernel — CTRL microkernel.
//
// 5 primitives (mirrors @ctrl/kernel-sdk in TypeScript):
//   - Actor     : independent execution unit with mailbox
//   - Capability: static token bundle declaring what an actor may do
//   - Event     : event-stream cell+op unified message format
//   - Channel   : typed pipe between actors (back-pressure)
//   - Effect    : first-class side effect (returned from actor handlers)
//
// Architecture lock: see vault/ctrl/adrs/001-spine.md
// Substrate detail:  see vault/ctrl/adrs/002-substrate.md
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
pub mod calendar_source;
pub mod capability;
pub mod capability_resolver;
// User-owned enable/disable state for installed capabilities, kept as plain
// text so `installed` is no longer the only reachable state.
// (ADR-002 substrate §15.4.1 v88)
pub mod capability_state;
// A conversation is user content, so it lives as readable Markdown rather than
// only inside browser storage. (ADR-005 irisy §11.2 v44)
pub mod transcript_format;
pub mod session_resource;
// Task writes carry a typed Outcome instead of a sentence.
// (ADR-002 substrate §15.2 v87)
pub mod calendar_resource;
pub mod record_write;
pub mod table_resource;
pub mod task_resource;
pub mod channel;
// One Rust-owned metadata composer; no parallel owner runtime.
// (ADR-010 communication § diagnostics v11)
pub mod diagnostics;
pub mod effect;
pub mod event;
// Read-only normalized FCT projection over package/Skill authorities.
// (ADR-002 substrate §15.4 v84)
// (ADR-002 substrate §16 v84)
pub mod fct_catalog;
pub mod local_storage;
// Private LibreOffice bridge rendezvous + keychain credential resolution.
// (ADR-010 communication § trust-domains v13; § transports v13)
pub mod libreoffice_bridge;
pub mod mcp_host;
pub mod mcp_server;
pub mod pack_sandbox;
pub mod persistence;
pub mod review_gate;
// BYO-CLI driver projection (ADR-001 §4 projector / ADR-002 § projection) —
// materialize the kernel MCP gate into the user's CLI driver native config
// (project-scoped `.mcp.json`) so the driver auto-discovers it on launch.
pub mod periodic_notes;
pub mod projector;
pub mod provider;
pub mod query;
// First canonical Resource vertical: one Markdown file, stable-handle read-only.
// (ADR-002 substrate §15 v83)
pub mod note_resource;
// Explicitly authorized workspaces receive opaque, path-free Project refs.
// (ADR-002 substrate §15 v83; ADR-005 irisy §11 v40)
pub mod project_resource;
// Canonical ResourceRef identity, one-owner registry, descriptors, operation
// lifecycle facts, and stable no-follow filesystem handles.
// (ADR-002 substrate §15 v82)
pub mod resource;
pub mod resource_fs;
// One process-wide per-file write lock so a canonical `produce` and a legacy
// bespoke vault write on the same file cannot interleave.
// (ADR-002 substrate §15 v87)
pub mod vault_write_lock;
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
// ADR-002 substrate § vault v3 §8.4 + memory
// `decision_vault_adr_002_section_8`.
pub mod event_ws;
pub mod smart_table_index;
pub mod sourcing_scheduler;
pub mod subprocess_actor;
pub mod subprocess_channel_adapter;
// Feature-pack provision+auth engine
// (ADR-002 substrate § composition v77; historical implementation plan:
// `vault/ctrl/history/plans/feature-pack-provision-auth-engine.md`) —
// generic runtime that
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
// Feature-pack evals (ADR-002 §7.4/§7.5; mcp-builder review+evals phase) — the
// gate validates a brain-authored candidate manifest BEFORE install and returns
// structured, self-correctable feedback (the quality step home-grown pipelines
// skip). Pure over a parsed manifest, so the gate tool is a thin wrapper.
pub mod pack_validate;
// OpenAPI -> §14 record_source scaffold (ADR-002 §7.4 AutoMCP): generate a
// best-effort record_source draft from an OpenAPI read op + spec-repair notes,
// which the author refines + evals before install. Pure, no I/O.
pub mod openapi;
// Feature-pack publish (ADR-002 §7.6) — the produce side of share-and-be-shared:
// evals a pack then POSTs its manifest to a registry/commons. Kernel-internal
// HTTPS, token kernel-side; the real public registry is the honest external gap.
pub mod pack_publish;
// Tasks as a unified-operation-interface RecordSource
// (ADR-002 substrate § unified-operation-interface v77; historical context:
// `vault/ctrl/history/plans/lifeos-layer-restructure.md`) — tasks as a §14 RecordSource:
// one plain-markdown file per task (vim test), describe/query via the shared
// engine, produce (create/update) through the vault layer.
pub mod tasks_source;
pub mod ui_bridge;
pub mod vault;
pub mod vault_doc;
pub mod vault_git;
pub mod vault_notes_source;
pub mod vault_smart_table;
pub mod visibility;
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

pub use event_ws::{EventWsBridge, DEFAULT_LISTEN_ADDR as EVENT_WS_LISTEN_ADDR};
pub use mcp_server::DEFAULT_LISTEN_ADDR as MCP_SERVER_LISTEN_ADDR;
