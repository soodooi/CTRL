// Provider wire types — folded from the retired `kernel::llm_port` module.
//
// One canonical place for `ChatPrompt` / `ChatMessage` / `ChatChunk` /
// `ProviderError`. Consumers (Tauri commands, MCP server tools, draft
// runner) import from `kernel::provider` instead of the deleted
// `kernel::llm_port`.
//
// Type aliases (`LlmPrompt`, `LlmMessage`, `LlmChunk`, `LlmError`) are
// retained at the module root via re-export so the in-flight retirement
// PR doesn't have to rewrite every call site in one shot — they all
// point at the new structs.

use serde::{Deserialize, Serialize};

/// One chat-completion request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatPrompt {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    pub messages: Vec<ChatMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

/// One message in a chat-completion request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// "user" | "assistant" | "system" | "tool"
    pub role: String,
    pub content: String,
}

/// One chunk emitted on the streaming side. `delta` is the incremental
/// token text; `finish_reason` is non-None on the final chunk only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChunk {
    pub delta: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

/// Per-call options. Today only `model` + `deadline_ms`; extended as
/// adapters grow shared options. Kept distinct from `ChatPrompt` so the
/// prompt body stays serializable / cacheable without the runtime knobs.
#[derive(Debug, Clone, Default)]
pub struct ChatOpts {
    /// Override the provider's default model. Empty string = use default.
    pub model: String,
    /// Wall-clock deadline. `0` = adapter default (typically 30-120s).
    pub deadline_ms: u64,
}

/// Typed provider failure. Keeps the same buckets the old `LlmError` had
/// so downstream `match` arms keep working; adds `NotConfigured` for the
/// trial-verify path (entry exists but lacks credentials).
#[derive(Debug, Clone, thiserror::Error)]
pub enum ProviderError {
    #[error("model not supported by provider: {0}")]
    ModelUnsupported(String),
    #[error("deadline exceeded after {0}ms")]
    DeadlineExceeded(u64),
    #[error("provider error: {0}")]
    ProviderError(String),
    #[error("quota exhausted")]
    QuotaExhausted,
    #[error("authentication failed")]
    AuthFailed,
    #[error("provider not configured: {0}")]
    NotConfigured(String),
    #[error("provider not found: {0}")]
    ProviderNotFound(String),
}

// ── Type aliases for the in-flight retirement of `llm_port` ──────────────
// Once every call site imports the new names directly these can be dropped;
// the retirement PR keeps them so adopters do one rename, not two.

pub type LlmPrompt = ChatPrompt;
pub type LlmMessage = ChatMessage;
pub type LlmChunk = ChatChunk;
pub type LlmError = ProviderError;
