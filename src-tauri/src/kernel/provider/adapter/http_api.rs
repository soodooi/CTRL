// HTTP-API adapter — covers both OpenAI-shape and Anthropic-shape
// endpoints, selected per manifest via `shape` field.
//
// ADR-002 substrate § provider v2 lock #5 — one ~400 LOC file replaces the pre-PR
// openai_shape.rs + anthropic_http.rs split (which were 396 + 442 LOC
// respectively). The shape-specific wire format lives in private
// helpers; the public `HttpApiProvider` struct is shape-agnostic.
//
// All HTTP work goes through one `reqwest::Client` per provider so we
// keep connection pooling across back-to-back mcp turns.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::kernel::provider::manifest::{HttpShape, ProviderManifest};
use crate::kernel::provider::r#trait::{Capability, Provider};
use crate::kernel::provider::types::{ChatChunk, ChatOpts, ChatPrompt, ProviderError};

/// Default per-request deadline. Anthropic extended-thinking models can
/// run long; 60 s gives the user a clean timeout error before reqwest's
/// stalled-SSE OS hang kicks in.
const DEFAULT_DEADLINE_MS: u64 = 60_000;

/// Channel capacity for the chunk forwarder. Large enough that a bursty
/// model (Doubao at peak) doesn't block the SSE reader; small enough to
/// back-pressure a slow consumer.
const STREAM_BUFFER: usize = 64;

/// Default `max_tokens` for Anthropic requests when caller omits it
/// (Anthropic requires the field non-optional). Sized for typical chat
/// turns without burning quota on runaway generation.
const ANTHROPIC_DEFAULT_MAX_TOKENS: u32 = 4096;

const ANTHROPIC_VERSION_HEADER: &str = "2023-06-01";
const ANTHROPIC_FAST_SUFFIX: &str = "-fast";
const ANTHROPIC_FAST_BETA_HEADER: &str = "fast-mode-2026-02-01";

pub struct HttpApiProvider {
    id: String,
    shape: HttpShape,
    endpoint: String,
    api_key: String,
    default_model: String,
    extra_headers: BTreeMap<String, String>,
    capabilities: std::collections::BTreeSet<Capability>,
    client: reqwest::Client,
}

impl HttpApiProvider {
    /// Build from a manifest + already-resolved auth secret. `manifest`
    /// must have `kind = HttpApi`; the registry guarantees this before
    /// instantiation.
    pub fn from_manifest(
        manifest: Arc<ProviderManifest>,
        api_key: String,
    ) -> Result<Self, ProviderError> {
        let endpoint = manifest
            .endpoint
            .clone()
            .ok_or_else(|| {
                ProviderError::ProviderError(format!(
                    "manifest {} (http_api) missing `endpoint`",
                    manifest.id
                ))
            })?
            .trim_end_matches('/')
            .to_string();
        let default_model = manifest
            .models
            .first()
            .cloned()
            .unwrap_or_default();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(DEFAULT_DEADLINE_MS))
            .pool_idle_timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| ProviderError::ProviderError(format!("reqwest build: {e}")))?;
        let capabilities = manifest.capabilities.iter().cloned().collect();
        Ok(Self {
            id: manifest.id.clone(),
            shape: manifest.shape.clone(),
            endpoint,
            api_key,
            default_model,
            extra_headers: manifest.headers.clone(),
            capabilities,
            client,
        })
    }

    fn resolve_model<'a>(&'a self, override_model: &'a str) -> &'a str {
        if override_model.is_empty() {
            &self.default_model
        } else {
            override_model
        }
    }

    async fn stream_openai(
        &self,
        model: &str,
        prompt: &ChatPrompt,
    ) -> Result<mpsc::Receiver<Result<ChatChunk, ProviderError>>, ProviderError> {
        let url = format!("{}/chat/completions", self.endpoint);
        let body = build_openai_body(model, prompt);
        let mut req = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
            .json(&body);
        for (k, v) in &self.extra_headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = req.send().await.map_err(classify_reqwest_err)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(classify_http_err(status, &body_text));
        }
        Ok(spawn_sse_reader(resp, parse_openai_sse))
    }

    async fn stream_anthropic(
        &self,
        model: &str,
        prompt: &ChatPrompt,
    ) -> Result<mpsc::Receiver<Result<ChatChunk, ProviderError>>, ProviderError> {
        let (model_id, fast_mode) = split_fast_mode(model);
        let url = format!("{}/v1/messages", self.endpoint);
        let body = build_anthropic_body(model_id, prompt, fast_mode);
        let mut req = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION_HEADER)
            .header("content-type", "application/json");
        if fast_mode {
            req = req.header("anthropic-beta", ANTHROPIC_FAST_BETA_HEADER);
        }
        for (k, v) in &self.extra_headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let resp = req.json(&body).send().await.map_err(classify_reqwest_err)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(classify_http_err(status, &body_text));
        }
        Ok(spawn_sse_reader(resp, parse_anthropic_sse))
    }
}

