// Adapter implementations of the `Provider` trait — one file per
// transport family. Adding a new provider almost never means a new file
// here: 9 cloud LLMs all share `http_api.rs`, 2 CLIs share `cli/`.
//
// ADR-002 substrate § provider v2 §3.2 adds `rest/` — the verbatim VMark
// REST ports (ISC). 4 thin wrappers (anthropic / openai / google /
// ollama) coexist with the generic streaming `http_api.rs`; manifests
// pick a kind per provider.

// ADR-002 substrate § capability-faces v19 §13.4 (2026-06-09): `api/`
// holds aggregator endpoints (fal.ai) that route per typed capability
// (image.generate / video.generate / audio.tts) outside the chat-stream
// shape of the Provider trait.
pub mod api;
pub mod cli;
pub mod http_api;
pub mod rest;

pub use cli::one_shot::OneShotCliProvider;
pub use http_api::HttpApiProvider;
pub use rest::{
    RestAnthropicProvider, RestGoogleProvider, RestOllamaProvider, RestOpenaiProvider,
};
