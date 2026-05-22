// OpenAIShapeAdapter — implementation of LlmAdapter for any provider
// that exposes the OpenAI /v1/chat/completions wire shape.
//
// In 2026 that's: OpenAI itself, Volcano Ark / Doubao, DeepSeek, Qwen
// (DashScope), Moonshot Kimi, Together, Groq, Mistral, Anyscale, Fireworks,
// LiteLLM proxy, vLLM, OpenAI-compatible Ollama mode. One adapter covers
// nine providers — the only differences are base_url + default model +
// auth header value.
//
// Streaming uses Server-Sent Events with `data: {json}\n\n` framing. We
// parse line-by-line off reqwest's byte stream and forward each delta
// over a tokio mpsc channel so callers can pipe straight to ST-SS cells
// without buffering the whole response.

use crate::kernel::llm_port::{LlmAdapter, LlmChunk, LlmError, LlmPrompt};
use async_trait::async_trait;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::mpsc;

/// Default per-request deadline. Keep below 60s so the user gets a clear
/// timeout error rather than the OS-level reqwest hang on stalled SSE.
const DEFAULT_DEADLINE_MS: u64 = 30_000;

/// Channel capacity for the streaming chunk forwarder. Large enough that
/// a bursty model (Doubao at peak) won't block the SSE reader; small
/// enough to give back-pressure if the consumer is slow.
const STREAM_BUFFER: usize = 64;

#[derive(Clone)]
pub struct OpenAIShapeAdapter {
    name: String,
    base_url: String,
    api_key: String,
    default_model: String,
    client: reqwest::Client,
}

impl OpenAIShapeAdapter {
    pub fn new(
        name: impl Into<String>,
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        default_model: impl Into<String>,
    ) -> Self {
        // Build a single shared reqwest client per adapter so we get
        // connection pooling for back-to-back requests (typical when a
        // user fires off a few keycaps quickly).
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(DEFAULT_DEADLINE_MS))
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

    /// Internal: start a streaming completion. The public LlmAdapter
    /// trait impl below calls this; we keep the worker inline so the
    /// trait method can also apply a wall-clock deadline.
    async fn stream_chat_inner(
        &self,
        model: &str,
        prompt: &LlmPrompt,
    ) -> Result<mpsc::Receiver<Result<LlmChunk, LlmError>>, LlmError> {
        let url = format!("{}/chat/completions", self.base_url);
        let body = build_request_body(self.resolve_model(model), prompt, true);

        let resp = self
            .client
            .post(&url)
            .bearer_auth(&self.api_key)
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
                                "stream read error: {e}"
                            ))))
                            .await;
                        return;
                    }
                };
                // Append received bytes (lossy UTF-8 ok — SSE is ASCII
                // framing; only the JSON payloads have multi-byte runs
                // and those land intact because reqwest emits at chunk
                // boundaries the server flushed).
                buf.push_str(&String::from_utf8_lossy(&bytes));
                // Process complete events delimited by "\n\n".
                while let Some(idx) = buf.find("\n\n") {
                    let event = buf[..idx].to_string();
                    buf.drain(..idx + 2);
                    for line in event.lines() {
                        let line = line.trim_start();
                        if !line.starts_with("data:") {
                            continue;
                        }
                        let payload = line["data:".len()..].trim();
                        if payload == "[DONE]" {
                            // Provider signaled end-of-stream. Drop tx
                            // to close the channel — consumer sees None.
                            return;
                        }
                        match parse_sse_chunk(payload) {
                            Some(chunk) => {
                                if tx.send(Ok(chunk)).await.is_err() {
                                    // Consumer dropped — stop reading.
                                    return;
                                }
                            }
                            None => {
                                // Empty/no-content chunks are normal at
                                // start (role-only delta); skip silently.
                            }
                        }
                    }
                }
            }
            // Stream closed without [DONE] — that's still a graceful end
            // for most providers (drop tx to close channel).
        });

        Ok(rx)
    }
}

#[async_trait]
impl LlmAdapter for OpenAIShapeAdapter {
    fn name(&self) -> &str {
        &self.name
    }

    fn supports(&self, _model: &str) -> bool {
        // Accept any model id — provider validates. This keeps the
        // adapter from needing a hardcoded model catalog that drifts.
        true
    }

