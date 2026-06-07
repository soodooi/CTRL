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
//   - http_endpoint.rs   POST /text-chat for Pi bridge
//   - adapter/
//       cli/one_shot.rs           codex / gemini generic spawner
//       cli/claude_persistent.rs  goose-style persistent claude CLI
//       http_api.rs               openai-shape + anthropic-shape
//   - builtin/*.toml     7 presets shipped (v2: added volc-byok)
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
pub mod http_endpoint;
pub mod legacy_config;
pub mod manifest;
pub mod path_resolver;
pub mod registry;
#[path = "trait.rs"]
pub mod r#trait;
pub mod types;
pub mod verify;
// Local Ollama embeddings client (ADR-002 v5 §10.3) — separate from the
// chat provider trait so embeddings can stay local even when chat goes
// to a cloud provider.
pub mod ollama_embed;

pub use r#trait::{Capability, Consumer, Provider, RouteChain};
pub use registry::{
    ProviderHandle, ProviderListEntry, ProviderRegistry, RecordedFailover, RoutingOverride,
};
pub use detect::CliProviderEntry;
pub use types::{
    ChatChunk, ChatMessage, ChatOpts, ChatPrompt, LlmChunk, LlmError, LlmMessage, LlmPrompt,
    ProviderError,
};
