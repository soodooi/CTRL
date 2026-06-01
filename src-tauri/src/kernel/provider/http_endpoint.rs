// HTTP endpoint — `POST /text-chat` served on 127.0.0.1:<port>.
//
// ADR-002 substrate § provider v2 lock #7. Pi has no MCP client surface (FINDING-R2.md);
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
use super::r#trait::{Capability, Consumer};
use super::types::{ChatMessage, ChatOpts, ChatPrompt, ProviderError};

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
    /// active is. When set, takes precedence over `consumer`; no
    /// auto-fallback occurs.
    #[serde(default)]
    provider: Option<String>,
    /// Optional consumer role id ("irisy.primary" / "irisy.fallback").
    /// Drives ADR-002 substrate § provider v2 §3.5 auto-fallback: the
    /// kernel walks the role's RouteChain and records a transition via
    /// `registry.record_failover` when the primary fails. Defaults to
    /// `irisy.primary` when neither `provider` nor `consumer` is set.
    #[serde(default)]
    consumer: Option<String>,
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
    let _ = Capability::TextChat; // capability check hook (future)

    // ADR-002 substrate § provider v2 §3.5: provider id pins skip the
    // fallback chain entirely (Pi explicit choice). Otherwise resolve a
    // RouteChain from the consumer role (default IrisyPrimary) and try
    // each candidate in order.
    if let Some(provider_id) = req.provider.as_deref() {
        let Some(provider) = registry.get(provider_id) else {
            return (
                StatusCode::PRECONDITION_FAILED,
                "pinned provider not found",
            )
                .into_response();
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
        return Sse::new(into_sse_stream(rx)).into_response();
    }

    let consumer = req
        .consumer
        .as_deref()
        .map(Consumer::from_id)
        .unwrap_or(Consumer::IrisyPrimary);
    let chain = registry.route_chain(&consumer);

    let mut candidates: Vec<String> = Vec::new();
    if let Some(primary) = chain.primary.clone() {
        candidates.push(primary);
    }
    candidates.extend(chain.fallbacks.clone());
    if candidates.is_empty() {
        // No primary AND no fallback configured for this consumer —
        // last-resort backstop (matches the v1 behaviour for callers
        // that haven't migrated to `consumer=`).
        if let Some(provider) = registry.primary_text_chat() {
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
            return Sse::new(into_sse_stream(rx)).into_response();
        }
        return (
            StatusCode::PRECONDITION_FAILED,
            "no provider configured for text.chat",
        )
            .into_response();
    }

    let primary_id = candidates.first().cloned();
    let mut primary_error: Option<(String, ProviderError)> = None;
    let mut chosen: Option<(String, _)> = None;

    for (i, manifest_id) in candidates.iter().enumerate() {
        let Some(provider) = registry.get(manifest_id) else {
            continue;
        };
        match provider.chat_stream(&prompt, &opts).await {
            Ok(rx) => {
                chosen = Some((manifest_id.clone(), rx));
                // Auto-fallback happened iff the resolved provider is
                // not the primary slot.
                if i > 0 {
                    if let Some((from_id, err)) = primary_error.take() {
                        registry.record_failover(
                            &from_id,
                            manifest_id,
                            &err.to_string(),
                        );
                    } else if let Some(from_id) = primary_id.clone() {
                        // Primary id existed but never tried (e.g. the
                        // manifest wasn't registered) — still a
                        // transition worth recording so brain_status
                        // exposes the slot-swap.
                        registry.record_failover(
                            &from_id,
                            manifest_id,
                            "primary provider not registered",
                        );
                    }
                }
                break;
            }
            Err(e) => {
                if i == 0 {
                    primary_error = Some((manifest_id.clone(), e));
                } else {
                    tracing::warn!(
                        provider = %manifest_id,
                        error = %e,
                        "provider: fallback candidate also failed; walking chain"
                    );
                }
            }
        }
    }

    let Some((_chosen_id, rx)) = chosen else {
        // Every candidate refused — surface the primary's error if we
        // captured one, otherwise generic.
        let detail = primary_error
            .map(|(_, e)| e.to_string())
            .unwrap_or_else(|| "all providers in route chain refused".to_string());
        return (
            StatusCode::BAD_GATEWAY,
            format!("provider chat_stream failed: {detail}"),
        )
            .into_response();
    };

    // Convert mpsc<Result<ChatChunk>> into SSE Events. Match the wire
    // shape the PWA's `handle_sse_payload` already expects:
    //   event: delta\ndata: {"delta": "..."}
    //   event: done\ndata: {}
    //   event: error\ndata: {"message": "..."}
    Sse::new(into_sse_stream(rx)).into_response()
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
