// AnthropicHttpAdapter — LlmAdapter for Anthropic Messages API (BYOK).
//
// Direct fetch against `https://api.anthropic.com/v1/messages`, SSE
// streaming. Modelled after Zed's `crates/anthropic/src/anthropic.rs`
// — bare BufReader-over-bytes, no SDK dependency.
//
// Why a separate adapter from openai_shape: Anthropic puts `system` at
// the top level (not in messages[]), requires `max_tokens` non-optional,
// uses `x-api-key` instead of Bearer, and SSE events carry typed
// `content_block_delta` payloads (not OpenAI delta.content shape).
//
// Fast-mode beta: a model id ending in `-fast` (e.g. `claude-sonnet-4-6-fast`)
// is stripped and the request gets `anthropic-beta: fast-mode-2026-02-01`.
// This is Cline's convention — encodes the speed flag in the model string
// so the rest of the routing (default_model in config.toml, UI dropdowns)
// doesn't need a separate checkbox.

use crate::kernel::llm_port::{LlmAdapter, LlmChunk, LlmError, LlmPrompt};
use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const FAST_MODE_BETA: &str = "fast-mode-2026-02-01";
const FAST_SUFFIX: &str = "-fast";

/// 60s — Anthropic responses with extended thinking can run long.
const DEFAULT_DEADLINE_MS: u64 = 60_000;
const STREAM_BUFFER: usize = 64;
/// Default `max_tokens` when caller didn't supply one. Anthropic requires
/// the field non-optional; we pick a number large enough for typical
/// chat responses without burning quota on runaway.
const DEFAULT_MAX_TOKENS: u32 = 4096;

#[derive(Clone)]
pub struct AnthropicHttpAdapter {
    name: String,
    base_url: String,
    api_key: String,
    default_model: String,
    client: reqwest::Client,
}

impl AnthropicHttpAdapter {
    pub fn new(
        name: impl Into<String>,
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        default_model: impl Into<String>,
    ) -> Self {
        // pool_idle_timeout(180s) keeps the TLS+H2 connection warm across
        // back-to-back keycap turns — Anthropic holds idle connections
        // ~3min, reqwest's 90s default evicts too aggressively.
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(DEFAULT_DEADLINE_MS))
            .pool_idle_timeout(Duration::from_secs(180))
            .build()
            .expect("reqwest client build (default config never fails)");
        Self {
            name: name.into(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            default_model: default_model.into(),
            client,
        }
    }

    fn resolve_model<'a>(&'a self, model: &'a str) -> &'a str {
        if model.is_empty() {
            &self.default_model
        } else {
            model
        }
    }

