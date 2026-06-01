// ADR-002 substrate § provider v2 §3.2 — verbatim VMark port (ISC).
// Source: github.com/xiaolai/vmark, src-tauri/src/ai_provider/rest_providers.rs,
// the `run_rest_google` function. License: THIRD_PARTY_LICENSES/vmark-ISC.txt
//
// Modifications: only the surrounding `RestGoogleProvider` struct + the
// `Provider` trait impl are CTRL-side glue. The `run_rest_google`
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

/// POST `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
/// against the Google AI Gemini API and forward the response.
///
/// Asymmetry vs. the other REST providers: there is no `endpoint`
/// parameter — the URL is hard-coded to the public Google API host. Custom
/// endpoints (e.g. Vertex AI proxies) are out of scope; users with that
/// requirement should fall back to a CLI provider.
///
/// Body fields:
///   - `contents` — single-turn user message wrapping `prompt`.
///   - `generationConfig.maxOutputTokens` — Google's name for `max_tokens`.
///     Only inserted when the arg is `Some`.
///
/// Model strings prefixed with `models/` are stripped; the URL's `:generateContent`
/// suffix expects a bare model id. Sink contract identical to the others.
async fn run_rest_google(
    sink: &dyn AiSink,
    api_key: &str,
    model: &str,
    prompt: &str,
    max_tokens: Option<u64>,
) -> Result<(), String> {
    let client = http_client::shared()?;
    let mut body = serde_json::json!({
        "contents": [{"parts": [{"text": prompt}]}]
    });
    if let Some(n) = max_tokens {
        body["generationConfig"] = serde_json::json!({
            "maxOutputTokens": n,
        });
    }

    let model_id = model.strip_prefix("models/").unwrap_or(model);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
        model_id
    );

    let resp = client
        .post(&url)
        .timeout(PROMPT_REQUEST_TIMEOUT)
        .header("x-goog-api-key", api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Google AI request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|e| format!("<failed to read body: {}>", e));
        sink.error(&format!("Google AI error {}: {}", status, text));
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
            sink.error(&format!("Failed to parse Google AI response: {}", e));
            return Ok(());
        }
    };

    if let Some(text) = json
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|candidates| candidates.first())
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .and_then(|parts| parts.first())
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
    {
        sink.chunk(text);
    } else {
        sink.error("No candidates in Google AI response");
        return Ok(());
    }

    sink.done();
    Ok(())
}

pub struct RestGoogleProvider {
    manifest: Arc<ProviderManifest>,
    api_key: String,
}

impl RestGoogleProvider {
    pub fn from_manifest(
        manifest: Arc<ProviderManifest>,
        api_key: String,
    ) -> Result<Self, ProviderError> {
        if api_key.trim().is_empty() {
            return Err(ProviderError::NotConfigured(format!(
                "{}: google ai api key absent",
                manifest.id
            )));
        }
        Ok(Self { manifest, api_key })
    }

    fn model(&self, opts: &ChatOpts) -> String {
        if !opts.model.is_empty() {
            return opts.model.clone();
        }
        self.manifest
            .models
            .first()
            .cloned()
            .unwrap_or_else(|| "gemini-1.5-flash".to_string())
    }
}

#[async_trait]
impl Provider for RestGoogleProvider {
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
        let api_key = self.api_key.clone();
        let model = self.model(opts);
        let prompt_text = flatten_prompt(prompt);
        let max_tokens = prompt.max_tokens.map(u64::from);
        tokio::spawn(async move {
            let sink = CtrlChannelSink::new(tx);
            if let Err(e) = run_rest_google(
                &sink,
                &api_key,
                &model,
                &prompt_text,
                max_tokens,
            )
            .await
            {
                sink.error(&format!("Google AI transport failure: {e}"));
            }
        });
        Ok(rx)
    }

    fn trial_verify(&self) -> Result<(), ProviderError> {
        Ok(())
    }
}
