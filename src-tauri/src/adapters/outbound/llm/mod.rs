// LLM gateway + provider adapters.
//
// Architecture:
//   step_runner ──> LlmGateway (impl LlmPort) ──> registered adapter (by profile name)
//                                              ├── OpenAiCompatibleAdapter (MiniMax / DeepSeek / 通义 / Kimi / GLM / OpenAI / Ollama)
//                                              └── AnthropicAdapter (Claude native messages API)
//
// User configures one or more "profiles" (provider + base_url + api_key + model).
// Default profile is the one used when an llm step doesn't specify which profile to use.
// v0.1 default: MiniMax via the OpenAI-compatible adapter.

pub mod anthropic;
pub mod gateway;
pub mod openai_compatible;

pub use anthropic::AnthropicAdapter;
pub use gateway::{LlmGateway, ProviderConfig, ProviderKind};
pub use openai_compatible::OpenAiCompatibleAdapter;