    async fn complete(
        &self,
        model: &str,
        prompt: &LlmPrompt,
        deadline_ms: u64,
    ) -> Result<String, LlmError> {
        // Non-streaming round-trip implemented on top of stream_chat_inner —
        // single source of truth for wire format. Caller's deadline_ms
        // governs the whole operation (override the adapter default if
        // shorter).
        let deadline = if deadline_ms == 0 {
            DEFAULT_DEADLINE_MS
        } else {
            deadline_ms
        };
        let mut rx = tokio::time::timeout(
            Duration::from_millis(deadline),
            self.stream_chat_inner(model, prompt),
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
        // reqwest::Client::timeout already enforces a per-request deadline
        // at the transport layer; we accept the trait deadline_ms but
        // don't double-clock (the client default DEFAULT_DEADLINE_MS is
        // what fires).
        self.stream_chat_inner(model, prompt).await
    }
}

// ── Wire shapes ──────────────────────────────────────────────────────────

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

fn build_request_body<'a>(
    model: &'a str,
    prompt: &'a LlmPrompt,
    stream: bool,
) -> OpenAIChatRequest<'a> {
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
        stream,
        temperature: prompt.temperature,
        max_tokens: prompt.max_tokens,
    }
}

fn parse_sse_chunk(json_payload: &str) -> Option<LlmChunk> {
    let parsed: OpenAIStreamChunk = serde_json::from_str(json_payload).ok()?;
    let choice = parsed.choices.into_iter().next()?;
    let content = choice.delta.content.unwrap_or_default();
    if content.is_empty() && choice.finish_reason.is_none() {
        return None;
    }
    Some(LlmChunk {
        delta: content,
        finish_reason: choice.finish_reason,
    })
}

fn classify_reqwest_error(e: &reqwest::Error) -> LlmError {
    if e.is_timeout() {
        return LlmError::DeadlineExceeded(DEFAULT_DEADLINE_MS);
    }
    if e.is_connect() {
        return LlmError::ProviderError(format!("connect failed: {e}"));
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
        let a = OpenAIShapeAdapter::new("test", "https://x.test", "k", "default-m");
        assert_eq!(a.resolve_model(""), "default-m");
        assert_eq!(a.resolve_model("override-m"), "override-m");
    }

    #[test]
    fn build_request_body_serializes_system_first() {
        let prompt = LlmPrompt {
            system: Some("You are CTRL.".into()),
            messages: vec![LlmMessage {
                role: "user".into(),
                content: "hi".into(),
            }],
            temperature: Some(0.7),
            max_tokens: None,
        };
        let body = build_request_body("m", &prompt, true);
        assert_eq!(body.messages.len(), 2);
        assert_eq!(body.messages[0].role, "system");
        assert_eq!(body.messages[0].content, "You are CTRL.");
        assert_eq!(body.messages[1].role, "user");
        assert!(body.stream);
    }

    #[test]
    fn parse_sse_chunk_extracts_delta() {
        let payload = r#"{"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}"#;
        let chunk = parse_sse_chunk(payload).expect("chunk parses");
        assert_eq!(chunk.delta, "Hello");
        assert!(chunk.finish_reason.is_none());
    }

    #[test]
    fn parse_sse_chunk_handles_finish_reason_only() {
        let payload = r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#;
        let chunk = parse_sse_chunk(payload).expect("chunk parses");
        assert_eq!(chunk.delta, "");
        assert_eq!(chunk.finish_reason.as_deref(), Some("stop"));
    }

    #[test]
    fn parse_sse_chunk_skips_role_only_warmup() {
        // First SSE event from OpenAI is typically delta={role:'assistant'}
        // with no content. We treat that as "nothing useful yet".
        let payload = r#"{"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}"#;
        assert!(parse_sse_chunk(payload).is_none());
    }

    #[test]
    fn parse_sse_chunk_returns_none_on_garbage() {
        assert!(parse_sse_chunk("").is_none());
        assert!(parse_sse_chunk("not json").is_none());
        assert!(parse_sse_chunk(r#"{"choices":[]}"#).is_none());
    }

    #[test]
    fn classify_http_error_buckets() {
        let unauthorized = reqwest::StatusCode::UNAUTHORIZED;
        assert!(matches!(
            classify_http_error(unauthorized, ""),
            LlmError::AuthFailed
        ));
        let rate = reqwest::StatusCode::TOO_MANY_REQUESTS;
        assert!(matches!(
            classify_http_error(rate, ""),
            LlmError::QuotaExhausted
        ));
        let other = reqwest::StatusCode::INTERNAL_SERVER_ERROR;
        assert!(matches!(
            classify_http_error(other, "boom"),
            LlmError::ProviderError(_)
        ));
    }
}
