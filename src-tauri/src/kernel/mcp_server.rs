// kernel::mcp_server — Kernel-as-MCP-server (per memory
// `decision_kernel_is_mcp_server_for_irisy`, ADR-002 substrate § mcp-bus v1).
//
// Exposes the kernel's capability surface as MCP tools so that:
//   • Irisy (in-process via Tauri WebView)
//   • Brain mcps (e.g. @ctrl/pi-plugin, separate MCP server process)
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
//   • Bind 0.0.0.0 / accept LAN clients (mesh covered by ADR-002 substrate)
//   • Issue long-lived tokens (each kernel boot = new token; the in-process
//     PWA and brain mcps both fetch fresh via Tauri commands)
//   • Implement business logic — every tool is a thin call into existing
//     kernel modules (vault, local_storage, llm_port, mcp_host) so tests
//     stay against those modules, not the MCP envelope.

use crate::kernel::local_storage::LocalStorage;
use crate::kernel::runtime::KernelRuntime;
use crate::kernel::{provider::LlmPrompt, query, vault, vault_notes_source, vault_smart_table};
use anyhow::Result;
use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::tool::ToolCallContext;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities, ServerInfo,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{tool, tool_router, ErrorData as McpError, RoleServer, ServerHandler};
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

/// smart_table.query — a structured read over a smart-table RecordSource
/// (ADR-002 §14 / ADR-003 §6.5). Fill the parameter object; do NOT write a
/// query string. Call `smart_table.describe` first to learn the valid fields.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableQueryArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Field filters, ANDed together. Each `field` must exist in the schema.
    #[serde(default)]
    pub filters: Vec<query::Filter>,
    /// Multi-key sort (first key wins).
    #[serde(default)]
    pub sort: Vec<query::SortKey>,
    /// Group rows so equal values of this field are contiguous.
    #[serde(default)]
    pub group_by: Option<String>,
    /// Cap the number of returned rows (match_count is reported pre-limit).
    #[serde(default)]
    pub limit: Option<usize>,
}

/// smart_table.update_cell — produce/write one cell (ADR-002 §14 produce verb).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableUpdateCellArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Zero-based row index.
    pub row_index: usize,
    /// Schema field key to set.
    pub field: String,
    /// New cell value (stored as plain text).
    pub value: String,
}

/// smart_table.append_row — produce/write a new row (ADR-002 §14 produce verb).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableAppendRowArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Cell values keyed by schema field key; missing keys become empty.
    pub values: std::collections::BTreeMap<String, String>,
}

/// notes.query — a structured read over the knowledge base as a RecordSource
/// (ADR-002 §14: the SAME query contract as smart-table). Fields are
/// path/title/tags/created/modified — call `notes.describe` for the set.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NotesQueryArgs {
    /// Optional vault subdir to scope the scan (omit for the whole vault).
    #[serde(default)]
    pub subdir: Option<String>,
    #[serde(default)]
    pub filters: Vec<query::Filter>,
    #[serde(default)]
    pub sort: Vec<query::SortKey>,
    #[serde(default)]
    pub group_by: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
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

