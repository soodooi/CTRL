// kernel::mcp_server — Kernel-as-MCP-server (per memory
// `decision_kernel_is_mcp_server_for_irisy`, ADR-013).
//
// Exposes the kernel's capability surface as MCP tools so that:
//   • Irisy (in-process via Tauri WebView)
//   • Brain keycaps (e.g. @ctrl/pi-plugin, separate MCP server process)
//   • External AI agents on the user's machine (Cursor, etc.)
// all consume the same backend through a single MCP wire — tools/list +
// tools/call instead of N bespoke RPC surfaces.
//
// Transport: streamable-http (replaces the deprecated SSE transport in the
// MCP 2025-03-26 spec). Bound to 127.0.0.1:17873, never exposed beyond
// loopback. Auth = Bearer <ephemeral token>, generated fresh per kernel
// boot — same model as `stss_bridge` (never persisted to disk).
//
// What this module does NOT do:
//   • Bind 0.0.0.0 / accept LAN clients (mesh covered by ADR-003)
//   • Issue long-lived tokens (each kernel boot = new token; the in-process
//     PWA and brain keycaps both fetch fresh via Tauri commands)
//   • Implement business logic — every tool is a thin call into existing
//     kernel modules (vault, local_storage, llm_port, mcp_host) so tests
//     stay against those modules, not the MCP envelope.

use crate::kernel::local_storage::LocalStorage;
use crate::kernel::runtime::KernelRuntime;
use crate::kernel::{provider::LlmPrompt, vault};
use anyhow::Result;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, Content, Implementation, ServerCapabilities, ServerInfo};
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler};
use serde::Deserialize;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::{info, warn};
use uuid::Uuid;

/// HTTP listen address. Deliberately one port above the ST-SS bridge
/// (17872) so log-readers can eyeball both streams. Loopback only.
pub const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:17873";

/// MCP path mounted on the axum router. The full URL clients see is
/// `http://127.0.0.1:17873/mcp`.
pub const MCP_PATH: &str = "/mcp";

/// Public handle to the running MCP server. Held by KernelSupervisor +
/// returned to PWA via the `mcp_server_info` Tauri command.
#[derive(Clone)]
pub struct McpServerHandle {
    pub auth_token: Arc<String>,
    pub listen_addr: String,
}

impl McpServerHandle {
    /// Public URL clients connect to: `http://127.0.0.1:17873/mcp`.
    pub fn url(&self) -> String {
        format!("http://{}{}", self.listen_addr, MCP_PATH)
    }
}

/// Tool router — every `#[tool]` method below is auto-registered. Holds a
/// strong reference to `KernelRuntime` + the on-disk LocalStorage so tools
/// can call kernel modules without going through Tauri commands.
#[derive(Clone)]
pub struct KernelMcpRouter {
    runtime: Arc<KernelRuntime>,
    local_storage: Option<Arc<LocalStorage>>,
    tool_router: ToolRouter<Self>,
}

