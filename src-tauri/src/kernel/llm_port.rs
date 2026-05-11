// LLM Port — kernel-level adapter routing for LLM calls.
//
// Multiple adapters registered; fallback chain on timeout/error/quota.
// Default order: CF Workers AI → Anthropic (BYOK) → local Ollama.
//
// P2.1 skeleton — concrete adapters in P2.4.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmPrompt {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    pub messages: Vec<LlmMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String, // "user" | "assistant" | "system" | "tool"
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmChunk {
    pub delta: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

#[async_trait]
pub trait LlmAdapter: Send + Sync {
    fn name(&self) -> &str;
    fn supports(&self, model: &str) -> bool;

    /// Run a chat completion with deadline. Returns full response.
    /// Streaming variant lives in P2.4 (channel-based delivery).
    async fn complete(&self, model: &str, prompt: &LlmPrompt, deadline_ms: u64) -> Result<String, LlmError>;
}

pub struct LlmPortRouter {
    adapters: Vec<Arc<dyn LlmAdapter>>,
    fallback_order: Vec<String>,
}

impl LlmPortRouter {
    pub fn new(fallback_order: Vec<String>) -> Self {
        Self {
            adapters: Vec::new(),
            fallback_order,
        }
    }

    pub fn register(&mut self, adapter: Arc<dyn LlmAdapter>) {
        self.adapters.push(adapter);
    }

    pub fn adapter_for(&self, name: &str) -> Option<&Arc<dyn LlmAdapter>> {
        self.adapters.iter().find(|a| a.name() == name)
    }

    pub fn fallback_chain(&self) -> &[String] {
        &self.fallback_order
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum LlmError {
    #[error("model not supported by any adapter: {0}")]
    ModelUnsupported(String),
    #[error("deadline exceeded after {0}ms")]
    DeadlineExceeded(u64),
    #[error("provider error: {0}")]
    ProviderError(String),
    #[error("quota exhausted")]
    QuotaExhausted,
    #[error("authentication failed")]
    AuthFailed,
}
