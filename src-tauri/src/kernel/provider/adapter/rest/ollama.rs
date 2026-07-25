// ADR-002 substrate § provider v2 §3.2 — verbatim VMark port (ISC).
// Source: github.com/xiaolai/vmark, src-tauri/src/ai_provider/rest_providers.rs,
// the `run_rest_ollama` function. License: THIRD_PARTY_LICENSES/vmark-ISC.txt
//
// Modifications: only the surrounding `RestOllamaProvider` struct + the
// `Provider` trait impl are CTRL-side glue. The `run_rest_ollama`
// function body is byte-identical with the VMark source.

use std::collections::BTreeSet;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::common::{flatten_prompt, read_body_capped, PROMPT_REQUEST_TIMEOUT};
use super::http_client;
use super::sink::{AiSink, CtrlChannelSink};
use crate::kernel::provider::manifest::ProviderManifest;
use crate::kernel::provider::r#trait::{
    Capability, Provider, ProviderRuntimeAvailability, ProviderRuntimeStatus,
};
// Ollama availability is a probed system fact, never a builtin assumption.
// (ADR-002 substrate § provider v70)
use crate::kernel::provider::types::{ChatChunk, ChatOpts, ChatPrompt, ProviderError};

const OLLAMA_DEFAULT_ENDPOINT: &str = "http://localhost:11434";

/// POST `/api/generate` against an Ollama-compatible endpoint (default
/// `http://localhost:11434`) and forward the response.
///
/// Asymmetry vs. the other REST providers: there is no `api_key` — Ollama
/// runs locally by convention.
///
/// Body fields:
///   - `model` — caller-resolved.
///   - `prompt` — raw text (Ollama uses a flat `prompt` field rather than
///     a chat `messages` array).
///   - `stream: false` — VMark always pulls the whole response and
///     forwards it as a single chunk; live token streaming is not wired
///     through the sink layer for any provider.
///   - `options.num_predict` — Ollama's name for `max_tokens`. Only
///     inserted when the arg is `Some`.
///
/// Sink contract identical to the other REST providers.
async fn run_rest_ollama(
    sink: &dyn AiSink,
    endpoint: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    // ADR-002 substrate §10 long-context hint (orig ADR-009, retired) (bao 2026-06-04 question on max
    // conversation length) — Ollama defaults `num_ctx` to 2048
    // regardless of what the model manifest claims it supports.
    // qwen2.5:7b would forget after ~6 turns at that ceiling. Always
    // request 32k (qwen2.5:7b native context per manifest); models
    // that don't support 32k clamp to their own max with a warning.
    let mut options = serde_json::json!({ "num_ctx": 32_768 });
    if let Some(n) = max_tokens {
        options["num_predict"] = serde_json::json!(n);
    }
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": options,
    });

    let resp = client
        .post(format!("{}/api/generate", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
        sink.error(&format!("Ollama API error {}: {}", status, text));
        return Ok(());
    }

    let bytes = match read_body_capped(resp).await {
        Ok(b) => b,
        Err(e) => {
            sink.error(&e);
            return Ok(());
        }
    };
    let json: serde_json::Value = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            sink.error(&format!("Failed to parse Ollama response: {}", e));
            return Ok(());
        }
    };

    if let Some(text) = json.get("response").and_then(|r| r.as_str()) {
        sink.chunk(text);
    } else {
        sink.error("No response field in Ollama response");
        return Ok(());
    }

    sink.done();
    Ok(())
}

/// Match the exact configured model tag; catalogue presence cannot prove that
/// a local model is installed. (ADR-002 substrate § provider v70)
fn payload_has_model(payload: &serde_json::Value, selected_model: &str) -> bool {
    payload
        .get("models")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|models| {
            models.iter().any(|entry| {
                entry.get("name").and_then(serde_json::Value::as_str) == Some(selected_model)
                    || entry.get("model").and_then(serde_json::Value::as_str)
                        == Some(selected_model)
            })
        })
}

pub struct RestOllamaProvider {
    manifest: Arc<ProviderManifest>,
}

impl RestOllamaProvider {
    /// Ollama has no api key; the constructor takes the manifest only
    /// so the registry's instantiate path stays uniform with the other
    /// REST adapters.
    pub fn from_manifest(manifest: Arc<ProviderManifest>) -> Result<Self, ProviderError> {
        Ok(Self { manifest })
    }