    fn split_fast_mode<'a>(model: &'a str) -> (&'a str, bool) {
        match model.strip_suffix(FAST_SUFFIX) {
            Some(stripped) => (stripped, true),
            None => (model, false),
        }
    }

    async fn stream_messages_inner(
        &self,
        model: &str,
        prompt: &LlmPrompt,
    ) -> Result<mpsc::Receiver<Result<LlmChunk, LlmError>>, LlmError> {
        let resolved = self.resolve_model(model);
        let (model_id, fast_mode) = Self::split_fast_mode(resolved);

        let url = format!("{}/v1/messages", self.base_url);
        let body = build_messages_request(model_id, prompt, true, fast_mode);

        let mut req = self
            .client
            .post(&url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json");
        if fast_mode {
            req = req.header("anthropic-beta", FAST_MODE_BETA);
        }

        let resp = req
            .json(&body)
            .send()
            .await
            .map_err(|e| classify_reqwest_error(&e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(classify_http_error(status, &body_text));
        }

        let (tx, rx) = mpsc::channel(STREAM_BUFFER);
        let mut byte_stream = resp.bytes_stream();

        tokio::spawn(async move {
            let mut buf = String::new();
            while let Some(chunk_result) = byte_stream.next().await {
                let bytes = match chunk_result {
                    Ok(b) => b,
                    Err(e) => {
                        let _ = tx
                            .send(Err(LlmError::ProviderError(format!(
                                "anthropic stream read: {e}"
                            ))))
                            .await;
                        return;
                    }
                };
                buf.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(idx) = buf.find("\n\n") {
                    let event = buf[..idx].to_string();
                    buf.drain(..idx + 2);
                    let mut data_line: Option<String> = None;
                    for line in event.lines() {
                        let line = line.trim_start();
                        if let Some(payload) = line.strip_prefix("data:") {
                            data_line = Some(payload.trim().to_string());
                        }
                    }
                    let Some(payload) = data_line else { continue };
                    if let Some(chunk) = parse_anthropic_event(&payload) {
                        if tx.send(Ok(chunk)).await.is_err() {
                            return;
                        }
                    }
                }
            }
        });

        Ok(rx)
    }
}

#[async_trait]
impl LlmAdapter for AnthropicHttpAdapter {
    fn name(&self) -> &str {
        &self.name
    }

    fn supports(&self, _model: &str) -> bool {
        true
    }

    async fn complete(
        &self,
        model: &str,
        prompt: &LlmPrompt,
        deadline_ms: u64,
    ) -> Result<String, LlmError> {
        let deadline = if deadline_ms == 0 {
            DEFAULT_DEADLINE_MS
        } else {
            deadline_ms
        };
        let mut rx = tokio::time::timeout(
            Duration::from_millis(deadline),
            self.stream_messages_inner(model, prompt),
        )
        .await
        .map_err(|_| LlmError::DeadlineExceeded(deadline))??;

        let mut acc = String::new();
        let collect = async {
            while let Some(item) = rx.recv().await {
                match item {
                    Ok(chunk) => acc.push_str(&chunk.delta),
                    Err(e) => return Err(e),
                }
            }
            Ok(acc)
        };
        tokio::time::timeout(Duration::from_millis(deadline), collect)
            .await
            .map_err(|_| LlmError::DeadlineExceeded(deadline))?
    }

    async fn stream_chat(
        &self,
        model: &str,
        prompt: &LlmPrompt,
        _deadline_ms: u64,
    ) -> Result<mpsc::Receiver<Result<LlmChunk, LlmError>>, LlmError> {
        self.stream_messages_inner(model, prompt).await
    }
}

// ── Wire shapes ──────────────────────────────────────────────────────────

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

#[derive(Deserialize)]
struct EventEnvelope<'a> {
    #[serde(rename = "type")]
    ty: &'a str,
}

fn build_messages_request<'a>(
    model: &'a str,
    prompt: &'a LlmPrompt,
    stream: bool,
    fast_mode: bool,
) -> AnthropicMessagesRequest<'a> {
    // Anthropic disallows `system` in messages[] — filter it out and pass
    // the prompt-level `system` via the top-level field instead.
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
        max_tokens: prompt.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        stream,
        temperature: prompt.temperature,
        speed: if fast_mode { Some("fast") } else { None },
    }
}

fn parse_anthropic_event(payload: &str) -> Option<LlmChunk> {
    // Events of interest in the Messages SSE stream:
    //   {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
    //   {"type":"message_stop"}
    // Other event types (`message_start`, `content_block_start`, `ping`,
    // `message_delta`) carry no user-visible token deltas in v1 and are
    // skipped silently.
    let env: EventEnvelope = serde_json::from_str(payload).ok()?;
    match env.ty {
        "content_block_delta" => {
            let v: serde_json::Value = serde_json::from_str(payload).ok()?;
            let text = v.pointer("/delta/text")?.as_str()?.to_string();
            if text.is_empty() {
                return None;
            }
            Some(LlmChunk {
                delta: text,
                finish_reason: None,
            })
        }
        "message_stop" => Some(LlmChunk {
            delta: String::new(),
            finish_reason: Some("stop".into()),
        }),
        _ => None,
    }
}

fn classify_reqwest_error(e: &reqwest::Error) -> LlmError {
    if e.is_timeout() {
        return LlmError::DeadlineExceeded(DEFAULT_DEADLINE_MS);
    }
    if e.is_connect() {
        return LlmError::ProviderError(format!("anthropic connect failed: {e}"));
    }
    LlmError::ProviderError(e.to_string())
}

