// Provider sub-system — ADR-002 substrate § provider v2.
//
// Layout (one file per lock item):
//   - trait.rs           Provider trait + Capability enum + (v2) Consumer
//                        enum + RouteChain for role-aware routing
//   - types.rs           Wire types (ChatPrompt / ChatMessage / ChatChunk
//                        / ProviderError; legacy LlmXxx aliases kept here
//                        too for the in-flight retirement of llm_port)
//   - manifest.rs        TOML schema + parsers + default paths
//   - registry.rs        ProviderRegistry + role-keyed active-state
//                        persistence (v2 schema with migration) +
//                        legacy ~/.ctrl/config.toml bridge
//   - verify.rs          1-token "hi" trial chat
//   - adapter/
//       cli/one_shot.rs           codex / gemini generic spawner
//       http_api.rs               openai-shape + anthropic-shape
//   - builtin/*.toml     only `ollama` ships builtin (bao 2026-06-05);
//                        users add BYOK providers via Settings.
//
// cli/claude_persistent.rs removed (ADR-002 substrate § provider v61,
// 2026-07-11): Claude subscription OAuth may not back an LLM provider
// per Anthropic's usage policy — Anthropic is BYOK API key only
// (ADR-006 cross-cutting § byok-no-claude).
//
// v2 amendment (2026-05-31): role-aware routing replaces capability-
// keyed active map. 2 roles only: irisy.primary (user CLI, 0 CTRL cost)
// + irisy.fallback (CTRL-managed paid `volc`). mcp.default dropped.
// Volc has two manifest ids: `volc` (CTRL fallback) + `volc-byok` (user).
//
// Retires the pre-amendment scatter of `brain_config.rs` (kept by the
// brain lane PR, not this one), `llm_port.rs`, `llm_adapters/*`.

pub mod adapter;
pub mod detect;
pub mod legacy_config;
pub mod manifest;
pub mod path_resolver;
pub mod registry;
// Shared text.chat candidate walking (ADR-002 § provider v9 §3.5) —
// one SSOT consumed by commands/irisy_chat + kernel/mcp_server.
pub mod routing;
#[path = "trait.rs"]
pub mod r#trait;
pub mod types;
pub mod verify;
// Local Ollama embeddings client (ADR-002 v5 §10.3) — separate from the
// chat provider trait so embeddings can stay local even when chat goes
// to a cloud provider.
pub mod ollama_embed;

// Re-export the chat Provider trait + chunk/error/prompt types so kernel
// callers can drive a provider directly and unit-test the drain with a fake —
// used by `ai_column::complete_row` (ADR-003 frontend § viewer v15 §6.5.4 AI
// field shortcut). (ADR-002 substrate § provider v2 §3.2 — adapter trait.)
// ADR-002 substrate § provider v2 (2026-06-21, full-review): drop the
// Capability re-export — unused after removing the retired-Pi http_endpoint.
pub use r#trait::{Consumer, Provider};
pub use registry::{
    ProviderListEntry, ProviderRegistry, RecordedFailover,
};
// ADR-002 substrate § provider v2 (2026-06-21, full-review): ChatChunk /
// ChatPrompt re-exports dropped — consumers import provider::types::* directly.
pub use types::{ChatOpts, LlmMessage, LlmPrompt, ProviderError};
