// kernel::provider::ollama_embed — local Ollama embeddings client.
//
// (ADR-002 substrate v5 §10.3, 2026-06-03.)
//
// Single HTTP wrapper around `POST http://127.0.0.1:11434/api/embeddings`.
// No fallback inside this module — `vault_embeddings.rs` decides whether
// to try the cloud path. Failure modes are surfaced as
// `EmbedProviderError::Unreachable` (probe-time) vs `Failed` (per-request).

use serde::{Deserialize, Serialize};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:11434";
const DEFAULT_MODEL: &str = "nomic-embed-text";

#[derive(Debug, thiserror::Error)]
pub enum EmbedProviderError {
    #[error("ollama unreachable: {0}")]
    Unreachable(String),
    #[error("ollama embed failed: {0}")]
    Failed(String),
    #[error("ollama response malformed: {0}")]
    Malformed(String),
}

#[derive(Debug, Clone)]
pub struct OllamaEmbedClient {
    base_url: String,
    pub model: String,
    client: reqwest::Client,
}

#[derive(Debug, Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    prompt: &'a str,
}

#[derive(Debug, Deserialize)]
struct EmbedResponse {
    embedding: Vec<f32>,
}

impl OllamaEmbedClient {
    pub fn new() -> Self {
        Self::with_url_and_model(DEFAULT_BASE_URL.to_string(), DEFAULT_MODEL.to_string())
    }

    pub fn with_url_and_model(base_url: String, model: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .unwrap_or_default();
        Self {
            base_url,
            model,
            client,
        }
    }

    /// Probe: GET /api/tags returns the installed models. We treat HTTP
    /// 200 as "available", any other outcome as "unreachable".
    pub async fn probe(&self) -> Result<(), EmbedProviderError> {
        let url = format!("{}/api/tags", self.base_url);
        let res = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| EmbedProviderError::Unreachable(e.to_string()))?;
        if !res.status().is_success() {
            return Err(EmbedProviderError::Unreachable(format!(
                "tags returned {}",
                res.status()
            )));
        }
        Ok(())
    }

    /// Embed one text. Returns the raw (non-normalised) vector from
    /// Ollama; `vault_embeddings::upsert` normalises before storing.
    pub async fn embed(&self, text: &str) -> Result<Vec<f32>, EmbedProviderError> {
        let url = format!("{}/api/embeddings", self.base_url);
        let body = EmbedRequest {
            model: &self.model,
            prompt: text,
        };
        let res = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| EmbedProviderError::Failed(e.to_string()))?;
        if !res.status().is_success() {
            return Err(EmbedProviderError::Failed(format!(
                "ollama embed HTTP {}",
                res.status()
            )));
        }
        let parsed: EmbedResponse = res
            .json()
            .await
            .map_err(|e| EmbedProviderError::Malformed(e.to_string()))?;
        if parsed.embedding.is_empty() {
            return Err(EmbedProviderError::Malformed("empty embedding".into()));
        }
        Ok(parsed.embedding)
    }
}

impl Default for OllamaEmbedClient {
    fn default() -> Self {
        Self::new()
    }
}
