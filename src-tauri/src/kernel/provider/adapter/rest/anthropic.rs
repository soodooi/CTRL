// ADR-002 substrate § provider v2 §3.2 — verbatim VMark port (ISC).
// Source: github.com/xiaolai/vmark, src-tauri/src/ai_provider/rest_providers.rs,
// the `run_rest_anthropic` function. License: THIRD_PARTY_LICENSES/vmark-ISC.txt
//
// Modifications: only the surrounding `RestAnthropicProvider` struct +
// `Provider` trait impl are CTRL-side glue. The `run_rest_anthropic`
// function body is byte-identical with the VMark source.

use std::collections::BTreeSet;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::common::{flatten_prompt, read_body_capped, PROMPT_REQUEST_TIMEOUT};
use super::http_client;
use super::sink::{AiSink, CtrlChannelSink};
use crate::kernel::provider::manifest::ProviderManifest;
use crate::kernel::provider::r#trait::{Capability, Provider};
use crate::kernel::provider::types::{ChatChunk, ChatOpts, ChatPrompt, ProviderError};

const ANTHROPIC_DEFAULT_ENDPOINT: &str = "https://api.anthropic.com";

/// POST `/v1/messages` against the Anthropic API and forward the response.
///
/// Body fields:
///   - `model` — caller-resolved (no defaulting here).
///   - `max_tokens` — REQUIRED by the Anthropic API; defaults to 4096 when
///     `max_tokens` arg is `None`. Anthropic is the only provider where
///     `max_tokens` is mandatory; the other three treat it as optional.
///   - `messages` — single user message with `prompt` as content.
///
/// On non-2xx response: drains the body for the error message, calls
/// `sink.error(...)`, returns `Ok(())`. On parse failure: same shape.
/// On success: emits one `sink.chunk(...)` per text block in `content`,
/// then `sink.done()`. Bodies above `MAX_REST_BODY_BYTES` are rejected
/// before parse via `read_body_capped`.
async fn run_rest_anthropic(
    sink: &dyn AiSink,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens.unwrap_or(4096),
        "messages": [{"role": "user", "content": prompt}]
    });

    let resp = client
        .post(format!("{}/v1/messages", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
        sink.error(&format!("Anthropic API error {}: {}", status, text));
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
            sink.error(&format!("Failed to parse Anthropic response: {}", e));
            return Ok(());
        }
    };

    if let Some(content_blocks) = json.get("content").and_then(|c| c.as_array()) {
        for block in content_blocks {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                sink.chunk(text);
            }
        }
    } else {
        sink.error("No content blocks in Anthropic response");
        return Ok(());
    }

    sink.done();
    Ok(())
}

/// CTRL `Provider` trait wrapper around the verbatim `run_rest_anthropic`
/// VMark function. Holds the manifest + resolved api key; each
/// `chat_stream` call spawns a worker future that drives the verbatim
/// function through a `CtrlChannelSink`.
pub struct RestAnthropicProvider {
    manifest: Arc<ProviderManifest>,
    api_key: String,
}

impl RestAnthropicProvider {
    pub fn from_manifest(
        manifest: Arc<ProviderManifest>,
        api_key: String,
    ) -> Result<Self, ProviderError> {
        if api_key.trim().is_empty() {
            return Err(ProviderError::NotConfigured(format!(
                "{}: anthropic api key absent",
                manifest.id
            )));
        }
        Ok(Self { manifest, api_key })
    }

    fn endpoint(&self) -> String {
        self.manifest
            .endpoint
            .clone()
            .unwrap_or_else(|| ANTHROPIC_DEFAULT_ENDPOINT.to_string())
    }

    fn model(&self, opts: &ChatOpts) -> String {
        if !opts.model.is_empty() {
            return opts.model.clone();
        }
        self.manifest
            .models
            .first()
            .cloned()
            .unwrap_or_else(|| "claude-3-5-sonnet-latest".to_string())
    }
}

#[async_trait]
impl Provider for RestAnthropicProvider {
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
        let api_key = self.api_key.clone();
        let model = self.model(opts);
        let prompt_text = flatten_prompt(prompt);
        let max_tokens = prompt.max_tokens.map(u64::from);
        tokio::spawn(async move {
            let sink = CtrlChannelSink::new(tx);
            if let Err(e) = run_rest_anthropic(
                &sink,
                &endpoint,
                &api_key,
                &model,
                &prompt_text,
                max_tokens,
            )
            .await
            {
                sink.error(&format!("Anthropic transport failure: {e}"));
            }
        });
        Ok(rx)
    }

    fn trial_verify(&self) -> Result<(), ProviderError> {
        Ok(())
    }
}