#[async_trait]
impl Provider for HttpApiProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn capabilities(&self) -> std::collections::BTreeSet<Capability> {
        self.capabilities.clone()
    }

    async fn chat_stream(
        &self,
        prompt: &ChatPrompt,
        opts: &ChatOpts,
    ) -> Result<mpsc::Receiver<Result<ChatChunk, ProviderError>>, ProviderError> {
        let model = self.resolve_model(&opts.model).to_string();
        match self.shape {
            HttpShape::OpenaiChatCompletions => self.stream_openai(&model, prompt).await,
            HttpShape::AnthropicMessages => self.stream_anthropic(&model, prompt).await,
        }
    }

    fn trial_verify(&self) -> Result<(), ProviderError> {
        if self.endpoint.is_empty() {
            return Err(ProviderError::NotConfigured(format!(
                "{}: endpoint not set",
                self.id
            )));
        }
        // ollama-localhost manifests intentionally ship empty `api_key`;
        // skip the empty-key error when the endpoint targets loopback.
        if self.api_key.is_empty() && !endpoint_is_loopback(&self.endpoint) {
            return Err(ProviderError::NotConfigured(format!(
                "{}: api_key not configured (check keychain / env)",
                self.id
            )));
        }
        Ok(())
    }
}

fn endpoint_is_loopback(endpoint: &str) -> bool {
    endpoint.contains("127.0.0.1") || endpoint.contains("localhost")
}

// ── SSE plumbing (shape-agnostic) ───────────────────────────────────────

/// Spawn the SSE-reader worker. `parse` extracts one ChatChunk from one
/// `data: ...` payload (shape-specific). The worker drops `tx` to close
/// the channel on `[DONE]` / graceful EOF / consumer drop.
fn spawn_sse_reader(
    response: reqwest::Response,
    parse: fn(&str) -> ParseOutcome,
) -> mpsc::Receiver<Result<ChatChunk, ProviderError>> {
    let (tx, rx) = mpsc::channel(STREAM_BUFFER);
    let mut byte_stream = response.bytes_stream();
    tokio::spawn(async move {
        // Accumulate RAW bytes, not lossy-decoded strings. reqwest splits the body at
        // arbitrary transport boundaries, so a multi-byte UTF-8 char (CJK /
        // emoji — CTRL's primary users are Chinese) can straddle two chunks.
        // Decoding each chunk in isolation replaces its split halves with
        // U+FFFD. We only decode a segment once it is a complete SSE event —
        // its boundary is a blank line whose bytes (CR/LF) never appear inside
        // a UTF-8 multi-byte sequence, so the segment can never end mid-char.
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk_result) = byte_stream.next().await {
            let bytes = match chunk_result {
                Ok(b) => b,
                Err(e) => {
                    let _ = tx
                        .send(Err(ProviderError::ProviderError(format!(
                            "stream read: {e}"
                        ))))
                        .await;
                    return;
                }
            };
            buf.extend_from_slice(&bytes);
            while let Some((content_end, next_start)) = find_sse_event_boundary(&buf) {
                let event = String::from_utf8_lossy(&buf[..content_end]).into_owned();
                buf.drain(..next_start);
                let mut data_payload: Option<String> = None;
                for line in event.lines() {
                    let line = line.trim_start();
                    if let Some(payload) = line.strip_prefix("data:") {
                        data_payload = Some(payload.trim().to_string());
                    }
                }
                let Some(payload) = data_payload else { continue };
                match parse(&payload) {
                    ParseOutcome::Chunk(c) => {
                        if tx.send(Ok(c)).await.is_err() {
                            return;
                        }
                    }
                    ParseOutcome::Done => return,
                    ParseOutcome::Skip => continue,
                }
            }
        }
    });
    rx
}

enum ParseOutcome {
    Chunk(ChatChunk),
    Done,
    Skip,
}

/// Locate the earliest SSE event terminator (a blank line) in the raw byte
/// buffer. The SSE spec
/// allows either LF (`\n\n`) or CRLF (`\r\n\r\n`) blank lines, and several
/// "OpenAI-compatible" third-party endpoints CTRL supports emit CRLF — keying
/// only on `\n\n` left those events undispatched (empty reply, no error).
/// Returns `(content_end, next_start)`: the event body is `buf[..content_end]`
/// and the next event begins at `buf[next_start..]`.
fn find_sse_event_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    let lf = find_subslice(buf, b"\n\n");
    let crlf = find_subslice(buf, b"\r\n\r\n");
    match (lf, crlf) {
        (Some(i), Some(j)) => {
            if i <= j {
                Some((i, i + 2))
            } else {
                Some((j, j + 4))
            }
        }
        (Some(i), None) => Some((i, i + 2)),
        (None, Some(j)) => Some((j, j + 4)),
        (None, None) => None,
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

// ── OpenAI-shape wire ──────────────────────────────────────────────────

#[derive(Serialize)]
struct OpenAIChatRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAIMessage<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Serialize)]
struct OpenAIMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct OpenAIStreamChunk {
    choices: Vec<OpenAIStreamChoice>,
}

