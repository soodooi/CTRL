// HTTP endpoint — `POST /text-chat` + `POST /tool/<name>` served on 127.0.0.1:<port>.
//
// ADR-002 substrate § provider v2 lock #7 (text-chat) + § brain v7 §1.1
// (tool dispatch, 2026-06-04).
//
// Pi has no MCP client surface (FINDING-R2.md); the Pi bridge runs an
// in-process LLM provider extension that fires `fetch()` against this
// endpoint. `/text-chat` streams provider tokens back to Pi (SSE wire
// matches what `commands/irisy_chat.rs`'s `handle_sse_payload` already
// parses for the PWA path). `/tool/<name>` is the BYOK frontier-native
// function-calling path (ADR-005 irisy v4 §7.5) — Pi's
// `registerTool()` handlers POST here and receive a JSON
// `{ok, result?, error?}` envelope synchronously.
//
// Port: 17878 by default (between stss 17872 / mcp 17873 / pi 17874).
// `CTRL_PROVIDER_PORT` overrides — the brain lane's spawn-Pi sets this
// env var so Pi knows where to reach the kernel.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::sse::{Event, Sse},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;

use super::registry::ProviderRegistry;
use super::routing::route_text_chat;
use super::r#trait::{Capability, Consumer};
use super::types::{ChatMessage, ChatOpts, ChatPrompt};
use crate::shell::KernelHandle;

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
///
/// State = `KernelHandle` (ADR-002 substrate § brain v7 §1.1, 2026-06-04):
/// /text-chat pulls the registry out of `handle.runtime.provider_registry`,
/// /tool/<name> needs the full handle for run_mcp event publishing +
/// mcp_host access.
pub async fn spawn(handle: KernelHandle) -> Result<u16, String> {
    let port = resolve_port();
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("bind {addr}: {e}"))?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| format!("local_addr: {e}"))?
        .port();
    // ADR-002 substrate § provider v9 §3.7 (2026-06-06): retract
    // /api/active-providers — Pi now spawns with the real provider+model
    // directly, so Pi's `getState` is the truth. Nothing inside the Pi
    // process needs to fetch SSOT projection any more.
    let app = Router::new()
        .route("/text-chat", post(text_chat))
        .route("/tool/{name}", post(tool_dispatch))
        .with_state(handle);
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
    State(handle): State<KernelHandle>,
    Json(req): Json<TextChatRequest>,
) -> impl IntoResponse {
    let registry: Arc<ProviderRegistry> = handle.runtime.provider_registry.clone();
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
    // bao 2026-06-04: ctrl-pi-bridge forwards Pi's `PI_MODEL=default`
    // env placeholder verbatim as the wire `model` field. Some
    // adapters (Ollama in particular — exact tag resolution, no
    // implicit `:latest`) 404 on `model="default"`. Treat the
    // literal "default" sentinel as "no preference" so the adapter
    // falls through to its manifest `models[0]` (qwen2.5:7b for
    // ollama, claude-sonnet-* for anthropic, etc.).
    let model_raw = req.model.unwrap_or_default();
    let model = if model_raw == "default" { String::new() } else { model_raw };
    let opts = ChatOpts {
        model,
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

    // Candidate walking + cooldown + first-chunk peek live in
    // provider::routing::route_text_chat (extracted 2026-06-10, ADR-002
    // § provider v9 §3.5) so this endpoint and commands/irisy_chat
    // share one implementation.
    match route_text_chat(&registry, &consumer, &prompt, &opts).await {
        Ok((_provider_id, rx)) => Sse::new(into_sse_stream(rx)).into_response(),
        Err(detail) => {
            let status = if detail.contains("no provider configured") {
                StatusCode::PRECONDITION_FAILED
            } else {
                StatusCode::BAD_GATEWAY
            };
            (status, detail).into_response()
        }
    }
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

// ── /tool/<name> dispatcher ─────────────────────────────────────────────
//
// ADR-002 substrate § brain v7 §1.1 + ADR-005 irisy v4 §7.5 (2026-06-04):
// Pi's `registerTool()` handlers in `ctrl-pi-bridge` POST here. The wire
// envelope matches what `packages/ctrl-pi-bridge/src/index.ts ::
// callKernelTool` expects: input is the tool args JSON; output is
// `{ ok: true, result: ... }` or `{ ok: false, error: "..." }`.
//
// Dispatch policy: each branch reuses the existing Tauri command body's
// inner free function (vault_root + check_cap + vault::* / vault_graph::*
// / skills::list_local_skills / kernel.rs::run_mcp). One SSOT for the
// business logic — this file is glue only.

#[derive(serde::Serialize)]
#[serde(untagged)]
enum ToolReply {
    Ok { ok: bool, result: serde_json::Value },
    Err { ok: bool, error: String },
}

impl ToolReply {
    fn ok(value: serde_json::Value) -> Self {
        ToolReply::Ok { ok: true, result: value }
    }
    fn err(msg: impl Into<String>) -> Self {
        ToolReply::Err { ok: false, error: msg.into() }
    }
}

async fn tool_dispatch(
    State(handle): State<KernelHandle>,
    Path(name): Path<String>,
    Json(args): Json<serde_json::Value>,
) -> Json<ToolReply> {
    tracing::debug!(tool = %name, "tool_dispatch: routing");
    let reply = match name.as_str() {
        "vault_write" => run_vault_write(args).await,
        "vault_read" => run_vault_read(args).await,
        "vault_search" => run_vault_search(args).await,
        "vault_tags" => run_vault_tags(args).await,
        "vault_backlinks" => run_vault_backlinks(args).await,
        "list_local_skills" => run_list_local_skills(args).await,
        "list_mcps" => run_list_mcps().await,
        "install_mcp" => run_install_mcp(args, &handle).await,
        "mcp_run" => run_mcp_dispatch(args, &handle).await,
        "brain_status" => run_brain_status(&handle).await,
        // bao 2026-06-05 b: ctrl-pi-bridge calls this at session_start to
        // resolve the active provider's full credentials and shape so it
        // can `pi.registerProvider` Pi with a real OpenAI-/Anthropic-
        // compat config. Replaces the previous direct /text-chat round-
        // trip (which stripped tool_calls). Returned shape matches
        // `KernelActiveProvider` in ctrl-pi-bridge/src/index.ts.
        "get_active_provider_details" => run_get_active_provider_details(&handle).await,
        other => Err(format!("unknown tool: {other}")),
    };
    Json(match reply {
        Ok(v) => ToolReply::ok(v),
        Err(e) => {
            tracing::warn!(tool = %name, error = %e, "tool_dispatch: failed");
            ToolReply::err(e)
        }
    })
}

fn parse_args<T: serde::de::DeserializeOwned>(v: serde_json::Value) -> Result<T, String> {
    serde_json::from_value(v).map_err(|e| format!("invalid args: {e}"))
}

async fn run_vault_write(args: serde_json::Value) -> Result<serde_json::Value, String> {
    let parsed = parse_args::<crate::commands::vault::VaultWriteArgs>(args)?;
    let reply = crate::commands::vault::vault_write(parsed).await?;
    serde_json::to_value(reply).map_err(|e| e.to_string())
}

async fn run_vault_read(args: serde_json::Value) -> Result<serde_json::Value, String> {
    let parsed = parse_args::<crate::commands::vault::VaultReadArgs>(args)?;
    let reply = crate::commands::vault::vault_read(parsed).await?;
    serde_json::to_value(reply).map_err(|e| e.to_string())
}

async fn run_vault_search(args: serde_json::Value) -> Result<serde_json::Value, String> {
    let parsed = parse_args::<crate::commands::vault::VaultSearchArgs>(args)?;
    let reply = crate::commands::vault::vault_search(parsed).await?;
    serde_json::to_value(reply).map_err(|e| e.to_string())
}

async fn run_vault_tags(args: serde_json::Value) -> Result<serde_json::Value, String> {
    let parsed = parse_args::<crate::commands::vault::VaultEmptyArgs>(args)?;
    let reply = crate::commands::vault::vault_tags(parsed).await?;
    serde_json::to_value(reply).map_err(|e| e.to_string())
}

async fn run_vault_backlinks(args: serde_json::Value) -> Result<serde_json::Value, String> {
    let parsed = parse_args::<crate::commands::vault::VaultGraphQueryArgs>(args)?;
    let reply = crate::commands::vault::vault_backlinks(parsed).await?;
    serde_json::to_value(reply).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
struct ListLocalSkillsArgs {
    #[serde(default)]
    query: Option<String>,
}

async fn run_list_local_skills(args: serde_json::Value) -> Result<serde_json::Value, String> {
    let parsed = parse_args::<ListLocalSkillsArgs>(args).unwrap_or(ListLocalSkillsArgs { query: None });
    let reply = crate::commands::skills::list_local_skills(parsed.query).await?;
    serde_json::to_value(reply).map_err(|e| e.to_string())
}

async fn run_list_mcps() -> Result<serde_json::Value, String> {
    // list_mcps' Tauri body only reads ~/.ctrl/mcps/; rebuild that
    // logic here (one-liner) so we don't fight the `State<KernelHandle>`
    // injection in the original.
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = PathBuf::from(home).join(".ctrl").join("mcps");
    let summaries = crate::commands::kernel::list_installed_in(&dir);
    serde_json::to_value(summaries).map_err(|e| e.to_string())
}

async fn run_install_mcp(
    args: serde_json::Value,
    handle: &KernelHandle,
) -> Result<serde_json::Value, String> {
    let parsed = parse_args::<crate::commands::kernel::InstallMcpArgs>(args)?;
    // Reuse install_into via the shared mcp dir helper. Replicates the
    // Tauri command body's logic minus the `State<KernelHandle>` extractor.
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = PathBuf::from(home).join(".ctrl").join("mcps");
    let summary = crate::commands::kernel::install_into(&dir, &parsed)?;
    tracing::info!(mcp_id = %summary.id, "install_mcp (via /tool) ok");
    let _ = handle; // reserved for future capability-broker hook
    serde_json::to_value(summary).map_err(|e| e.to_string())
}

async fn run_mcp_dispatch(
    args: serde_json::Value,
    handle: &KernelHandle,
) -> Result<serde_json::Value, String> {
    let parsed = parse_args::<crate::commands::kernel::RunMcpArgs>(args)?;
    // Reuse the existing run_mcp inner body — it publishes
    // McpInvoked / McpCompleted / McpFailed Ops so the PWA
    // workspace pane shows Pi-driven invocations identically to user
    // clicks. Single SSOT for mcp execution.
    let result = crate::commands::kernel::run_mcp_inner(parsed, handle).await?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

async fn run_brain_status(handle: &KernelHandle) -> Result<serde_json::Value, String> {
    let view = crate::commands::provider::brain_status_inner(handle)?;
    serde_json::to_value(view).map_err(|e| e.to_string())
}

/// Resolve the irisy.primary active provider's full registration shape
/// for ctrl-pi-bridge. Output (JSON):
///   { id, api, baseUrl, apiKey, models: [{id,name,contextWindow,maxTokens}] }
/// where `api` is "openai-completions" or "anthropic-messages" (mapped
/// from manifest HttpShape) so Pi can register the provider natively.
async fn run_get_active_provider_details(
    handle: &KernelHandle,
) -> Result<serde_json::Value, String> {
    use super::manifest::{AuthSource, HttpShape};
    use super::r#trait::Consumer;

    let registry = &handle.runtime.provider_registry;
    let active = registry.active_state();
    let id = active
        .get(&Consumer::IrisyPrimary.id())
        .cloned()
        .ok_or_else(|| "no active provider for irisy.primary".to_string())?;
    let manifest = registry
        .manifest_for(&id)
        .ok_or_else(|| format!("provider {id} not in registry"))?;

    // Map HttpShape -> Pi's `Api` discriminator.
    let api = match manifest.shape {
        HttpShape::OpenaiChatCompletions => "openai-completions",
        HttpShape::AnthropicMessages => "anthropic-messages",
    };
    let base_url = manifest
        .endpoint
        .clone()
        .ok_or_else(|| format!("provider {id} has no endpoint"))?;

    // Resolve credential via subprocess `security` CLI (bao 2026-06-05 d).
    // The keyring v3 apple-native path silently non-persists in signed
    // CTRL.app — see comment in `shell::keychain_subprocess`.
    let api_key = match &manifest.auth {
        AuthSource::Keychain { account } => {
            crate::shell::credential_vault::get(account.as_str())
                .map_err(|e| format!("provider {id}: vault read failed: {e}"))?
                .ok_or_else(|| {
                    format!("provider {id}: no vault entry for account {account:?}")
                })?
        }
        AuthSource::Env { var } => std::env::var(var)
            .map_err(|_| format!("provider {id}: env var {var} not set"))?,
        AuthSource::ConfigKey { field } => manifest
            .config
            .get(field)
            .cloned()
            .ok_or_else(|| format!("provider {id}: config key {field} missing"))?,
        AuthSource::None => String::new(),
    };

    let models: Vec<serde_json::Value> = manifest
        .models
        .iter()
        .map(|m| {
            serde_json::json!({
                "id": m,
                "name": m,
                "contextWindow": 200_000_i64,
                "maxTokens": 8192_i64,
                "reasoning": false,
                "input": ["text"],
            })
        })
        .collect();

    Ok(serde_json::json!({
        "id": id,
        "api": api,
        "baseUrl": base_url,
        "apiKey": api_key,
        "models": models,
    }))
}

// ADR-002 substrate § provider v9 §3.7 (2026-06-06). RETIRED:
// /api/active-providers handler — Pi spawns with the real BYOK
// provider+model now, so nothing inside the Pi process needs to fetch
// SSOT projection. The Tauri `get_active_providers` command was retired
// in the same amendment.