// ADR-002 substrate § vault v1 §8.3 (2026-06-01) — 13 new vault MCP tools
// (memory `decision_vault_adr_002_section_8`). Daily Note + Sourcing
// stay above this surface — they compose from vault.* primitives at
// the feature layer.

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultPathArgs {
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultTagArgs {
    pub tag: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultMentionArgs {
    pub text: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultMoveArgs {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultStarredArgs {
    pub path: String,
    pub starred: bool,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultSourcingRunMcpArgs {
    /// Date in `YYYY-MM-DD` form (caller's local timezone).
    pub date: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultWatchArgs {
    /// Vault-relative prefix filter, e.g. `sourcing/`. Empty = all.
    #[serde(default)]
    pub prefix: Option<String>,
    /// Unix epoch milliseconds cursor. Caller persists the last
    /// `ts_ms` it saw and passes it back on the next poll.
    pub since_ms: i64,
}

// SOUL.md write args (ADR-005 v2 § soul-md-compat §4.4)
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct IrisySoulSetArgs {
    /// Frontmatter as a JSON object (gets serialised to YAML on disk).
    pub frontmatter: serde_json::Value,
    /// Markdown body after the frontmatter fence.
    pub body: String,
}

// Vault embeddings args (ADR-002 v5 §10.4)
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultEmbedNoteArgs {
    pub path: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultReembedAllArgs {
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultSemanticSearchArgs {
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub threshold: Option<f32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultSuggestLinksArgs {
    pub for_path: String,
    #[serde(default)]
    pub limit: Option<usize>,
}

// ─── 5 NEW MCP tools (bao 2026-06-03 — close Irisy capability gap) ──────
// Mirror the Tauri-only commands `vault_root_path` / `vault_delete` /
// `vault_write_image` / `vault_rebuild_index` / `vault_sourcing_pending`
// so external agents (Cursor, Claude Code via :17873 bus) get the same
// surface PWA does. See ADR-002 substrate § vault v1 §8.3.

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultWriteImageArgs {
    /// Vault-relative path for the binary asset (e.g.
    /// `assets/images/2026-06-03/screenshot.png`).
    pub path: String,
    /// Base64-encoded image bytes.
    pub data_base64: String,
    /// Optional companion sidecar markdown (e.g. prompt / source URL).
    /// When present, written alongside as `<path>.md` with frontmatter
    /// (matching the kernel's `write_binary` + sidecar contract).
    #[serde(default)]
    pub sidecar_markdown: Option<String>,
    #[serde(default)]
    pub sidecar_frontmatter: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct KvGetArgs {
    /// Namespace (typically the mcp id).
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

    /// smart_table.describe — the type layer (ADR-002 §14). Returns the table's
    /// fields, types, and supported query operators. Irisy reads this BEFORE
    /// querying so it only references valid fields.
    #[tool(
        description = "Describe a smart table: its fields, types, and supported query operators. Call this before smart_table.query."
    )]
    async fn smart_table_describe(
        &self,
        Parameters(args): Parameters<VaultReadArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        use query::QuerySource;
        let body = serde_json::to_string(&table.describe()).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// smart_table.query — the read half of the Unified Operation Interface
    /// (ADR-002 §14 / ADR-003 §6.5). Structured filter/sort/group over a
    /// smart-table RecordSource via the shared kernel query engine.
    #[tool(
        description = "Query a smart table with a structured filter/sort/group request (not a query string). Call smart_table.describe first to learn valid fields."
    )]
    async fn smart_table_query(
        &self,
        Parameters(args): Parameters<SmartTableQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        let req = query::QueryRequest {
            filters: args.filters,
            sort: args.sort,
            group_by: args.group_by,
            limit: args.limit,
        };
        let now = chrono::Local::now().date_naive();
        use query::QuerySource;
        let result = table
            .query(&req, now)
            .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
        let body = serde_json::to_string(&result).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// smart_table.update_cell — the produce/write verb (ADR-002 §14). Reads
    /// fresh, sets one cell, re-serializes, writes back (frontmatter/schema
    /// preserved). Review-gating of produce ops is the ADR-006 §4 future
    /// (parity with `vault.write` today).
    #[tool(
        description = "Set one cell of a smart table by row index + field key, then write it back."
    )]
    async fn smart_table_update_cell(
        &self,
        Parameters(args): Parameters<SmartTableUpdateCellArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        if !table.update_cell(args.row_index, &args.field, &args.value) {
            return Err(McpError::invalid_params(
                format!(
                    "update_cell rejected: row {} / field '{}' out of range",
                    args.row_index, args.field
                ),
                None,
            ));
        }
        let new_body = table.serialize_body();
        vault::write(&root, &args.path, &new_body, &entry.frontmatter).map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "updated {} row {} field {}",
            args.path, args.row_index, args.field
        ))]))
    }

    /// smart_table.append_row — the produce/write verb (ADR-002 §14). Reads
    /// fresh, appends a row, re-serializes, writes back.
    #[tool(description = "Append a row to a smart table (values keyed by field key).")]
    async fn smart_table_append_row(
        &self,
        Parameters(args): Parameters<SmartTableAppendRowArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        table.append_row(args.values.into_iter().collect());
        let new_body = table.serialize_body();
        vault::write(&root, &args.path, &new_body, &entry.frontmatter).map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "appended row to {}",
            args.path
        ))]))
    }

    /// notes.describe — the knowledge base's type layer (ADR-002 §14). Same
    /// `describe` verb as smart-table: the KB is just another RecordSource.
    #[tool(
        description = "Describe the knowledge base as a queryable RecordSource: fields (path/title/tags/created/modified) and supported operators. Call before notes.query."
    )]
    async fn notes_describe(&self) -> Result<CallToolResult, McpError> {
        let desc = query::Describe {
            source_kind: query::SourceKind::Record,
            fields: vault_notes_source::NotesSource::fields(),
            operators: {
                use query::Operator::*;
                vec![Eq, Neq, Contains, Before, After, Within, HasTag]
            },
        };
        let body = serde_json::to_string(&desc).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// notes.query — structured read over the KB metadata (ADR-002 §14), routed
    /// through the shared kernel query engine — identical contract to
    /// `smart_table.query`, different RecordSource.
    #[tool(
        description = "Query the knowledge base by tag/title/date with a structured filter/sort/group request (not a query string). Returns matching notes. Call notes.describe first."
    )]
    async fn notes_query(
        &self,
        Parameters(args): Parameters<NotesQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let source = vault_notes_source::NotesSource::load(&root, args.subdir.as_deref())
            .map_err(map_vault_err)?;
        let req = query::QueryRequest {
            filters: args.filters,
            sort: args.sort,
            group_by: args.group_by,
            limit: args.limit,
        };
        let now = chrono::Local::now().date_naive();
        use query::QuerySource;
        let result = source
            .query(&req, now)
            .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
        let body = serde_json::to_string(&result).map_err(map_serde_err)?;
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

    /// vault.backlinks — every note linking to `path` + snippet preview.
    #[tool(description = "Backlinks for a vault note (paths + snippets)")]
    async fn vault_backlinks(
        &self,
        Parameters(args): Parameters<VaultPathArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let g = crate::kernel::vault_graph::scan(&root)
            .map_err(|e| McpError::internal_error(format!("vault.backlinks: {e}"), None))?;
        let body = serde_json::to_string(&g.backlinks_of(&args.path)).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.tags — all tags with counts, frequency-sorted.
    #[tool(description = "List every tag in the vault with usage count (descending)")]
    async fn vault_tags(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let g = crate::kernel::vault_graph::scan(&root)
            .map_err(|e| McpError::internal_error(format!("vault.tags: {e}"), None))?;
        let body = serde_json::to_string(&g.tags()).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.notes_by_tag — every note bearing the given tag.
    #[tool(description = "List notes tagged with a specific tag")]
    async fn vault_notes_by_tag(
        &self,
        Parameters(args): Parameters<VaultTagArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let g = crate::kernel::vault_graph::scan(&root)
            .map_err(|e| McpError::internal_error(format!("vault.notes_by_tag: {e}"), None))?;
        let body = serde_json::to_string(&g.notes_by_tag(&args.tag)).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.mentions — substring matches across body, excluding linked
    /// occurrences (the unlinked-mention view).
    #[tool(description = "Find unlinked mentions of text across the vault (excludes [[wikilinked]] hits)")]
    async fn vault_mentions(
        &self,
        Parameters(args): Parameters<VaultMentionArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let g = crate::kernel::vault_graph::scan(&root)
            .map_err(|e| McpError::internal_error(format!("vault.mentions: {e}"), None))?;
        let body = serde_json::to_string(&g.mentions_of(&args.text)).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.orphans — notes without inbound links. Sourcing routine
    /// surfaces these for user review.
    #[tool(description = "List vault notes that no other note links to")]
    async fn vault_orphans(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let g = crate::kernel::vault_graph::scan(&root)
            .map_err(|e| McpError::internal_error(format!("vault.orphans: {e}"), None))?;
        let body = serde_json::to_string(&g.orphans()).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.broken_links — outgoing links that resolve to no vault note.
    #[tool(description = "List vault outgoing links that point at no existing note (broken links)")]
    async fn vault_broken_links(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let g = crate::kernel::vault_graph::scan(&root)
            .map_err(|e| McpError::internal_error(format!("vault.broken_links: {e}"), None))?;
        let body = serde_json::to_string(&g.broken_links()).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.graph_data — full node + edge set for graph-view UIs.
    #[tool(description = "Return the entire vault link graph (nodes + edges)")]
    async fn vault_graph_data(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let g = crate::kernel::vault_graph::scan(&root)
            .map_err(|e| McpError::internal_error(format!("vault.graph_data: {e}"), None))?;
        let body = serde_json::to_string(&g.graph_data()).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.rename — same-folder rename (kernel doesn't rewrite inbound
    /// wikilinks; caller follows with backlinks + chained writes).
    #[tool(description = "Rename a vault note to a new path (no inbound-link rewrite)")]
    async fn vault_rename(
        &self,
        Parameters(args): Parameters<VaultMoveArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.from).map_err(map_vault_err)?;
        vault::write(&root, &args.to, &entry.content, &entry.frontmatter)
            .map_err(map_vault_err)?;
        vault::delete(&root, &args.from).map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "renamed {} -> {}",
            args.from, args.to
        ))]))
    }

    /// vault.move — alias of vault.rename. Surfaced separately so the
    /// Sourcing routine can call `vault.move(sourcing/X, notes/Y)` with
    /// the verb that matches its intent.
    #[tool(description = "Move a vault note to a new path (alias of vault.rename)")]
    async fn vault_move(
        &self,
        Parameters(args): Parameters<VaultMoveArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.from).map_err(map_vault_err)?;
        vault::write(&root, &args.to, &entry.content, &entry.frontmatter)
            .map_err(map_vault_err)?;
        vault::delete(&root, &args.from).map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "moved {} -> {}",
            args.from, args.to
        ))]))
    }

    /// vault.create_folder — `mkdir -p` semantics under the vault root.
    #[tool(description = "Create a vault subdirectory (mkdir -p semantics)")]
    async fn vault_create_folder(
        &self,
        Parameters(args): Parameters<VaultPathArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let safe = vault::sanitize_relative_path(&args.path).map_err(map_vault_err)?;
        std::fs::create_dir_all(root.join(&safe))
            .map_err(|e| McpError::internal_error(format!("create_folder: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "created {}",
            args.path
        ))]))
    }

    /// vault.set_starred — toggle frontmatter `starred:` scalar.
    #[tool(description = "Toggle the starred flag on a vault note's frontmatter")]
    async fn vault_set_starred(
        &self,
        Parameters(args): Parameters<VaultStarredArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut fm = entry.frontmatter;
        if let serde_json::Value::Object(ref mut map) = fm {
            map.insert("starred".to_string(), serde_json::Value::Bool(args.starred));
        } else {
            fm = serde_json::json!({ "starred": args.starred });
        }
        vault::write(&root, &args.path, &entry.content, &fm).map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "set starred={} on {}",
            args.starred, args.path
        ))]))
    }

    /// vault.aliases — frontmatter `aliases:` list for a note.
    #[tool(description = "Read the frontmatter aliases list for a vault note")]
    async fn vault_aliases(
        &self,
        Parameters(args): Parameters<VaultPathArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let list: Vec<String> = entry
            .frontmatter
            .get("aliases")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        let body = serde_json::to_string(&list).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.watch — drain filesystem events since `since_ms`. Lazy-
    /// starts the watcher on first call so external MCP clients don't
    /// need a separate setup step.
    #[tool(description = "Drain recent vault filesystem events since a millis cursor (lazy-starts watcher)")]
    async fn vault_watch(
        &self,
        Parameters(args): Parameters<VaultWatchArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        if let Err(e) = crate::kernel::vault_watch::start(&root) {
            tracing::warn!(error = %e, "vault.watch: start failed");
        }
        let events = crate::kernel::vault_watch::recent(args.prefix.as_deref(), args.since_ms);
        let body = serde_json::to_string(&events).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.sourcing_run — run the kernel-seeded sourcing routine for
    /// `date` (YYYY-MM-DD) and overwrite the matching review-queue
    /// file. Idempotent.
    #[tool(description = "Run the kernel sourcing routine for the given YYYY-MM-DD date and write the review-queue file")]
    async fn vault_sourcing_run(
        &self,
        Parameters(args): Parameters<VaultSourcingRunMcpArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let report = crate::kernel::vault_sourcing::run(&root, &args.date)
            .map_err(|e| McpError::internal_error(format!("vault.sourcing_run: {e}"), None))?;
        let body = serde_json::to_string(&report).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// kv.get — per-mcp persistent key/value read.
    #[tool(description = "Read a persistent key from per-mcp local storage")]
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

    /// kv.set — per-mcp persistent key/value write.
    #[tool(description = "Write a persistent key into per-mcp local storage")]
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
        // Redact downstream auth headers — a connected server's credential must
        // never be handed to an MCP client (ADR-006 cross-cutting § policy v1,
        // secrets never leak). The gate proxies auth on the client's behalf.
        let redacted: Vec<serde_json::Value> = installed
            .iter()
            .map(|d| {
                let mut v = serde_json::to_value(d).unwrap_or(serde_json::Value::Null);
                if let Some(src) = v.get_mut("source").and_then(|s| s.as_object_mut()) {
                    if src.contains_key("auth_header") {
                        src.insert(
                            "auth_header".to_string(),
                            serde_json::Value::String("<redacted>".to_string()),
                        );
                    }
                }
                v
            })
            .collect();
        let body = serde_json::to_string(&redacted).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// http.get — fetch any HTTPS URL. Base mcp atomic. Used by
    /// composite mcps that need to read external API data (RSS,
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

    /// http.post — POST to any HTTPS URL. Base mcp atomic. Used by
    /// composite mcps that need to trigger external workflows
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

    // ─── 5 NEW vault MCP tools (bao 2026-06-03) ─────────────────────────
    // Close the Tauri vs MCP capability gap so Irisy via :17873 has the
    // same surface as the PWA via Tauri invoke().

    /// vault.root_path — return the absolute vault root path on disk.
    /// Used by external agents that need to drop files via the FS or
    /// reason about absolute paths.
    #[tool(description = "Return the absolute vault root path on disk")]
    async fn vault_root_path(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        Ok(CallToolResult::success(vec![Content::text(
            root.display().to_string(),
        )]))
    }

    /// vault.delete — remove a vault note.
    #[tool(description = "Delete a vault note (the file is removed; no soft-delete)")]
    async fn vault_delete(
        &self,
        Parameters(args): Parameters<VaultPathArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        vault::delete(&root, &args.path).map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "deleted {}",
            args.path
        ))]))
    }

    /// vault.rebuild_index — drop + repopulate the FTS5 index from
    /// on-disk truth. Returns the indexed-file count. Slow on big
    /// vaults; bao 2026-06-03 — exposed so creators have a recovery
    /// path if the index ever drifts.
    #[tool(description = "Rebuild the FTS5 vault search index from disk (returns indexed file count)")]
    async fn vault_rebuild_index(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let count = vault::rebuild_index(&root)
            .map_err(|e| McpError::internal_error(format!("vault: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "indexed {} files",
            count
        ))]))
    }

    /// vault.write_image — drop a binary asset (typically an
    /// AI-generated image) into the vault, optionally with a sidecar
    /// markdown carrying the generation prompt + provider so the FTS
    /// index can surface it later.
    #[tool(description = "Write a binary image asset to the vault (optionally with sidecar .md frontmatter)")]
    async fn vault_write_image(
        &self,
        Parameters(args): Parameters<VaultWriteImageArgs>,
    ) -> Result<CallToolResult, McpError> {
        use base64::{engine::general_purpose::STANDARD as B64, Engine};
        let bytes = B64
            .decode(args.data_base64.as_bytes())
            .map_err(|e| McpError::internal_error(format!("base64: {e}"), None))?;
        let root = vault_root()?;
        let abs = vault::write_binary(&root, &args.path, &bytes).map_err(map_vault_err)?;
        // Sidecar — only when caller supplied markdown. Path is the
        // image path with its extension swapped for `.md` (matches the
        // Tauri command's convention; keeps both surfaces consistent).
        if let Some(md) = args.sidecar_markdown {
            let sidecar_path = {
                let p = std::path::Path::new(&args.path);
                let stem = p.with_extension("md");
                stem.to_string_lossy().to_string()
            };
            let fm = args.sidecar_frontmatter.unwrap_or_else(|| serde_json::json!({}));
            vault::write(&root, &sidecar_path, &md, &fm).map_err(map_vault_err)?;
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "wrote {} ({} bytes)",
            abs.display(),
            bytes.len()
        ))]))
    }

    /// vault.sourcing_pending — count of un-integrated items in the
    /// sourcing inbox. Used by Irisy + UI to decide whether to nudge
    /// the user toward Review.
    #[tool(description = "Count un-integrated items in the sourcing inbox")]
    async fn vault_sourcing_pending(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let count = crate::kernel::vault_sourcing::count_pending(&root);
        Ok(CallToolResult::success(vec![Content::text(format!(
            "{{\"count\": {}}}",
            count
        ))]))
    }

    // ── SOUL.md (ADR-005 irisy v2 § soul-md-compat §4.4) ───────────────
    // External agents (Cursor / Claude Code / OpenClaw companions) read
    // and write CTRL's Irisy soul through these MCP tools. Same surface
    // PWA gets via Tauri commands.

    /// irisy.soul_get — return vault/irisy/SOUL.md as `{frontmatter, body, soul_md_version}`.
    #[tool(description = "Read the Irisy SOUL.md persistent memory (vault/irisy/SOUL.md)")]
    async fn irisy_soul_get(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, "irisy/SOUL.md").map_err(map_vault_err)?;
        let pin = std::fs::read_to_string(root.join("irisy/.soul-md-version"))
            .unwrap_or_default()
            .trim()
            .to_string();
        let payload = serde_json::json!({
            "path": entry.path,
            "frontmatter": entry.frontmatter,
            "body": entry.content,
            "soul_md_version": pin,
        });
        let body = serde_json::to_string(&payload).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// irisy.soul_set — replace vault/irisy/SOUL.md with `{frontmatter, body}`.
    /// External mutation goes through here so Irisy can surface a notify
    /// event ("Cursor just rewrote your soul — review?").
    #[tool(description = "Write the Irisy SOUL.md persistent memory")]
    async fn irisy_soul_set(
        &self,
        Parameters(args): Parameters<IrisySoulSetArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        vault::write(&root, "irisy/SOUL.md", &args.body, &args.frontmatter)
            .map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(
            String::from("irisy/SOUL.md updated"),
        )]))
    }

    // ── 5 NEW Vault embeddings MCP tools (ADR-002 v5 §10.4, 2026-06-03) ────

    /// vault.embed_note — embed a single note (idempotent via content_hash).
    #[tool(description = "Embed a single vault note into the local embeddings index")]
    async fn vault_embed_note(
        &self,
        Parameters(args): Parameters<VaultEmbedNoteArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let hash = crate::kernel::vault_embeddings::content_hash(&entry.content);
        let emb = open_embed_db()?;
        if let Some((_m, cached_hash)) = emb
            .cached_meta(&args.path)
            .map_err(|e| McpError::internal_error(format!("embed cache: {e}"), None))?
        {
            if cached_hash == hash {
                return Ok(CallToolResult::success(vec![Content::text(format!(
                    "{{\"path\":{:?},\"vector_dims\":768,\"cached\":true}}",
                    args.path
                ))]));
            }
        }
        let client = crate::kernel::provider::ollama_embed::OllamaEmbedClient::new();
        let vec = client
            .embed(&entry.content)
            .await
            .map_err(|e| McpError::internal_error(format!("ollama: {e}"), None))?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        emb.upsert(&args.path, now_ms, &hash, &vec)
            .map_err(|e| McpError::internal_error(format!("embed upsert: {e}"), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "{{\"path\":{:?},\"vector_dims\":{},\"cached\":false}}",
            args.path,
            vec.len()
        ))]))
    }

    /// vault.reembed_all — bulk re-embed. Respects `force`.
    #[tool(description = "Re-embed all vault notes (bulk; respects content_hash unless force=true)")]
    async fn vault_reembed_all(
        &self,
        Parameters(args): Parameters<VaultReembedAllArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let paths = vault::list(&root, None).map_err(map_vault_err)?;
        let emb = open_embed_db()?;
        let client = crate::kernel::provider::ollama_embed::OllamaEmbedClient::new();
        let mut embedded = 0usize;
        let mut skipped = 0usize;
        let mut failed = 0usize;
        for p in paths {
            let entry = match vault::read(&root, &p) {
                Ok(e) => e,
                Err(_) => {
                    failed += 1;
                    continue;
                }
            };
            let hash = crate::kernel::vault_embeddings::content_hash(&entry.content);
            if !args.force {
                if let Ok(Some((_m, cached))) = emb.cached_meta(&p) {
                    if cached == hash {
                        skipped += 1;
                        continue;
                    }
                }
            }
            match client.embed(&entry.content).await {
                Ok(vec) => {
                    let now_ms = chrono::Utc::now().timestamp_millis();
                    if emb.upsert(&p, now_ms, &hash, &vec).is_ok() {
                        embedded += 1;
                    } else {
                        failed += 1;
                    }
                }
                Err(_) => failed += 1,
            }
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "{{\"embedded\":{},\"skipped\":{},\"failed\":{}}}",
            embedded, skipped, failed
        ))]))
    }

    /// vault.embedding_status — snapshot of the index.
    #[tool(description = "Snapshot of the vault embedding index (available / total / embedded / stale)")]
    async fn vault_embedding_status(&self) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let total = vault::list(&root, None).map(|v| v.len()).unwrap_or(0);
        let client = crate::kernel::provider::ollama_embed::OllamaEmbedClient::new();
        let provider_status = match client.probe().await {
            Ok(_) => "available",
            Err(_) => "unreachable",
        };
        let emb = open_embed_db()?;
        let status = emb
            .status(total, provider_status)
            .map_err(|e| McpError::internal_error(format!("embed status: {e}"), None))?;
        let body = serde_json::to_string(&status).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.semantic_search — cosine-similarity search for the query string.
    #[tool(description = "Semantic-similarity vault search (cosine over local embeddings)")]
    async fn vault_semantic_search(
        &self,
        Parameters(args): Parameters<VaultSemanticSearchArgs>,
    ) -> Result<CallToolResult, McpError> {
        let client = crate::kernel::provider::ollama_embed::OllamaEmbedClient::new();
        let q = client
            .embed(&args.query)
            .await
            .map_err(|e| McpError::internal_error(format!("ollama: {e}"), None))?;
        let emb = open_embed_db()?;
        let hits = emb
            .search(&q, args.limit.unwrap_or(10), args.threshold)
            .map_err(|e| McpError::internal_error(format!("embed search: {e}"), None))?;
        let body = serde_json::to_string(&hits).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault.suggest_links — find notes similar to a source path (autolink).
    #[tool(description = "Suggest related notes for a given path (embeddings-based autolink)")]
    async fn vault_suggest_links(
        &self,
        Parameters(args): Parameters<VaultSuggestLinksArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.for_path).map_err(map_vault_err)?;
        let client = crate::kernel::provider::ollama_embed::OllamaEmbedClient::new();
        let v = client
            .embed(&entry.content)
            .await
            .map_err(|e| McpError::internal_error(format!("ollama: {e}"), None))?;
        let emb = open_embed_db()?;
        let mut hits = emb
            .search(&v, args.limit.unwrap_or(5) + 1, None)
            .map_err(|e| McpError::internal_error(format!("embed search: {e}"), None))?;
        hits.retain(|h| h.path != args.for_path);
        hits.truncate(args.limit.unwrap_or(5));
        let body = serde_json::to_string(&hits).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }
}