#[derive(Deserialize)]
struct OpenAIStreamChoice {
    #[serde(default)]
    delta: OpenAIDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Deserialize, Default)]
struct OpenAIDelta {
    #[serde(default)]
    content: Option<String>,
}

fn build_openai_body<'a>(model: &'a str, prompt: &'a ChatPrompt) -> OpenAIChatRequest<'a> {
    let mut messages: Vec<OpenAIMessage<'a>> = Vec::with_capacity(prompt.messages.len() + 1);
    if let Some(sys) = &prompt.system {
        messages.push(OpenAIMessage {
            role: "system",
            content: sys,
        });
    }
    for m in &prompt.messages {
        messages.push(OpenAIMessage {
            role: &m.role,
            content: &m.content,
        });
    }
    OpenAIChatRequest {
        model,
        messages,
        stream: true,
        temperature: prompt.temperature,
        max_tokens: prompt.max_tokens,
    }
}

fn parse_openai_sse(payload: &str) -> ParseOutcome {
    if payload == "[DONE]" {
        return ParseOutcome::Done;
    }
    let parsed: OpenAIStreamChunk = match serde_json::from_str(payload) {
        Ok(v) => v,
        Err(_) => return ParseOutcome::Skip,
    };
    let Some(choice) = parsed.choices.into_iter().next() else {
        return ParseOutcome::Skip;
    };
    let content = choice.delta.content.unwrap_or_default();
    if content.is_empty() && choice.finish_reason.is_none() {
        // Role-only warm-up chunk — every OpenAI stream opens with one.
        return ParseOutcome::Skip;
    }
    ParseOutcome::Chunk(ChatChunk {
        delta: content,
        finish_reason: choice.finish_reason,
    })
}

// ── Anthropic-shape wire ───────────────────────────────────────────────

#[derive(Serialize)]
struct AnthropicMessagesRequest<'a> {
    model: &'a str,
    messages: Vec<AnthropicMessage<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    max_tokens: u32,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    speed: Option<&'static str>,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

fn split_fast_mode(model: &str) -> (&str, bool) {
    match model.strip_suffix(ANTHROPIC_FAST_SUFFIX) {
        Some(stripped) => (stripped, true),
        None => (model, false),
    }
}

fn build_anthropic_body<'a>(
    model: &'a str,
    prompt: &'a ChatPrompt,
    fast_mode: bool,
) -> AnthropicMessagesRequest<'a> {
    let messages = prompt
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| AnthropicMessage {
            role: &m.role,
            content: &m.content,
        })
        .collect();
    AnthropicMessagesRequest {
        model,
        messages,
        system: prompt.system.as_deref(),
        max_tokens: prompt.max_tokens.unwrap_or(ANTHROPIC_DEFAULT_MAX_TOKENS),
        stream: true,
        temperature: prompt.temperature,
        speed: if fast_mode { Some("fast") } else { None },
    }
}

fn parse_anthropic_sse(payload: &str) -> ParseOutcome {
    let v: serde_json::Value = match serde_json::from_str(payload) {
        Ok(x) => x,
        Err(_) => return ParseOutcome::Skip,
    };
    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match ty {
        "content_block_delta" => {
            let text = match v.pointer("/delta/text").and_then(|t| t.as_str()) {
                Some(s) => s.to_string(),
                None => return ParseOutcome::Skip,
            };
            if text.is_empty() {
                return ParseOutcome::Skip;
            }
            ParseOutcome::Chunk(ChatChunk {
                delta: text,
                finish_reason: None,
            })
        }
        "message_stop" => ParseOutcome::Chunk(ChatChunk {
            delta: String::new(),
            finish_reason: Some("stop".into()),
        }),
        _ => ParseOutcome::Skip,
    }
}

// ── Error classification ───────────────────────────────────────────────

fn classify_reqwest_err(e: reqwest::Error) -> ProviderError {
    if e.is_timeout() {
        return ProviderError::DeadlineExceeded(DEFAULT_DEADLINE_MS);
    }
    if e.is_connect() {
        return ProviderError::ProviderError(format!("connect failed: {e}"));
    }
    ProviderError::ProviderError(e.to_string())
}