// ─── Tool argument structs ──────────────────────────────────────────────
// Each tool's args are a struct deriving Deserialize + JsonSchema so rmcp
// auto-generates the input schema from the type.

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultReadArgs {
    /// Vault-relative path, e.g. `daily/2026-05-22.md`.
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultWriteArgs {
    /// Vault-relative path. Parent dirs are created.
    pub path: String,
    /// Markdown body (without frontmatter; pass frontmatter via `frontmatter`).
    pub body: String,
    /// Optional YAML frontmatter as a JSON object. Empty / absent = no frontmatter.
    #[serde(default)]
    pub frontmatter: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultListArgs {
    /// Optional subdirectory relative to vault root. Absent = list root.
    #[serde(default)]
    pub subdir: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultSearchArgs {
    /// FTS5 query string. Falls back to substring scan when FTS unavailable.
    pub query: String,
    /// Max results. Defaults to 20 if absent.
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct KvGetArgs {
    /// Namespace (typically the keycap id).
    pub namespace: String,
    pub key: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct KvSetArgs {
    pub namespace: String,
    pub key: String,
    /// Arbitrary JSON value.
    pub value: serde_json::Value,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LlmChatArgs {
    /// Chat messages, OpenAI-shape. Roles: user | assistant | system.
    pub messages: Vec<LlmChatMessage>,
    /// Optional model override. Absent = primary adapter's default.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct LlmChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpProxyListArgs {
    /// Server id (as registered in `~/.ctrl/mcp-servers.json`).
    pub server: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct HttpGetArgs {
    /// Full HTTPS URL to fetch.
    pub url: String,
    /// Optional request headers.
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    /// Per-call timeout in milliseconds. Defaults to 30000.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct HttpPostArgs {
    /// Full HTTPS URL to POST to.
    pub url: String,
    /// Request body. Strings sent as-is; JSON values serialized to JSON
    /// with `application/json` Content-Type unless overridden in headers.
    pub body: serde_json::Value,
    /// Optional request headers.
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    /// Per-call timeout in milliseconds. Defaults to 30000.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpProxyCallArgs {
    pub server: String,
    pub tool: String,
    /// Arguments object (JSON). Absent = empty.
    #[serde(default)]
    pub arguments: Option<serde_json::Value>,
}

// ─── Router impl + tools ────────────────────────────────────────────────

#[tool_router]
impl KernelMcpRouter {
    pub fn new(runtime: Arc<KernelRuntime>, local_storage: Option<Arc<LocalStorage>>) -> Self {
        Self {
            runtime,
            local_storage,
            tool_router: Self::tool_router(),
        }
    }

    /// kernel.status — uptime + adapter chain. Sanity ping for clients.
    #[tool(description = "Report kernel health: uptime, registered LLM adapters, MCP server count")]
    async fn kernel_status(&self) -> Result<CallToolResult, McpError> {
        let uptime = self.runtime.booted_at.elapsed();
        let installed = self.runtime.mcp_host.list_installed().await;
        let body = serde_json::json!({
            "uptime_ms": uptime.as_millis() as u64,
            "provider_chain": self.runtime
                .provider_registry
                .list()
                .iter()
                .map(|e| e.id.clone())
                .collect::<Vec<_>>(),
            "mcp_servers_installed": installed.len(),
        });
        Ok(CallToolResult::success(vec![Content::text(body.to_string())]))
    }

    /// vault.read — read a markdown file from the user's vault.
    #[tool(description = "Read a markdown file from the user's vault")]
    async fn vault_read(
        &self,
        Parameters(args): Parameters<VaultReadArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let body = serde_json::to_string(&entry).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.write — write markdown + optional frontmatter to the vault.
    #[tool(description = "Write a markdown file to the user's vault (creates parents)")]
    async fn vault_write(
        &self,
        Parameters(args): Parameters<VaultWriteArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let fm = args.frontmatter.unwrap_or(serde_json::Value::Null);
        vault::write(&root, &args.path, &args.body, &fm).map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "wrote {}",
            args.path
        ))]))
    }

    /// vault.list — list files under a subdir (or vault root).
    #[tool(description = "List markdown files under a vault subdirectory (or vault root)")]
    async fn vault_list(
        &self,
        Parameters(args): Parameters<VaultListArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entries = vault::list(&root, args.subdir.as_deref()).map_err(map_vault_err)?;
        let body = serde_json::to_string(&entries).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.search — FTS5 search across the vault.
    #[tool(description = "Full-text search the vault (FTS5 when available, substring fallback)")]
    async fn vault_search(
        &self,
        Parameters(args): Parameters<VaultSearchArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let limit = args.limit.unwrap_or(20);
        let hits = vault::search(&root, &args.query, limit).map_err(map_vault_err)?;
        let body = serde_json::to_string(&hits).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// kv.get — per-keycap persistent key/value read.
    #[tool(description = "Read a persistent key from per-keycap local storage")]
    async fn kv_get(
        &self,
        Parameters(args): Parameters<KvGetArgs>,
    ) -> Result<CallToolResult, McpError> {
        let ls = self
            .local_storage
            .as_ref()
            .ok_or_else(|| McpError::internal_error("local_storage unavailable", None))?;
        let value = ls
            .get(&args.namespace, &args.key)
            .map_err(|e| McpError::internal_error(format!("kv.get: {e}"), None))?;
        let body =
            serde_json::to_string(&value.unwrap_or(serde_json::Value::Null)).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// kv.set — per-keycap persistent key/value write.
    #[tool(description = "Write a persistent key into per-keycap local storage")]
    async fn kv_set(
        &self,
        Parameters(args): Parameters<KvSetArgs>,
    ) -> Result<CallToolResult, McpError> {
        let ls = self
            .local_storage
            .as_ref()
            .ok_or_else(|| McpError::internal_error("local_storage unavailable", None))?;
        ls.set(&args.namespace, &args.key, &args.value)
            .map_err(|e| McpError::internal_error(format!("kv.set: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "set {}/{}",
            args.namespace, args.key
        ))]))
    }

    /// llm.chat — non-streaming chat completion via kernel's LLM port.
    /// (Streaming variant lives on Tauri's `chat_stream` event channel;
    /// MCP tool surface is non-streaming for now — agents that need
    /// streams should hit the Tauri command directly.)
    #[tool(description = "Run a non-streaming LLM chat completion via the kernel's LLM port")]
    async fn llm_chat(
        &self,
        Parameters(args): Parameters<LlmChatArgs>,
    ) -> Result<CallToolResult, McpError> {
        let adapter = self
            .runtime
            .provider_registry
            .primary_text_chat()
            .ok_or_else(|| McpError::internal_error("no text.chat provider available", None))?;
        let model = args.model.unwrap_or_default();
        let prompt = LlmPrompt {
            system: None,
            messages: args
                .messages
                .into_iter()
                .map(|m| crate::kernel::provider::LlmMessage {
                    role: m.role,
                    content: m.content,
                })
                .collect(),
            temperature: args.temperature,
            max_tokens: args.max_tokens,
        };
        let opts = crate::kernel::provider::ChatOpts {
            model,
            deadline_ms: 60_000,
        };
        // Provider trait is streaming-only; drain to a single string for
        // non-streaming MCP tool surface.
        let mut rx = adapter
            .chat_stream(&prompt, &opts)
            .await
            .map_err(|e| McpError::internal_error(format!("llm.chat: {e}"), None))?;
        let mut out = String::new();
        while let Some(item) = rx.recv().await {
            match item {
                Ok(chunk) => {
                    out.push_str(&chunk.delta);
                    if chunk.finish_reason.is_some() {
                        break;
                    }
                }
                Err(e) => {
                    return Err(McpError::internal_error(
                        format!("llm.chat stream: {e}"),
                        None,
                    ));
                }
            }
        }
        Ok(CallToolResult::success(vec![Content::text(out)]))
    }

    /// mcp.list_servers — enumerate installed external MCP servers
    /// (proxy view onto McpHost's registry).
    #[tool(description = "List external MCP servers the kernel has registered (proxy view)")]
    async fn mcp_list_servers(&self) -> Result<CallToolResult, McpError> {
        let installed = self.runtime.mcp_host.list_installed().await;
        let body = serde_json::to_string(&installed).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// http.get — fetch any HTTPS URL. Base keycap atomic. Used by
    /// composite keycaps that need to read external API data (RSS,
    /// REST, webhook ping). Body returned as a string; caller parses
    /// JSON if applicable.
    #[tool(description = "HTTP GET request — fetch a URL and return status + body + headers")]
    async fn http_get(
        &self,
        Parameters(args): Parameters<HttpGetArgs>,
    ) -> Result<CallToolResult, McpError> {
        let body = http_request(reqwest::Method::GET, args.url, args.headers, None, args.timeout_ms)
            .await?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// http.post — POST to any HTTPS URL. Base keycap atomic. Used by
    /// composite keycaps that need to trigger external workflows
    /// (n8n webhooks, Coze bot API, generic REST POST).
    #[tool(description = "HTTP POST request — send JSON or text body and return status + body + headers")]
    async fn http_post(
        &self,
        Parameters(args): Parameters<HttpPostArgs>,
    ) -> Result<CallToolResult, McpError> {
        let body = http_request(
            reqwest::Method::POST,
            args.url,
            args.headers,
            Some(args.body),
            args.timeout_ms,
        )
        .await?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// mcp.proxy_list_tools — list tools advertised by a downstream MCP
    /// server (the kernel relays the request to that server).
    #[tool(
        description = "List tools advertised by a downstream MCP server (kernel proxies the call)"
    )]
    async fn mcp_proxy_list_tools(
        &self,
        Parameters(args): Parameters<McpProxyListArgs>,
    ) -> Result<CallToolResult, McpError> {
        let tools = self
            .runtime
            .mcp_host
            .list_tools(&args.server)
            .await
            .map_err(|e| McpError::internal_error(format!("mcp.list_tools: {e}"), None))?;
        let body = serde_json::to_string(&tools).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// mcp.proxy_call_tool — invoke a tool on a downstream MCP server.
    #[tool(
        description = "Invoke a tool on a downstream MCP server (kernel proxies the call)"
    )]
    async fn mcp_proxy_call_tool(
        &self,
        Parameters(args): Parameters<McpProxyCallArgs>,
    ) -> Result<CallToolResult, McpError> {
        let arguments = args.arguments.unwrap_or(serde_json::Value::Null);
        let result = self
            .runtime
            .mcp_host
            .invoke(&args.server, &args.tool, arguments)
            .await
            .map_err(|e| McpError::internal_error(format!("mcp.call_tool: {e}"), None))?;
        let body = serde_json::to_string(&result).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }
}

// ServerHandler impl — rmcp uses this for tools/list + tools/call dispatch.
#[tool_handler]
impl ServerHandler for KernelMcpRouter {
    fn get_info(&self) -> ServerInfo {
        // Both `Implementation` and `InitializeResult` are #[non_exhaustive]
        // in rmcp 1.7 — use the typed constructors + field mutation rather
        // than struct literals so future field additions don't break us.
        let mut implementation =
            Implementation::new("ctrl-kernel", env!("CARGO_PKG_VERSION"));
        implementation.title = Some("CTRL Kernel".to_string());
        implementation.website_url = Some("https://github.com/soodooi/CTRL".to_string());

        let mut info = ServerInfo::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = implementation;
        info.instructions = Some(
            "CTRL Kernel MCP server. Exposes vault.*, kv.*, llm.chat, \
             and mcp.proxy_* tools so AI agents (Irisy, brain keycaps, \
             Cursor) can read/write the user's local data and route LLM \
             calls through the kernel."
                .to_string(),
        );
        info
    }
}

// ─── Bind / serve ───────────────────────────────────────────────────────

/// Build the axum router with auth middleware + spawn the listener.
/// Returns the handle holding the ephemeral auth token; the accept loop
/// runs as a tokio task spawned on the current runtime.
pub async fn serve(
    runtime: Arc<KernelRuntime>,
    local_storage: Option<Arc<LocalStorage>>,
    addr: &str,
) -> Result<McpServerHandle> {
    let token = Arc::new(Uuid::new_v4().to_string());
    let token_for_mw = token.clone();

    let router_factory = move || Ok(KernelMcpRouter::new(runtime.clone(), local_storage.clone()));
    let service = StreamableHttpService::new(
        router_factory,
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default(),
    );

    let auth_layer = middleware::from_fn(move |headers: HeaderMap, req: Request<Body>, next: Next| {
        let expected = token_for_mw.clone();
        async move {
            match extract_bearer(&headers) {
                Some(t) if t == expected.as_str() => Ok::<Response, StatusCode>(next.run(req).await),
                _ => Err(StatusCode::UNAUTHORIZED),
            }
        }
    });

    let app = axum::Router::new()
        .nest_service(MCP_PATH, service)
        .layer(auth_layer);

    let listener = TcpListener::bind(addr).await?;
    let listen_addr = listener.local_addr()?.to_string();
    info!("kernel::mcp_server listening on http://{listen_addr}{MCP_PATH}");

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            warn!("kernel::mcp_server axum::serve exited: {e}");
        }
    });

    Ok(McpServerHandle {
        auth_token: token,
        listen_addr,
    })
}

fn extract_bearer(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer ").map(|t| t.to_string()))
}

// ─── Helpers ────────────────────────────────────────────────────────────

fn vault_root() -> Result<std::path::PathBuf, McpError> {
    vault::default_vault_root()
        .ok_or_else(|| McpError::internal_error("vault root unresolved (HOME unset)", None))
}

fn map_vault_err(e: vault::VaultError) -> McpError {
    McpError::internal_error(format!("vault: {e}"), None)
}

fn map_serde_err(e: serde_json::Error) -> McpError {
    McpError::internal_error(format!("serialize: {e}"), None)
}

/// Shared executor for http.get + http.post. Single reqwest::Client
/// per call (cheap; reqwest pools internally). Returns a JSON string
/// that the MCP caller parses: `{ status: u16, body: String, headers: {} }`.
/// Errors map to McpError::internal_error with the underlying message
/// so creator-side debugging is straightforward.
async fn http_request(
    method: reqwest::Method,
    url: String,
    headers: std::collections::BTreeMap<String, String>,
    body: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
) -> Result<String, McpError> {
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(30_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| McpError::internal_error(format!("http client build: {e}"), None))?;
    let mut req = client.request(method, &url);
    let mut content_type_set = false;
    for (k, v) in &headers {
        if k.eq_ignore_ascii_case("content-type") {
            content_type_set = true;
        }
        req = req.header(k, v);
    }
    if let Some(body) = body {
        // String body → text; everything else → JSON. Mirrors what
        // creator-side flow.yaml authors expect ($var of any shape just works).
        match body {
            serde_json::Value::String(s) => {
                req = req.body(s);
            }
            other => {
                if !content_type_set {
                    req = req.header("content-type", "application/json");
                }
                req = req.body(other.to_string());
            }
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| McpError::internal_error(format!("http {url}: {e}"), None))?;
    let status = resp.status().as_u16();
    let resp_headers: std::collections::BTreeMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body_text = resp
        .text()
        .await
        .map_err(|e| McpError::internal_error(format!("http {url} read body: {e}"), None))?;
    let envelope = serde_json::json!({
        "status": status,
        "body": body_text,
        "headers": resp_headers,
    });
    Ok(envelope.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::runtime::KernelRuntime;

    /// Bind to an ephemeral port + assert the auth middleware rejects
    /// unauthenticated requests with 401. Catches port-binding + axum
    /// wiring regressions without exercising the full MCP handshake.
    #[tokio::test]
    async fn unauthorized_request_returns_401() {
        let data_dir = std::env::temp_dir().join("ctrl-test-mcp-401");
        let _ = std::fs::remove_dir_all(&data_dir);
        let runtime = Arc::new(KernelRuntime::boot(data_dir).expect("kernel boot"));
        let handle = serve(runtime, None, "127.0.0.1:0").await.expect("serve");
        let url = handle.url();

        let resp = reqwest::Client::new()
            .post(&url)
            .header("Content-Type", "application/json")
            .body(r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#)
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status().as_u16(), 401, "expected 401 without bearer");
    }

    /// Same setup, with the right bearer token — auth middleware should
    /// pass the request through (we accept any non-401 status; the MCP
    /// initialize handshake's exact response shape isn't this test's
    /// concern).
    #[tokio::test]
    async fn bearer_token_passes_auth_middleware() {
        let data_dir = std::env::temp_dir().join("ctrl-test-mcp-ok");
        let _ = std::fs::remove_dir_all(&data_dir);
        let runtime = Arc::new(KernelRuntime::boot(data_dir).expect("kernel boot"));
        let handle = serve(runtime, None, "127.0.0.1:0").await.expect("serve");
        let url = handle.url();
        let token = handle.auth_token.as_ref().clone();

        let resp = reqwest::Client::new()
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("Authorization", format!("Bearer {token}"))
            .body(
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}"#,
            )
            .send()
            .await
            .expect("request");
        assert_ne!(
            resp.status().as_u16(),
            401,
            "valid bearer should not be rejected (got {})",
            resp.status()
        );
    }
}
