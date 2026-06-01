// ADR-002 substrate § provider v2 §3.2 — verbatim VMark REST adapters.
//
// Layout matches the ADR §3.2 spec: one file per provider, each holding
// the verbatim `run_rest_X` function from VMark `ai_provider/
// rest_providers.rs` (ISC) plus a thin CTRL `Provider` trait wrapper.
// Shared constants + body cap live in `common.rs` so each provider file
// can stay byte-identical with its VMark source. `http_client.rs` and
// `sink.rs` are CTRL-side glue (http_client is VMark verbatim; sink is
// CTRL-specific channel-bridging — VMark's WindowSink path is not
// applicable here).
//
// License: THIRD_PARTY_LICENSES/vmark-ISC.txt

pub mod anthropic;
pub mod common;
pub mod google;
pub mod http_client;
pub mod ollama;
pub mod openai;
pub mod sink;

pub use anthropic::RestAnthropicProvider;
pub use google::RestGoogleProvider;
pub use ollama::RestOllamaProvider;
pub use openai::RestOpenaiProvider;
