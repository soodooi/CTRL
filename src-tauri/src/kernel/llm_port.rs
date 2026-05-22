// LLM Port — kernel-level adapter routing for LLM calls.
//
// Multiple adapters registered; fallback chain on timeout/error/quota.
// Default order: CF Workers AI → Anthropic (BYOK) → local Ollama.
//
// P2.1 skeleton — concrete adapters in P2.4.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

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
    async fn complete(&self, model: &str, prompt: &LlmPrompt, deadline_ms: u64) -> Result<String, LlmError>;

    /// Stream a chat completion as delta chunks. Default implementation
    /// collects the non-streaming `complete()` result and yields it as a
    /// single chunk — adapters that natively support SSE / WebSocket
    /// streams override this for true incremental delivery.
    async fn stream_chat(
        &self,
        model: &str,
        prompt: &LlmPrompt,
        deadline_ms: u64,
    ) -> Result<mpsc::Receiver<Result<LlmChunk, LlmError>>, LlmError> {
        let full = self.complete(model, prompt, deadline_ms).await?;
        let (tx, rx) = mpsc::channel(2);
        // Synthetic 2-chunk emit: the content + a sentinel finish_reason
        // so consumers' "stop on finish_reason" logic still fires.
        let _ = tx
            .send(Ok(LlmChunk {
                delta: full,
                finish_reason: None,
            }))
            .await;
        let _ = tx
            .send(Ok(LlmChunk {
                delta: String::new(),
                finish_reason: Some("stop".into()),
            }))
            .await;
        Ok(rx)
    }
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

    /// Pick the first registered adapter in the fallback chain. Used by
    /// callers that just want "the default LLM" without naming a provider
    /// — Volc on a fresh install, falls back to whatever the user later
    /// adds via BYOK.
    pub fn primary_adapter(&self) -> Option<&Arc<dyn LlmAdapter>> {
        for preferred in &self.fallback_order {
            if let Some(a) = self.adapter_for(preferred) {
                return Some(a);
            }
        }
        // No adapter from the configured chain — try whatever's registered
        // so a manually-registered "openai" adapter still works when chain
        // is set to the default ["volc", "anthropic", "ollama"].
        self.adapters.first()
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