// Helper — open the embeddings DB at the standard path.
fn open_embed_db() -> Result<crate::kernel::vault_embeddings::VaultEmbeddings, McpError> {
    let home = std::env::var("HOME")
        .map_err(|_| McpError::internal_error("HOME env var not set", None))?;
    let path = std::path::PathBuf::from(home).join(".ctrl/embeddings.db");
    crate::kernel::vault_embeddings::VaultEmbeddings::open(&path, "nomic-embed-text")
        .map_err(|e| McpError::internal_error(format!("embed open: {e}"), None))
}

// ServerHandler impl — rmcp uses this for tools/list + tools/call dispatch.
// NOTE: `#[tool_handler]` intentionally NOT used. We hand-write list_tools +
// call_tool so the kernel's static tools (#[tool_router]) are MERGED with the
// downstream MCP servers' tools, surfaced as first-class namespaced
// `<server>_<tool>` entries (ADR-002 substrate §1.9.1). This is why Irisy/hermes
// see e.g. Obsidian's tools directly instead of only behind mcp_proxy_*.
impl ServerHandler for KernelMcpRouter {
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        // Static kernel tools first.
        let mut tools = self.tool_router.list_all();
        // Then aggregate each connected downstream server's tools, namespaced
        // so names never collide and call_tool can route them back (§1.9.1).
        for desc in self.runtime.mcp_host.list_installed().await {
            match self.runtime.mcp_host.list_tools(&desc.id).await {
                Ok(downstream) => {
                    for mut t in downstream {
                        t.name = format!("{}_{}", desc.id, t.name).into();
                        tools.push(t);
                    }
                }
                Err(e) => {
                    tracing::debug!(server = %desc.id, error = %e, "list_tools: downstream unavailable, skip")
                }
            }
        }
        Ok(ListToolsResult {
            tools,
            next_cursor: None,
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        // Route a namespaced downstream call `<server>_<tool>` to mcp_host;
        // otherwise fall through to the static kernel tool router (§1.9.1).
        for desc in self.runtime.mcp_host.list_installed().await {
            let prefix = format!("{}_", desc.id);
            if let Some(tool) = request.name.as_ref().strip_prefix(&prefix) {
                let tool = tool.to_string();
                let args = request
                    .arguments
                    .clone()
                    .map(serde_json::Value::Object)
                    .unwrap_or(serde_json::Value::Null);
                let result = self
                    .runtime
                    .mcp_host
                    .invoke(&desc.id, &tool, args)
                    .await
                    .map_err(|e| {
                        McpError::internal_error(format!("downstream {}: {e}", desc.id), None)
                    })?;
                let body = serde_json::to_string(&result).map_err(map_serde_err)?;
                return Ok(CallToolResult::success(vec![Content::text(body)]));
            }
        }
        let tcc = ToolCallContext::new(self, request, context);
        self.tool_router.call(tcc).await
    }

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
             and mcp.proxy_* tools so AI agents (Irisy, brain mcps, \
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