    fn endpoint(&self) -> String {
        self.manifest
            .endpoint
            .clone()
            .unwrap_or_else(|| OLLAMA_DEFAULT_ENDPOINT.to_string())
    }

    fn model(&self, opts: &ChatOpts) -> String {
        if !opts.model.is_empty() {
            return opts.model.clone();
        }
        self.manifest
            .models
            .first()
            .cloned()
            .unwrap_or_else(|| "llama3.2".to_string())
    }
}

#[async_trait]
impl Provider for RestOllamaProvider {
    fn id(&self) -> &str {
        &self.manifest.id
    }

    fn capabilities(&self) -> BTreeSet<Capability> {
        let mut set = BTreeSet::new();
        set.insert(Capability::TextChat);
        set
    }

    async fn chat_stream(
        &self,
        prompt: &ChatPrompt,
        opts: &ChatOpts,
    ) -> Result<mpsc::Receiver<Result<ChatChunk, ProviderError>>, ProviderError> {
        let (tx, rx) = mpsc::channel::<Result<ChatChunk, ProviderError>>(16);
        let endpoint = self.endpoint();
        let model = self.model(opts);
        let prompt_text = flatten_prompt(prompt);
        let max_tokens = prompt.max_tokens.map(u64::from);
        tokio::spawn(async move {
            let sink = CtrlChannelSink::new(tx);
            if let Err(e) = run_rest_ollama(
                &sink,
                &endpoint,
                &model,
                &prompt_text,
                max_tokens,
            )
            .await
            {
                sink.error(&format!("Ollama transport failure: {e}"));
            }
        });
        Ok(rx)
    }

    /// Probe the actual local daemon and selected model with a bounded request;
    /// adapter construction alone is not runtime availability.
    /// (ADR-002 substrate § provider v70)
    async fn runtime_availability(&self) -> ProviderRuntimeAvailability {
        let client = match http_client::shared() {
            Ok(client) => client,
            Err(error) => {
                return ProviderRuntimeAvailability {
                    status: ProviderRuntimeStatus::Unavailable,
                    detail: Some(format!("HTTP client unavailable: {error}")),
                };
            }
        };
        let response = match client
            .get(format!("{}/api/tags", self.endpoint().trim_end_matches('/')))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => {
                return ProviderRuntimeAvailability {
                    status: ProviderRuntimeStatus::Unavailable,
                    detail: Some("Ollama daemon is not reachable".into()),
                };
            }
        };
        if !response.status().is_success() {
            return ProviderRuntimeAvailability {
                status: ProviderRuntimeStatus::Unavailable,
                detail: Some(format!("Ollama daemon returned HTTP {}", response.status())),
            };
        }
        let payload: serde_json::Value = match response.json().await {
            Ok(payload) => payload,
            Err(_) => {
                return ProviderRuntimeAvailability {
                    status: ProviderRuntimeStatus::Unavailable,
                    detail: Some("Ollama model list is invalid".into()),
                };
            }
        };
        let selected_model = self.model(&ChatOpts::default());
        let has_model = payload_has_model(&payload, &selected_model);
        if !has_model {
            return ProviderRuntimeAvailability {
                status: ProviderRuntimeStatus::Unavailable,
                detail: Some(format!("Ollama model {selected_model} is not installed")),
            };
        }
        ProviderRuntimeAvailability {
            status: ProviderRuntimeStatus::Available,
            detail: Some(format!("Ollama model {selected_model} is available")),
        }
    }

    fn trial_verify(&self) -> Result<(), ProviderError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::payload_has_model;

    #[test]
    fn runtime_model_probe_requires_exact_selected_tag() {
        // Exact selected-model presence governs local availability.
        // (ADR-002 substrate § provider v70)
        let payload = serde_json::json!({
            "models": [
                { "name": "hermes3:8b" },
                { "model": "llama3.2:latest" }
            ]
        });
        assert!(payload_has_model(&payload, "hermes3:8b"));
        assert!(payload_has_model(&payload, "llama3.2:latest"));
        assert!(!payload_has_model(&payload, "llama3.2"));
        assert!(!payload_has_model(&payload, "qwen2.5:7b"));
    }
}