fn classify_http_err(status: reqwest::StatusCode, body: &str) -> ProviderError {
    match status.as_u16() {
        401 | 403 => ProviderError::AuthFailed,
        429 => ProviderError::QuotaExhausted,
        _ => ProviderError::ProviderError(format!("HTTP {status}: {body}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::provider::types::ChatMessage;

    #[test]
    fn split_fast_mode_strips_suffix_only_when_present() {
        assert_eq!(split_fast_mode("claude-sonnet-4-6-fast"), ("claude-sonnet-4-6", true));
        assert_eq!(split_fast_mode("claude-sonnet-4-6"), ("claude-sonnet-4-6", false));
        assert_eq!(split_fast_mode("-fast"), ("", true));
    }

    #[test]
    fn openai_body_puts_system_first() {
        let prompt = ChatPrompt {
            system: Some("be terse".into()),
            messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
            temperature: Some(0.5),
            max_tokens: None,
        };
        let body = build_openai_body("m", &prompt);
        assert_eq!(body.messages.len(), 2);
        assert_eq!(body.messages[0].role, "system");
        assert_eq!(body.messages[0].content, "be terse");
        assert!(body.stream);
    }

    #[test]
    fn anthropic_body_excludes_system_message_and_defaults_max_tokens() {
        let prompt = ChatPrompt {
            system: Some("be terse".into()),
            messages: vec![
                ChatMessage { role: "system".into(), content: "leaked".into() },
                ChatMessage { role: "user".into(), content: "hi".into() },
            ],
            temperature: None,
            max_tokens: None,
        };
        let body = build_anthropic_body("claude-sonnet-4-6", &prompt, false);
        assert_eq!(body.system, Some("be terse"));
        assert_eq!(body.messages.len(), 1);
        assert_eq!(body.messages[0].role, "user");
        assert_eq!(body.max_tokens, ANTHROPIC_DEFAULT_MAX_TOKENS);
        assert_eq!(body.speed, None);
    }

    #[test]
    fn anthropic_body_fast_mode_sets_speed_field() {
        let prompt = ChatPrompt {
            system: None,
            messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
            temperature: None,
            max_tokens: None,
        };
        let body = build_anthropic_body("claude-sonnet-4-6", &prompt, true);
        assert_eq!(body.speed, Some("fast"));
    }

    #[test]
    fn openai_sse_extracts_content_delta() {
        let p = r#"{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}"#;
        match parse_openai_sse(p) {
            ParseOutcome::Chunk(c) => {
                assert_eq!(c.delta, "Hello");
                assert!(c.finish_reason.is_none());
            }
            _ => panic!("expected chunk"),
        }
    }

    #[test]
    fn openai_sse_handles_done_sentinel() {
        assert!(matches!(parse_openai_sse("[DONE]"), ParseOutcome::Done));
    }

    #[test]
    fn openai_sse_skips_role_only_warmup_and_garbage() {
        let warmup = r#"{"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}"#;
        assert!(matches!(parse_openai_sse(warmup), ParseOutcome::Skip));
        assert!(matches!(parse_openai_sse(""), ParseOutcome::Skip));
        assert!(matches!(parse_openai_sse("not json"), ParseOutcome::Skip));
    }

    #[test]
    fn anthropic_sse_extracts_text_delta() {
        let p = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        match parse_anthropic_sse(p) {
            ParseOutcome::Chunk(c) => assert_eq!(c.delta, "Hello"),
            _ => panic!("expected chunk"),
        }
    }

    #[test]
    fn anthropic_sse_yields_finish_on_message_stop() {
        match parse_anthropic_sse(r#"{"type":"message_stop"}"#) {
            ParseOutcome::Chunk(c) => assert_eq!(c.finish_reason.as_deref(), Some("stop")),
            _ => panic!("expected stop chunk"),
        }
    }

    #[test]
    fn anthropic_sse_skips_other_events() {
        for p in [
            r#"{"type":"message_start"}"#,
            r#"{"type":"content_block_start"}"#,
            r#"{"type":"ping"}"#,
            "not json",
            "",
        ] {
            assert!(matches!(parse_anthropic_sse(p), ParseOutcome::Skip));
        }
    }

    #[test]
    fn classify_http_err_buckets() {
        assert!(matches!(
            classify_http_err(reqwest::StatusCode::UNAUTHORIZED, ""),
            ProviderError::AuthFailed
        ));
        assert!(matches!(
            classify_http_err(reqwest::StatusCode::TOO_MANY_REQUESTS, ""),
            ProviderError::QuotaExhausted
        ));
        assert!(matches!(
            classify_http_err(reqwest::StatusCode::INTERNAL_SERVER_ERROR, "boom"),
            ProviderError::ProviderError(_)
        ));
    }

    #[test]
    fn loopback_endpoint_skips_empty_key_check() {
        assert!(endpoint_is_loopback("http://localhost:11434/v1"));
        assert!(endpoint_is_loopback("http://127.0.0.1:11434"));
        assert!(!endpoint_is_loopback("https://api.openai.com/v1"));
    }
}
