// Provider sub-system — ADR-002 substrate § provider v1.
//
// Layout (one file per lock item):
//   - trait.rs           Provider trait + Capability enum
//   - types.rs           Wire types (ChatPrompt / ChatMessage / ChatChunk
//                        / ProviderError; legacy LlmXxx aliases kept here
//                        too for the in-flight retirement of llm_port)
//   - manifest.rs        TOML schema + parsers + default paths
//   - registry.rs        ProviderRegistry + active-state persistence +
//                        legacy ~/.ctrl/config.toml bridge
//   - verify.rs          1-token "hi" trial chat
//   - http_endpoint.rs   POST /text-chat for Pi bridge
//   - adapter/
//       cli/one_shot.rs           codex / gemini generic spawner
//       cli/claude_persistent.rs  goose-style persistent claude CLI
//       http_api.rs               openai-shape + anthropic-shape
//   - builtin/*.toml     6 presets shipped in the bundle
//
// Retires the pre-amendment scatter of `brain_config.rs` (kept by the
// brain lane PR, not this one), `llm_port.rs`, `llm_adapters/*`.

pub mod adapter;
pub mod http_endpoint;
pub mod legacy_config;
pub mod manifest;
pub mod registry;
#[path = "trait.rs"]
pub mod r#trait;
pub mod types;
pub mod verify;

pub use r#trait::{Capability, Provider};
pub use registry::{ProviderHandle, ProviderListEntry, ProviderRegistry};
pub use types::{
    ChatChunk, ChatMessage, ChatOpts, ChatPrompt, LlmChunk, LlmError, LlmMessage, LlmPrompt,
    ProviderError,
};