fn classify_http_error(status: reqwest::StatusCode, body: &str) -> LlmError {
    match status.as_u16() {
        401 | 403 => LlmError::AuthFailed,
        429 => LlmError::QuotaExhausted,
        _ => LlmError::ProviderError(format!("HTTP {status}: {body}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::llm_port::LlmMessage;

    #[test]
    fn resolve_model_falls_back_to_default() {
        let a = AnthropicHttpAdapter::new("anthropic", "https://x", "k", "default-m");
        assert_eq!(a.resolve_model(""), "default-m");
        assert_eq!(a.resolve_model("claude-opus-4-7"), "claude-opus-4-7");
    }

    #[test]
    fn split_fast_mode_strips_suffix() {
        assert_eq!(
            AnthropicHttpAdapter::split_fast_mode("claude-sonnet-4-6-fast"),
            ("claude-sonnet-4-6", true)
        );
        assert_eq!(
            AnthropicHttpAdapter::split_fast_mode("claude-sonnet-4-6"),
            ("claude-sonnet-4-6", false)
        );
        assert_eq!(
            AnthropicHttpAdapter::split_fast_mode("-fast"),
            ("", true)
        );
    }

    #[test]
    fn build_messages_includes_system_separately() {
        let prompt = LlmPrompt {
            system: Some("You are CTRL.".into()),
            messages: vec![
                LlmMessage {
                    role: "system".into(),
                    content: "leaked system".into(),
                },
                LlmMessage {
                    role: "user".into(),
                    content: "hi".into(),
                },
            ],
            temperature: Some(0.5),
            max_tokens: Some(1024),
        };
        let body = build_messages_request("claude-sonnet-4-6", &prompt, true, false);
        assert_eq!(body.system, Some("You are CTRL."));
        // `system`-role message must NOT be forwarded — Anthropic rejects it.
        assert_eq!(body.messages.len(), 1);
        assert_eq!(body.messages[0].role, "user");
        assert_eq!(body.max_tokens, 1024);
        assert_eq!(body.speed, None);
    }

    #[test]
    fn build_messages_defaults_max_tokens() {
        let prompt = LlmPrompt {
            system: None,
            messages: vec![LlmMessage {
                role: "user".into(),
                content: "x".into(),
            }],
            temperature: None,
            max_tokens: None,
        };
        let body = build_messages_request("claude-sonnet-4-6", &prompt, true, false);
        assert_eq!(body.max_tokens, DEFAULT_MAX_TOKENS);
    }

    #[test]
    fn build_messages_fast_mode_sets_speed_field() {
        let prompt = LlmPrompt {
            system: None,
            messages: vec![LlmMessage {
                role: "user".into(),
                content: "x".into(),
            }],
            temperature: None,
            max_tokens: None,
        };
        let body = build_messages_request("claude-sonnet-4-6", &prompt, true, true);
        assert_eq!(body.speed, Some("fast"));
    }

    #[test]
    fn parse_content_block_delta_yields_text() {
        let p = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}"#;
        let c = parse_anthropic_event(p).expect("delta parses");
        assert_eq!(c.delta, "Hello");
        assert!(c.finish_reason.is_none());
    }

    #[test]
    fn parse_message_stop_yields_finish_reason() {
        let c = parse_anthropic_event(r#"{"type":"message_stop"}"#).expect("stop parses");
        assert_eq!(c.delta, "");
        assert_eq!(c.finish_reason.as_deref(), Some("stop"));
    }

    #[test]
    fn parse_unknown_events_return_none() {
        assert!(parse_anthropic_event(r#"{"type":"message_start"}"#).is_none());
        assert!(parse_anthropic_event(r#"{"type":"content_block_start"}"#).is_none());
        assert!(parse_anthropic_event(r#"{"type":"ping"}"#).is_none());
    }

    #[test]
    fn parse_garbage_returns_none() {
        assert!(parse_anthropic_event("").is_none());
        assert!(parse_anthropic_event("not json").is_none());
    }

    #[test]
    fn classify_http_error_buckets() {
        assert!(matches!(
            classify_http_error(reqwest::StatusCode::UNAUTHORIZED, ""),
            LlmError::AuthFailed
        ));
        assert!(matches!(
            classify_http_error(reqwest::StatusCode::TOO_MANY_REQUESTS, ""),
            LlmError::QuotaExhausted
        ));
        assert!(matches!(
            classify_http_error(reqwest::StatusCode::INTERNAL_SERVER_ERROR, "boom"),
            LlmError::ProviderError(_)
        ));
    }
}
