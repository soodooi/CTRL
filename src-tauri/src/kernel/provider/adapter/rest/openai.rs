// ADR-002 substrate § provider v2 §3.2 — verbatim VMark port (ISC).
// Source: github.com/xiaolai/vmark, src-tauri/src/ai_provider/rest_providers.rs,
// the `run_rest_openai` function. License: THIRD_PARTY_LICENSES/vmark-ISC.txt
//
// Modifications: only the surrounding `RestOpenaiProvider` struct + the
// `Provider` trait impl are CTRL-side glue. The `run_rest_openai`
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

const OPENAI_DEFAULT_ENDPOINT: &str = "https://api.openai.com";

/// POST `/v1/chat/completions` against the OpenAI API and forward the response.
///
/// Body fields:
///   - `model` — caller-resolved.
///   - `messages` — single user message with `prompt` as content.
///   - `max_tokens` — OPTIONAL. Only inserted when the arg is `Some`. (Newer
///     OpenAI models prefer `max_completion_tokens`; for compatibility with
///     OpenAI-API-compatible endpoints we use the legacy field name.)
///
/// Sink contract identical to `run_rest_anthropic`: error event on non-2xx /
/// parse failure / missing choices, otherwise one chunk + `done()`.
async fn run_rest_openai(
    sink: &dyn AiSink,
    endpoint: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let mut body = serde_json::json!({
        "model": model,
        "messages": [{"role": "user", "content": prompt}]
    });
    if let Some(n) = max_tokens {
        body["max_tokens"] = serde_json::json!(n);
    }

    let resp = client
        .post(format!("{}/v1/chat/completions", endpoint))
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
        sink.error(&format!("OpenAI API error {}: {}", status, text));
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
            sink.error(&format!("Failed to parse OpenAI response: {}", e));
            return Ok(());
        }
    };

    if let Some(text) = json
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|choices| choices.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
    {
        sink.chunk(text);
    } else {
        sink.error("No choices in OpenAI response");
        return Ok(());
    }

    sink.done();
    Ok(())
}

pub struct RestOpenaiProvider {
    manifest: Arc<ProviderManifest>,
    api_key: String,
}

impl RestOpenaiProvider {
    pub fn from_manifest(
        manifest: Arc<ProviderManifest>,
        api_key: String,
    ) -> Result<Self, ProviderError> {
        if api_key.trim().is_empty() {
            return Err(ProviderError::NotConfigured(format!(
                "{}: openai api key absent",
                manifest.id
            )));
        }
        Ok(Self { manifest, api_key })
    }

    fn endpoint(&self) -> String {
        self.manifest
            .endpoint
            .clone()
            .unwrap_or_else(|| OPENAI_DEFAULT_ENDPOINT.to_string())
    }

    fn model(&self, opts: &ChatOpts) -> String {
        if !opts.model.is_empty() {
            return opts.model.clone();
        }
        self.manifest
            .models
            .first()
            .cloned()
            .unwrap_or_else(|| "gpt-4o-mini".to_string())
    }
}

#[async_trait]
impl Provider for RestOpenaiProvider {
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
            if let Err(e) = run_rest_openai(
                &sink,
                &endpoint,
                &api_key,
                &model,
                &prompt_text,
                max_tokens,
            )
            .await
            {
                sink.error(&format!("OpenAI transport failure: {e}"));
            }
        });
        Ok(rx)
    }

    fn trial_verify(&self) -> Result<(), ProviderError> {
        Ok(())
    }
}
