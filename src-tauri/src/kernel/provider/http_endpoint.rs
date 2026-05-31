// HTTP endpoint — `POST /text-chat` served on 127.0.0.1:<port>.
//
// ADR-004 §9.1 lock #7. Pi has no MCP client surface (FINDING-R2.md);
// the Pi bridge runs an in-process LLM provider extension that fires
// `fetch()` against this endpoint and streams the response back to the
// Pi agent loop. SSE wire matches what `commands/irisy_chat.rs`'s
// `handle_sse_payload` already parses for the PWA path.
//
// Port: 17878 by default (between stss 17872 / mcp 17873 / pi 17874).
// `CTRL_PROVIDER_PORT` overrides — the brain lane's spawn-Pi sets this
// env var so Pi knows where to reach the kernel.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::sse::{Event, Sse},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

use super::registry::ProviderRegistry;
use super::r#trait::Capability;
use super::types::{ChatMessage, ChatOpts, ChatPrompt};

/// Default loopback port. Brain lane spawn-Pi may override via
/// `CTRL_PROVIDER_PORT`; the registry exports the resolved port back
/// out via `runtime.provider_endpoint_port` so other consumers can
/// match.
pub const DEFAULT_PORT: u16 = 17878;
pub const ENV_PORT_OVERRIDE: &str = "CTRL_PROVIDER_PORT";

/// Spawn the axum server on a background tokio task. Returns the bound
/// port (useful when port 0 was requested or the env-var override
/// pointed at a different port). The server runs until the tokio
/// runtime shuts down — there's no explicit stop API in v1, the kernel
/// lives for the lifetime of the process.
pub async fn spawn(registry: Arc<ProviderRegistry>) -> Result<u16, String> {
    let port = resolve_port();
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();
    let app = Router::new()
        .route("/text-chat", post(text_chat))
        .with_state(registry);
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(error = %e, "provider HTTP endpoint exited");
        }
    });
    tracing::info!(port = bound_port, "provider HTTP endpoint listening");
    Ok(bound_port)
}

fn resolve_port() -> u16 {
    match std::env::var(ENV_PORT_OVERRIDE) {
        Ok(raw) => raw.parse().unwrap_or(DEFAULT_PORT),
        Err(_) => DEFAULT_PORT,
    }
}

#[derive(Debug, Deserialize)]
struct TextChatRequest {
    messages: Vec<MessageWire>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    temperature: Option<f32>,
    #[serde(default)]
    max_tokens: Option<u32>,
    /// Optional provider id override — Pi can pin a specific provider
    /// (Anthropic API vs Volc), defaulting to whatever `text.chat`
    /// active is.
    #[serde(default)]
    provider: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageWire {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct DeltaPayload {
    delta: String,
}

#[derive(Debug, Serialize)]
struct ErrorPayload {
    message: String,
}

async fn text_chat(
    State(registry): State<Arc<ProviderRegistry>>,
    Json(req): Json<TextChatRequest>,
) -> impl IntoResponse {
    let provider = match req.provider {
        Some(id) => registry.get(&id),
        None => registry.primary_text_chat(),
    };
    let Some(provider) = provider else {
        return (
            StatusCode::PRECONDITION_FAILED,
            "no provider configured for text.chat",
        )
            .into_response();
    };

    let prompt = ChatPrompt {
        system: None,
        messages: req
            .messages
            .into_iter()
            .map(|m| ChatMessage {
                role: m.role,
                content: m.content,
            })
            .collect(),
        temperature: req.temperature,
        max_tokens: req.max_tokens,
    };
    let opts = ChatOpts {
        model: req.model.unwrap_or_default(),
        deadline_ms: 120_000,
    };

    let rx = match provider.chat_stream(&prompt, &opts).await {
        Ok(rx) => rx,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                format!("provider chat_stream failed: {e}"),
            )
                .into_response();
        }
    };
    let _ = Capability::TextChat; // capability check hook (future)

    // Convert mpsc<Result<ChatChunk>> into SSE Events. Match the wire
    // shape the PWA's `handle_sse_payload` already expects:
    //   event: delta\ndata: {"delta": "..."}
    //   event: done\ndata: {}
    //   event: error\ndata: {"message": "..."}
    let stream = into_sse_stream(rx);
    Sse::new(stream).into_response()
}

fn into_sse_stream(
    rx: tokio::sync::mpsc::Receiver<
        Result<super::types::ChatChunk, super::types::ProviderError>,
    >,
) -> impl futures::stream::Stream<Item = Result<Event, std::convert::Infallible>> + Send + 'static {
    let (tx, out_rx) = tokio::sync::mpsc::channel(64);
    let mut rx = rx;
    tokio::spawn(async move {
        let mut saw_finish = false;
        while let Some(item) = rx.recv().await {
            match item {
                Ok(chunk) => {
                    if !chunk.delta.is_empty() {
                        let payload = DeltaPayload {
                            delta: chunk.delta.clone(),
                        };
                        let _ = tx
                            .send(Ok::<_, std::convert::Infallible>(
                                Event::default()
                                    .event("delta")
                                    .json_data(payload)
                                    .unwrap_or_else(|_| Event::default().event("delta")),
                            ))
                            .await;
                    }
                    if chunk.finish_reason.is_some() {
                        saw_finish = true;
                        let _ = tx
                            .send(Ok(Event::default().event("done").data("{}")))
                            .await;
                        break;
                    }
                }
                Err(e) => {
                    let payload = ErrorPayload {
                        message: e.to_string(),
                    };
                    let _ = tx
                        .send(Ok(Event::default()
                            .event("error")
                            .json_data(payload)
                            .unwrap_or_else(|_| Event::default().event("error"))))
                        .await;
                    return;
                }
            }
        }
        if !saw_finish {
            let _ = tx
                .send(Ok(Event::default().event("done").data("{}")))
                .await;
        }
    });
    futures::stream::unfold(out_rx, |mut rx| async move {
        rx.recv().await.map(|e| (e, rx))
    })
}
