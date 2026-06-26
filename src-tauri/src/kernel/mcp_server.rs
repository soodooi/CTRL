// kernel::mcp_server — Kernel-as-MCP-server (per memory
// `decision_kernel_is_mcp_server_for_irisy`, ADR-002 substrate § mcp-bus v1).
//
// Exposes the kernel's capability surface as MCP tools so that:
//   • Irisy (in-process via Tauri WebView)
//   • Brain mcps (e.g. the hermes agent gateway, separate MCP server process)
//   • External AI agents on the user's machine (Cursor, etc.)
// all consume the same backend through a single MCP wire — tools/list +
// tools/call instead of N bespoke RPC surfaces.
//
// Transport: streamable-http (replaces the deprecated SSE transport in the
// MCP 2025-03-26 spec). Bound to 127.0.0.1:17873, never exposed beyond
// loopback. Auth = Bearer <ephemeral token>, generated fresh per kernel
// boot — same model as `event_ws` (never persisted to disk).
//
// What this module does NOT do:
//   • Bind 0.0.0.0 / accept LAN clients (mesh covered by ADR-002 substrate)
//   • Issue long-lived tokens (each kernel boot = new token; the in-process
//     PWA and brain mcps both fetch fresh via Tauri commands)
//   • Implement business logic — every tool is a thin call into existing
//     kernel modules (vault, local_storage, llm_port, mcp_host) so tests
//     stay against those modules, not the MCP envelope.

use crate::kernel::audit;
use crate::kernel::local_storage::LocalStorage;
use crate::kernel::visibility::{self, Intent};
use crate::kernel::runtime::KernelRuntime;
use crate::kernel::{
    ai_column, provider::LlmPrompt, query, runtime_sources, smart_table_index, vault,
    vault_notes_source, vault_smart_table,
};
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

/// HTTP listen address. Deliberately one port above the event-stream bridge
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
    /// In-flight AI-column jobs (ADR-003 §6.5.4 async run_ai_column).
    ai_jobs: ai_column::JobRegistry,
    /// Per-vault-path async write locks. Produce verbs hold the matching path
    /// lock across their whole read-modify-write so concurrent writers
    /// serialize instead of clobbering each other (full-review P0 lost-update
    /// fix, 2026-06-21).
    vault_write_locks: VaultWriteLocks,
    /// Smart-table SQLite derived index (ADR-002 §14 v30 route C). A pure
    /// accelerator: large-table reads route through it, produce writes refresh
    /// it. None when the db can't open — every read falls back to the in-memory
    /// engine, so the gate works with or without it (markdown is the truth).
    st_index: Option<Arc<smart_table_index::SmartTableIndex>>,
}

/// Registry of per-path write locks (lazily created). The outer mutex guards
/// the map; each inner mutex serializes produce on one vault path.
type VaultWriteLocks =
    Arc<tokio::sync::Mutex<std::collections::HashMap<String, Arc<tokio::sync::Mutex<()>>>>>;

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
    /// Field filters, combined per `conjunction`. Each `field` must exist.
    #[serde(default)]
    pub filters: Vec<query::Filter>,
    /// How filters combine: `and` (default) or `or`.
    #[serde(default)]
    pub conjunction: query::Conjunction,
    /// Multi-key sort (first key wins).
    #[serde(default)]
    pub sort: Vec<query::SortKey>,
    /// Group keys applied in order (first is the primary level); equal-valued
    /// rows are made contiguous. Empty = no grouping.
    #[serde(default)]
    pub group_by: Vec<String>,
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

/// smart_table.run_ai_column — the AI field shortcut (ADR-003 §6.5.4): run an
/// LLM per row down a target column. Cost-gated at 100 rows.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableRunAiColumnArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Schema field key whose cells the AI fills.
    pub target_field: String,
    /// Prompt template; use `{field}` tokens to reference other columns.
    pub prompt: String,
    /// The AI operation: classify / extract / summarize / translate / generate.
    pub op: ai_column::AiOp,
    /// Re-run rows whose target cell is already filled (default false = resume).
    #[serde(default)]
    pub force: bool,
    /// Confirm a run over the 100-row cost gate.
    #[serde(default)]
    pub confirm_over_gate: bool,
}

/// A smart-table view kind (ADR-003 §6.2) — a fixed enum (table-independent).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ViewKind {
    Grid,
    Kanban,
}

/// smart_table.add_view — persist a view (grid/kanban) into frontmatter `views`
/// (ADR-003 §6.2: view state is NOT data; it lives in frontmatter, never the
/// table body).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableAddViewArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// View kind. `kanban` requires `group_by`.
    pub kind: ViewKind,
    /// Field key to group/columnize by (required for kanban).
    #[serde(default)]
    pub group_by: Option<String>,
}

/// registry.query / providers.query — a structured read over a runtime
/// RecordSource (ADR-002 §14: same query contract, no vault path).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RuntimeQueryArgs {
    #[serde(default)]
    pub filters: Vec<query::Filter>,
    /// How filters combine: `and` (default) or `or`.
    #[serde(default)]
    pub conjunction: query::Conjunction,
    #[serde(default)]
    pub sort: Vec<query::SortKey>,
    /// Group keys applied in order; empty = no grouping.
    #[serde(default)]
    pub group_by: Vec<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Reference an in-flight AI-column job by id (status / cancel).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct JobIdArgs {
    pub job_id: String,
}

/// vault_text.query args — the §14 Text profile of the vault (ADR-002 §14
/// TextSource). Only a `Contains` filter (the full-text needle) + `limit` are
/// meaningful; `describe` advertises exactly that.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct VaultTextQueryArgs {
    #[serde(default)]
    pub filters: Vec<query::Filter>,
    #[serde(default)]
    pub limit: Option<usize>,
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
    /// How filters combine: `and` (default) or `or`.
    #[serde(default)]
    pub conjunction: query::Conjunction,
    #[serde(default)]
    pub sort: Vec<query::SortKey>,
    /// Group keys applied in order; empty = no grouping.
    #[serde(default)]
    pub group_by: Vec<String>,
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

// Feature-pack gate args (bao 2026-06-25: Irisy installs + uses feature packs).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpPackInstallArgs {
    /// The validated manifest (must carry a string `id`). Same shape the PWA installs.
    pub manifest: serde_json::Value,
    /// Optional MCP server source code (TypeScript/Python).
    pub server_code: Option<String>,
    /// Optional filename for the server code (safe basename).
    pub server_code_filename: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpPackRunArgs {
    /// Installed pack id (the manifest `id`).
    pub mcp_id: String,
    /// The action id within that pack to run.
    pub action_id: String,
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

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MarketQuoteArgs {
    /// Ticker symbols, e.g. ["AAPL", "600519.SS", "0700.HK", "^GSPC"].
    /// Yahoo suffixes: `.SS` Shanghai, `.SZ` Shenzhen, `.HK` Hong Kong;
    /// US tickers bare; index symbols start with `^`.
    pub symbols: Vec<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct MarketScreenArgs {
    /// Predefined screen id: `day_gainers`, `day_losers`, or `most_actives`.
    pub screen: String,
    /// Max rows to return (default 10, capped at 50).
    #[serde(default)]
    pub count: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct WebSearchArgs {
    /// The search query (natural language or keywords).
    pub query: String,
    /// Max results to return (default 5, capped at 10).
    #[serde(default)]
    pub max_results: Option<u32>,
}

// ─── Router impl + tools ────────────────────────────────────────────────

#[tool_router]
impl KernelMcpRouter {
    pub fn new(runtime: Arc<KernelRuntime>, local_storage: Option<Arc<LocalStorage>>) -> Self {
        // Open the smart-table derived index (best-effort). A failure (or no
        // HOME) leaves it None and every read uses the in-memory engine.
        let st_index = smart_table_index::default_st_index_path()
            .and_then(|p| smart_table_index::SmartTableIndex::open(&p).ok())
            .map(Arc::new);
        Self {
            runtime,
            local_storage,
            tool_router: Self::tool_router(),
            ai_jobs: ai_column::new_registry(),
            vault_write_locks: Arc::new(tokio::sync::Mutex::new(
                std::collections::HashMap::new(),
            )),
            st_index,
        }
    }

    /// Export every static kernel tool's MCP definition (name + description +
    /// JSON Schema input) as a machine-readable artifact — the authoritative
    /// endpoint spec (ADR-010 § endpoint-spec v6). The schema is the
    /// rmcp-macro-generated `tools/list` shape, so the spec IS the protocol's
    /// own self-description, never a hand-maintained or source-scraped copy.
    /// Downstream MCP servers' tools are excluded — they own their own schemas.
    /// Pure + static (no runtime/app needed): the tool router is built from the
    /// `#[tool]` registrations, so this runs offline as a build/CI artifact.
    pub fn export_tool_schemas() -> serde_json::Value {
        let mut tools: Vec<serde_json::Value> = Self::tool_router()
            .list_all()
            .iter()
            .map(|t| {
                serde_json::json!({
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": serde_json::Value::Object((*t.input_schema).clone()),
                })
            })
            .collect();
        tools.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
        serde_json::json!({
            "kind": "ctrl-kernel-mcp-endpoint-spec",
            "transport": "streamable-http on 127.0.0.1:17873/mcp (Bearer auth)",
            "note": "Authoritative endpoint spec = the MCP tools/list JSON Schema. Generated, do not hand-edit. Regenerate: cargo run --bin dump_mcp_schema.",
            "toolCount": tools.len(),
            "tools": tools,
        })
    }

    /// Acquire (creating on first use) the per-path write lock. Hold the
    /// returned guard across the entire read-modify-write of a produce verb so
    /// two concurrent writers on the same vault file cannot clobber each other.
    async fn vault_write_lock(&self, path: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self.vault_write_locks.lock().await;
        map.entry(path.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
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
        // Advertise the computed relational columns (Reference / Lookup / Rollup)
        // alongside the generic describe so Irisy understands them (design §D).
        let describe = table.describe();
        let body = serde_json::json!({
            "source_kind": describe.source_kind,
            "fields": describe.fields,
            "operators": describe.operators,
            "relations": table.relations,
        });
        Ok(CallToolResult::success(vec![Content::text(body.to_string())]))
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
        let req = query::QueryRequest {
            filters: args.filters,
            conjunction: args.conjunction,
            sort: args.sort,
            group_by: args.group_by,
            limit: args.limit,
        };
        let now = chrono::Local::now().date_naive();
        // ONE authoritative §14 query path, shared with the Tauri command surface
        // (SC5 dual-surface collapse — they had drifted: index vs in-memory).
        let (table, mut result) =
            vault_smart_table::query_smart_table(self.st_index.as_deref(), &root, &args.path, &req, now)
                .map_err(|e| McpError::invalid_params(e, None))?;
        // Surface computed relational columns (Lookup / Rollup) into the result
        // rows — query-time derivatives, never written to markdown (slice 4c).
        // Caller-side post-step (the PWA computes relations client-side).
        if let Some(idx) = self.st_index.as_deref() {
            augment_relations(idx, &root, &args.path, &table, &mut result.rows);
        }
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
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        // Computed columns (Lookup / Rollup) are read-only derivatives — reject a
        // write (ADR-002 §14: produce gated; only the underlying data is writable).
        if table.is_read_only_field(&args.field) {
            return Err(McpError::invalid_params(
                format!("field '{}' is a computed column (read-only)", args.field),
                None,
            ));
        }
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
        // Write-through: refresh the derived index from the just-written table.
        if let Some(idx) = self.st_index.as_deref() {
            table.reindex_into(idx, &args.path);
        }
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
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        table.append_row(args.values.into_iter().collect());
        let new_body = table.serialize_body();
        vault::write(&root, &args.path, &new_body, &entry.frontmatter).map_err(map_vault_err)?;
        // Write-through: refresh the derived index from the just-written table.
        if let Some(idx) = self.st_index.as_deref() {
            table.reindex_into(idx, &args.path);
        }
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
            conjunction: args.conjunction,
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

    /// vault_text.describe — the §14 Text profile of the vault (ADR-002 §14
    /// TextSource): full-text content search as a queryable source, complementing
    /// notes.describe (the Record/metadata profile). Together they make the vault
    /// a complete §14 read source.
    #[tool(
        description = "Describe the vault full-text source: source_kind=text; query content with a Contains filter whose value is the search needle. Call before vault_text_query."
    )]
    async fn vault_text_describe(&self) -> Result<CallToolResult, McpError> {
        let body =
            serde_json::to_string(&vault_notes_source::text::describe()).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// vault_text.query — §14 full-text query over vault content. The `Contains`
    /// filter's value is the needle (FTS5 when indexed, substring fallback — the
    /// same engine the legacy `vault_search` uses); returns `{path}` rows in the
    /// uniform QueryResult shape. This is the §14 target surface; bespoke
    /// `vault_search` retires onto it once the frontend moves off it.
    #[tool(
        description = "Full-text query the vault as a §14 source: pass a Contains filter (field 'content', value = search text); returns matching note paths. Call vault_text_describe first."
    )]
    async fn vault_text_query(
        &self,
        Parameters(args): Parameters<VaultTextQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let req = query::QueryRequest {
            filters: args.filters,
            limit: args.limit,
            ..Default::default()
        };
        let result = vault_notes_source::text::query(&root, &req).map_err(map_vault_err)?;
        let body = serde_json::to_string(&result).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// smart_table.run_ai_column — the AI field shortcut (ADR-003 §6.5.4). Runs
    /// an LLM per row down `target_field`, `{field}`-templated, cost-gated at
    /// 100 rows, resume-safe (skips filled cells), partial-failure tolerant,
    /// then merges results back. (First cut runs the bounded batch in-call; the
    /// async job triple is the next slice — the cost gate caps the run.)
    #[tool(
        description = "Run an AI field shortcut down a column: per row, classify/extract/summarize/translate/generate using {field} tokens, then write results into target_field. Cost-gated at 100 rows (pass confirm_over_gate=true to exceed). Skips already-filled cells unless force=true."
    )]
    async fn smart_table_run_ai_column(
        &self,
        Parameters(args): Parameters<SmartTableRunAiColumnArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        if !table.fields.iter().any(|f| f.key == args.target_field) {
            return Err(McpError::invalid_params(
                format!("field_not_found: '{}'", args.target_field),
                None,
            ));
        }
        let rows_total = table.rows.len();
        let plan = ai_column::plan_rows(&table, &args.target_field, &args.prompt, args.force);
        if ai_column::over_cost_gate(plan.len()) && !args.confirm_over_gate {
            return Err(McpError::invalid_params(
                format!(
                    "needs_confirmation: {} rows exceed the {}-row cost gate; pass confirm_over_gate=true to proceed",
                    plan.len(),
                    ai_column::COST_GATE_ROWS
                ),
                None,
            ));
        }

        let adapter = self
            .runtime
            .provider_registry
            .primary_text_chat()
            .ok_or_else(|| McpError::internal_error("no text.chat provider available", None))?;
        let system = args.op.system_instruction();

        let mut results: Vec<(usize, query::Row, String)> = Vec::new();
        let mut errors: Vec<ai_column::RowError> = Vec::new();
        for item in &plan {
            match ai_column::complete_row(adapter.as_ref(), system, &item.prompt).await {
                Ok(value) => results.push((item.index, item.snapshot.clone(), value)),
                Err(e) => errors.push(ai_column::RowError { row: item.index, message: e.to_string() }),
            }
        }

        let rows_written = ai_column::apply_results(&mut table, &args.target_field, &results);
        if rows_written > 0 {
            let new_body = table.serialize_body();
            vault::write(&root, &args.path, &new_body, &entry.frontmatter).map_err(map_vault_err)?;
            // Write-through: refresh the derived index from the just-written table.
            if let Some(idx) = self.st_index.as_deref() {
                table.reindex_into(idx, &args.path);
            }
        }
        let summary = ai_column::RunSummary {
            rows_total,
            rows_planned: plan.len(),
            rows_written,
            errors,
        };
        let body = serde_json::to_string(&summary).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// smart_table.run_ai_column.start — async AI column (ADR-003 §6.5.4
    /// call-now/fetch-later). Validates + cost-gates, then spawns a background
    /// job and returns `{job_id, rows_planned}` immediately; poll
    /// `.status`, optionally `.cancel`. The job re-reads the file and
    /// merge-by-row writes results back when done.
    #[tool(
        description = "Start an async AI field-shortcut job over a column (classify/extract/summarize/translate/generate, {field} tokens). Cost-gated at 100 rows. Returns a job_id; poll smart_table.run_ai_column_status."
    )]
    async fn smart_table_run_ai_column_start(
        &self,
        Parameters(args): Parameters<SmartTableRunAiColumnArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        if !table.fields.iter().any(|f| f.key == args.target_field) {
            return Err(McpError::invalid_params(
                format!("field_not_found: '{}'", args.target_field),
                None,
            ));
        }
        let plan = ai_column::plan_rows(&table, &args.target_field, &args.prompt, args.force);
        if ai_column::over_cost_gate(plan.len()) && !args.confirm_over_gate {
            return Err(McpError::invalid_params(
                format!(
                    "needs_confirmation: {} rows exceed the {}-row cost gate; pass confirm_over_gate=true to proceed",
                    plan.len(),
                    ai_column::COST_GATE_ROWS
                ),
                None,
            ));
        }

        let planned = plan.len();
        let job_id = Uuid::new_v4().to_string();
        let state = ai_column::new_job(planned);
        self.ai_jobs.write().await.insert(job_id.clone(), state.clone());

        // Background job — non-blocking; the tool returns the id immediately.
        let runtime = self.runtime.clone();
        let system = args.op.system_instruction().to_string();
        let target = args.target_field.clone();
        let path = args.path.clone();
        let root2 = root.clone();
        let write_lock = self.vault_write_lock(&args.path).await;
        let jobs_for_cleanup = self.ai_jobs.clone();
        let job_id_for_cleanup = job_id.clone();
        tokio::spawn(async move {
            let adapter = match runtime.provider_registry.primary_text_chat() {
                Some(a) => a,
                None => {
                    state.write().await.phase = ai_column::JobPhase::Failed;
                    return;
                }
            };
            // Bounded concurrency: process the plan in chunks of MAX_CONCURRENCY
            // (ADR-003 §6.5.4 — unbounded fan-out hits provider rate limits).
            // Cancel + AuthFailed are checked between chunks (AuthFailed stops
            // the whole job — the key is broken, retrying every row is waste).
            const MAX_CONCURRENCY: usize = 6;
            let mut results: Vec<(usize, query::Row, String)> = Vec::new();
            'outer: for chunk in plan.chunks(MAX_CONCURRENCY) {
                if state.read().await.cancelled {
                    break;
                }
                let outcomes = futures::future::join_all(chunk.iter().map(|item| {
                    let adapter = adapter.clone();
                    let system = system.clone();
                    let index = item.index;
                    let snapshot = item.snapshot.clone();
                    let prompt = item.prompt.clone();
                    async move {
                        (index, snapshot, ai_column::complete_row(adapter.as_ref(), &system, &prompt).await)
                    }
                }))
                .await;

                let mut auth_failed = false;
                {
                    let mut s = state.write().await;
                    for (idx, snapshot, outcome) in outcomes {
                        match outcome {
                            Ok(value) => results.push((idx, snapshot, value)),
                            Err(e) => {
                                if matches!(e, crate::kernel::provider::ProviderError::AuthFailed) {
                                    auth_failed = true;
                                }
                                s.errors.push(ai_column::RowError { row: idx, message: e.to_string() });
                            }
                        }
                        s.rows_done += 1;
                    }
                }
                if auth_failed {
                    break 'outer;
                }
            }

            // Merge-by-row write-back under the per-path write lock: re-read
            // fresh + apply + write atomically so neither a mid-run user edit
            // nor a concurrent produce verb clobbers the result (ADR-003
            // §6.5.4 + full-review P0 lost-update fix).
            {
                let _write_guard = write_lock.lock().await;
                if let Ok(fresh) = vault::read(&root2, &path) {
                    let mut table =
                        vault_smart_table::SmartTable::parse(&fresh.frontmatter, &fresh.content);
                    let written = ai_column::apply_results(&mut table, &target, &results);
                    if written > 0 {
                        let _ =
                            vault::write(&root2, &path, &table.serialize_body(), &fresh.frontmatter);
                    }
                    state.write().await.rows_written = written;
                }
            }
            let mut s = state.write().await;
            s.phase = if s.cancelled {
                ai_column::JobPhase::Cancelled
            } else {
                ai_column::JobPhase::Done
            };
            drop(s);
            // Terminal cleanup: evict the job after a grace window so a late
            // status poll still sees the result, then reclaim memory — the
            // registry used to grow unboundedly per start (full-review P1).
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(180)).await;
                jobs_for_cleanup.write().await.remove(&job_id_for_cleanup);
            });
        });

        let body = serde_json::json!({ "job_id": job_id, "rows_planned": planned });
        Ok(CallToolResult::success(vec![Content::text(body.to_string())]))
    }

    /// smart_table.run_ai_column.status — poll an async AI-column job (the
    /// authoritative truth; ADR-003 §6.5.4).
    #[tool(description = "Get the status of an AI-column job: phase, rows_done/total, rows_written, errors.")]
    async fn smart_table_run_ai_column_status(
        &self,
        Parameters(args): Parameters<JobIdArgs>,
    ) -> Result<CallToolResult, McpError> {
        let reg = self.ai_jobs.read().await;
        let Some(handle) = reg.get(&args.job_id) else {
            return Err(McpError::invalid_params(
                format!("unknown job_id: {}", args.job_id),
                None,
            ));
        };
        let snapshot = handle.read().await.clone();
        let body = serde_json::to_string(&snapshot).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// smart_table.run_ai_column.cancel — cooperatively cancel a running job.
    #[tool(description = "Cancel an in-flight AI-column job by id (already-written cells are kept).")]
    async fn smart_table_run_ai_column_cancel(
        &self,
        Parameters(args): Parameters<JobIdArgs>,
    ) -> Result<CallToolResult, McpError> {
        let reg = self.ai_jobs.read().await;
        let Some(handle) = reg.get(&args.job_id) else {
            return Err(McpError::invalid_params(
                format!("unknown job_id: {}", args.job_id),
                None,
            ));
        };
        handle.write().await.cancelled = true;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "cancelling {}",
            args.job_id
        ))]))
    }

    /// smart_table.add_view — persist a grid/kanban view into frontmatter
    /// `views` (ADR-003 §6.2 view-state-is-not-data). Body is untouched.
    #[tool(
        description = "Add a grid or kanban view to a smart table (persisted in frontmatter, not the table body). kanban requires group_by (a field key)."
    )]
    async fn smart_table_add_view(
        &self,
        Parameters(args): Parameters<SmartTableAddViewArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        let kind_str = match args.kind {
            ViewKind::Grid => "grid",
            ViewKind::Kanban => "kanban",
        };
        if let Some(g) = &args.group_by {
            if !table.fields.iter().any(|f| &f.key == g) {
                return Err(McpError::invalid_params(format!("field_not_found: '{g}'"), None));
            }
        } else if matches!(args.kind, ViewKind::Kanban) {
            return Err(McpError::invalid_params(
                "kanban view requires group_by".to_string(),
                None,
            ));
        }

        let mut fm = entry.frontmatter.clone();
        if !fm.is_object() {
            fm = serde_json::Value::Object(serde_json::Map::new());
        }
        let view = serde_json::json!({ "kind": kind_str, "group_by": args.group_by });
        if let Some(obj) = fm.as_object_mut() {
            let views = obj
                .entry("views")
                .or_insert_with(|| serde_json::Value::Array(Vec::new()));
            match views.as_array_mut() {
                Some(arr) => arr.push(view),
                None => *views = serde_json::Value::Array(vec![view]),
            }
        }
        vault::write(&root, &args.path, &entry.content, &fm).map_err(map_vault_err)?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "added {kind_str} view to {}",
            args.path
        ))]))
    }

    /// registry.describe — the installed-MCP registry's type layer (ADR-002
    /// §14). The registry is just another RecordSource.
    #[tool(
        description = "Describe the installed-MCP registry as a queryable RecordSource (fields: id/name/version/description/tools). Call before registry.query."
    )]
    async fn registry_describe(&self) -> Result<CallToolResult, McpError> {
        let desc = query::Describe {
            source_kind: query::SourceKind::Record,
            fields: runtime_sources::mcp_fields(),
            operators: runtime_sources::record_operators(),
        };
        let body = serde_json::to_string(&desc).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// registry.query — query installed MCP servers (ADR-002 §14) via the shared
    /// engine — same contract as smart_table.query, live runtime RecordSource.
    #[tool(
        description = "Query installed MCP servers by id/name/tool-count with a structured filter/sort/group request. Call registry.describe first."
    )]
    async fn registry_query(
        &self,
        Parameters(args): Parameters<RuntimeQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let installed = self.runtime.mcp_host.list_installed().await;
        let rows: Vec<query::Row> = installed
            .iter()
            .map(|d| {
                let mut r = query::Row::new();
                r.insert("id".into(), d.id.clone());
                r.insert("name".into(), d.name.clone());
                r.insert("version".into(), d.version.clone());
                r.insert("description".into(), d.description.clone());
                r.insert("tools".into(), d.tools.len().to_string());
                r
            })
            .collect();
        let req = query::QueryRequest {
            filters: args.filters,
            conjunction: args.conjunction,
            sort: args.sort,
            group_by: args.group_by,
            limit: args.limit,
        };
        let now = chrono::Local::now().date_naive();
        let result = query::run_query(&runtime_sources::mcp_fields(), &rows, &req, now)
            .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
        let body = serde_json::to_string(&result).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// providers.describe — the provider catalogue's type layer (ADR-002 §14).
    #[tool(
        description = "Describe the LLM provider catalogue as a queryable RecordSource (fields: id/label/kind/models/ready/capabilities). Call before providers.query."
    )]
    async fn providers_describe(&self) -> Result<CallToolResult, McpError> {
        let desc = query::Describe {
            source_kind: query::SourceKind::Record,
            fields: runtime_sources::provider_fields(),
            operators: runtime_sources::record_operators(),
        };
        let body = serde_json::to_string(&desc).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// providers.query — query the provider catalogue (ADR-002 §14) via the
    /// shared engine: "ready providers with embed capability", etc.
    #[tool(
        description = "Query configured LLM providers by id/kind/ready/capabilities with a structured filter/sort/group request. Call providers.describe first."
    )]
    async fn providers_query(
        &self,
        Parameters(args): Parameters<RuntimeQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let entries = self.runtime.provider_registry.list();
        let rows: Vec<query::Row> = entries
            .iter()
            .map(|e| {
                let mut r = query::Row::new();
                r.insert("id".into(), e.id.clone());
                r.insert("label".into(), e.label.clone());
                let kind = serde_json::to_value(&e.kind)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_default();
                r.insert("kind".into(), kind);
                r.insert("models".into(), e.models.len().to_string());
                r.insert("ready".into(), if e.ready { "x".into() } else { String::new() });
                r.insert("capabilities".into(), e.capabilities.join(", "));
                r
            })
            .collect();
        let req = query::QueryRequest {
            filters: args.filters,
            conjunction: args.conjunction,
            sort: args.sort,
            group_by: args.group_by,
            limit: args.limit,
        };
        let now = chrono::Local::now().date_naive();
        let result = query::run_query(&runtime_sources::provider_fields(), &rows, &req, now)
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
        // Write-through for smart tables: a generic vault.write that touches a
        // `tables/*.md` file (the dedicated smart_table.* tools are not the only
        // path that edits them) must refresh the derived SQLite index, exactly
        // like the dedicated produce verbs do (see smart_table_update_cell /
        // smart_table_append_row). Best-effort — the markdown on disk is the
        // source of truth and reads degrade to run_query when the index drifts.
        if let Some(idx) = self.st_index.as_deref() {
            if is_smart_table_path(&args.path) {
                let table = vault_smart_table::SmartTable::parse(&fm, &args.body);
                if !table.fields.is_empty() {
                    table.reindex_into(idx, &args.path);
                }
            }
        }
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

    /// mcp.pack_list — list the user's installed FEATURE PACKS (~/.ctrl/mcps),
    /// NOT downstream MCP servers (that's mcp_list_servers). Lets the brain see
    /// what tools it already has + their actions before running or installing
    /// (bao 2026-06-25: Irisy uses feature packs). Reuses the Tauri command core.
    #[tool(description = "List installed feature packs (the user's own mcps), with id/name/actions")]
    async fn mcp_pack_list(&self) -> Result<CallToolResult, McpError> {
        let dir = crate::commands::kernel::mcp_dir()
            .map_err(|e| McpError::internal_error(e, None))?;
        let summaries = crate::commands::kernel::list_installed_in(&dir);
        let body = serde_json::to_string(&summaries).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// mcp.pack_install — install a feature pack from its manifest (+ optional
    /// server code) so the brain can set up a tool it needs (bao 2026-06-25:
    /// Irisy installs feature packs). Same install path the PWA uses; idempotent.
    #[tool(description = "Install a feature pack from its manifest (+ optional server code)")]
    async fn mcp_pack_install(
        &self,
        Parameters(args): Parameters<McpPackInstallArgs>,
    ) -> Result<CallToolResult, McpError> {
        let dir = crate::commands::kernel::mcp_dir()
            .map_err(|e| McpError::internal_error(e, None))?;
        let install_args = crate::commands::kernel::InstallMcpArgs {
            manifest: args.manifest,
            server_code: args.server_code.unwrap_or_default(),
            server_code_filename: args.server_code_filename.unwrap_or_default(),
        };
        let summary = crate::commands::kernel::install_into(&dir, &install_args)
            .map_err(|e| McpError::invalid_params(e, None))?;
        let body = serde_json::to_string(&summary).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// mcp.pack_run — run a feature pack action's shell steps (the brain USING a
    /// tool, e.g. the Stocks role calling ghostfolio's portfolio action). The
    /// provision runner resolves secrets from the keychain first; secret values
    /// never reach the brain (ADR-006 § policy). Reuses run_action_blocking.
    #[tool(description = "Run a feature pack action (executes its shell steps, returns stdout)")]
    async fn mcp_pack_run(
        &self,
        Parameters(args): Parameters<McpPackRunArgs>,
    ) -> Result<CallToolResult, McpError> {
        let dir = crate::commands::kernel::mcp_dir()
            .map_err(|e| McpError::internal_error(e, None))?;
        let output = tokio::task::spawn_blocking(move || {
            crate::commands::kernel::run_action_blocking(&dir, &args.mcp_id, &args.action_id)
        })
        .await
        .map_err(|e| McpError::internal_error(format!("task join: {e}"), None))?
        .map_err(|e| McpError::internal_error(e, None))?;
        Ok(CallToolResult::success(vec![Content::text(output)]))
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

    /// market.quote — live quotes for a set of tickers. A CONTROLLED data tool
    /// (ADR-010 communication § trust-domains v3, SC3): unlike raw http.get
    /// (domain `net`, kept off first-party to deny exfiltration), this only ever
    /// GETs Yahoo Finance's fixed chart endpoint and returns parsed price /
    /// currency / day-change — it cannot reach an arbitrary URL or POST. So the
    /// `market` domain is first-party-visible and Irisy can watch a list / quote
    /// without opening the raw-network exfil surface (bao 2026-06-26).
    #[tool(
        description = "Live stock/index quotes for tickers (Yahoo Finance, no key). \
Returns price, currency, and percent change vs previous close. Use Yahoo \
suffixes: .SS Shanghai, .SZ Shenzhen, .HK Hong Kong; US tickers bare; indices \
start with ^ (e.g. ^GSPC, ^IXIC, ^HSI)."
    )]
    async fn market_quote(
        &self,
        Parameters(args): Parameters<MarketQuoteArgs>,
    ) -> Result<CallToolResult, McpError> {
        if args.symbols.is_empty() {
            return Err(McpError::invalid_params("symbols must not be empty", None));
        }
        if args.symbols.len() > 50 {
            return Err(McpError::invalid_params("at most 50 symbols per call", None));
        }
        let mut out: Vec<serde_json::Value> = Vec::with_capacity(args.symbols.len());
        for sym in &args.symbols {
            let Some(safe) = sanitize_ticker(sym) else {
                out.push(serde_json::json!({ "symbol": sym, "error": "invalid ticker" }));
                continue;
            };
            let url = format!(
                "https://query1.finance.yahoo.com/v8/finance/chart/{safe}?interval=1d&range=1d"
            );
            match yahoo_get(&url).await {
                Ok(j) => {
                    let m = &j["chart"]["result"][0]["meta"];
                    let price = m["regularMarketPrice"].as_f64();
                    let prev = m["chartPreviousClose"]
                        .as_f64()
                        .or_else(|| m["previousClose"].as_f64());
                    let change_pct = match (price, prev) {
                        (Some(p), Some(pc)) if pc != 0.0 => Some((p - pc) / pc * 100.0),
                        _ => None,
                    };
                    out.push(serde_json::json!({
                        "symbol": sym,
                        "price": price,
                        "currency": m["currency"].as_str().unwrap_or(""),
                        "change_pct": change_pct,
                    }));
                }
                Err(e) => out.push(serde_json::json!({ "symbol": sym, "error": e.message })),
            }
        }
        let body = serde_json::to_string(&out).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// market.screen — the day's notable movers from a predefined Yahoo screen.
    /// Same controlled shape as market.quote: the screen id is whitelisted and
    /// the URL is fixed, so the `market` domain stays exfil-free (ADR-010
    /// communication § trust-domains v3, SC3).
    #[tool(
        description = "Predefined stock screen (Yahoo Finance, no key). screen = \
day_gainers | day_losers | most_actives. Returns symbol, name, price, and \
percent change for the top movers."
    )]
    async fn market_screen(
        &self,
        Parameters(args): Parameters<MarketScreenArgs>,
    ) -> Result<CallToolResult, McpError> {
        let screen = match args.screen.as_str() {
            s @ ("day_gainers" | "day_losers" | "most_actives") => s,
            other => {
                return Err(McpError::invalid_params(
                    format!("unknown screen '{other}' (use day_gainers|day_losers|most_actives)"),
                    None,
                ))
            }
        };
        let count = args.count.unwrap_or(10).min(50);
        let url = format!(
            "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds={screen}&count={count}"
        );
        let j = yahoo_get(&url).await?;
        let mut out: Vec<serde_json::Value> = Vec::new();
        if let Some(arr) = j["finance"]["result"][0]["quotes"].as_array() {
            for x in arr {
                out.push(serde_json::json!({
                    "symbol": x["symbol"],
                    "name": x["shortName"],
                    "price": x["regularMarketPrice"],
                    "change_pct": x["regularMarketChangePercent"],
                }));
            }
        }
        let body = serde_json::to_string(&out).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// web.search — look something up on the web. Another CONTROLLED data tool
    /// (ADR-010 communication § trust-domains v9, SC3): it never exposes a raw
    /// fetch — it calls only fixed search backends. If the user has set a Tavily
    /// API key (keychain account `tavily`) it uses Tavily (full web, fresh);
    /// otherwise it falls back to the keyless Wikipedia search API (encyclopedic
    /// only), so the tool works out of the box and upgrades when a key is added.
    /// Because it can't reach an arbitrary URL or POST user data anywhere, the
    /// `websearch` domain is first-party-visible without opening `net`.
    #[tool(
        description = "Search the web and return titles + URLs + snippets. Uses \
the user's Tavily key if set (full web), else a keyless Wikipedia fallback \
(encyclopedic). Use this for facts / news / research you don't already hold."
    )]
    async fn web_search(
        &self,
        Parameters(args): Parameters<WebSearchArgs>,
    ) -> Result<CallToolResult, McpError> {
        let query = args.query.trim();
        if query.is_empty() {
            return Err(McpError::invalid_params("query must not be empty", None));
        }
        let n = args.max_results.unwrap_or(5).clamp(1, 10);
        let key = crate::kernel::provider::registry::read_credential("tavily")
            .filter(|k| !k.is_empty());
        let (results, source, note) = match key {
            Some(k) => (tavily_search(&k, query, n).await?, "tavily", ""),
            None => (
                wikipedia_search(query, n).await?,
                "wikipedia",
                "Keyless Wikipedia fallback (encyclopedic only). For full web \
search, set a Tavily API key (keychain account 'tavily', free at tavily.com).",
            ),
        };
        let body = serde_json::to_string(&serde_json::json!({
            "source": source,
            "results": results,
            "note": note,
        }))
        .map_err(map_serde_err)?;
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
        // Clear the derived smart-table index when a `tables/*.md` file is
        // removed, otherwise its rows leak and st_refs dangle (remove_table
        // also NULLs incoming refs). Best-effort — markdown is the truth.
        if let Some(idx) = self.st_index.as_deref() {
            if is_smart_table_path(&args.path) {
                if let Err(e) = idx.remove_table(&args.path) {
                    tracing::warn!(path = %args.path, error = %e, "vault.delete: smart-table index remove failed");
                }
            }
        }
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

// Helper — a vault path is a smart-table candidate when it lives under the
// `tables/` directory (the convention the dedicated smart_table.* tools and the
// pipeline tests use). The caller still parses the file and checks for a real
// non-empty schema before touching the derived index, so a plain markdown note
// dropped into `tables/` never indexes as a table.
fn is_smart_table_path(path: &str) -> bool {
    path.starts_with("tables/") && path.ends_with(".md")
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
/// Read a request header from the HTTP parts that rmcp's StreamableHttp
/// transport stashes in the `RequestContext` extensions. Returns `None` when
/// the transport is not HTTP (e.g. an in-process test) or the header is absent.
fn request_header<'a>(
    context: &'a RequestContext<RoleServer>,
    name: &str,
) -> Option<&'a str> {
    context
        .extensions
        .get::<axum::http::request::Parts>()
        .and_then(|parts| parts.headers.get(name))
        .and_then(|v| v.to_str().ok())
}

impl KernelMcpRouter {
    /// Dispatch a tool call to either a downstream namespaced server or the
    /// static kernel tool router. Kept separate from the `ServerHandler`
    /// `call_tool` override so the latter can wrap it with audit recording
    /// without duplicating the routing logic (ADR-010 § trust-domains).
    async fn dispatch_tool(
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
}

impl ServerHandler for KernelMcpRouter {
    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
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
        // Intent-scoped projection (SC3): project the listing to the caller's
        // scope. A declared `X-Ctrl-Intent` wins; otherwise the caller's default
        // scope applies (first-party => broad, unknown => minimal system-only) —
        // no header no longer means "full toolset" (least privilege).
        let caller = audit::normalize_caller(request_header(&context, audit::CALLER_HEADER));
        let intent = {
            let declared = Intent::parse(request_header(&context, visibility::INTENT_HEADER));
            if declared.is_scoped() {
                declared
            } else {
                Intent::default_for_caller(&caller)
            }
        };
        tools.retain(|t| intent.allows_tool(t.name.as_ref()));
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
        // The :17873 gate is the single boundary every External call crosses,
        // so audit happens here once (ADR-010 § trust-domains). Record the tool
        // name + a hash of the args (not the args themselves — data sovereignty)
        // + the caller + the outcome. Best-effort: a ledger failure must never
        // block a call.
        let tool_name = request.name.to_string();

        // SC3: attribute the call to a concrete caller (not blanket "external")
        // and enforce intent-scoped visibility — a tool outside the caller's
        // declared intent is rejected, not just hidden (defense in depth: a
        // hidden tool must also be uncallable).
        let caller = audit::normalize_caller(request_header(&context, audit::CALLER_HEADER));
        // No (or blank) intent header no longer means "full toolset": resolve the
        // caller's default scope (first-party => broad, unknown => minimal), so an
        // un-declared external caller can't reach out-of-scope tools (SC3).
        let intent = {
            let declared = Intent::parse(request_header(&context, visibility::INTENT_HEADER));
            if declared.is_scoped() {
                declared
            } else {
                Intent::default_for_caller(&caller)
            }
        };
        let denied = !intent.allows_tool(&tool_name);

        // SC1 compile-time trust boundary: capture the cross-domain call as a
        // `GateRequest` here at the gate, before `request` is consumed. Only the
        // gate can build one — internal traffic has no constructor, so the type
        // system (not convention) keeps kernel self-calls off the ledger.
        let gate_req =
            audit::GateRequest::at_gate(caller, &tool_name, request.arguments.as_ref());

        let result = if denied {
            Err(McpError::invalid_request(
                format!("tool '{tool_name}' is out of scope for the declared intent"),
                None,
            ))
        } else {
            self.dispatch_tool(request, context).await
        };

        let (outcome, detail) = match &result {
            Ok(_) => ("ok", None),
            Err(e) if denied => ("denied", Some(e.to_string())),
            Err(e) => ("error", Some(e.to_string())),
        };
        if let Err(e) = self
            .runtime
            .event_store
            .record_call(&gate_req, outcome, detail.as_deref())
        {
            tracing::warn!(tool = %tool_name, error = %e, "audit ledger write failed");
        }

        result
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

/// Inject computed relational columns (Lookup / Rollup) into a query's result
/// rows (slice 4c). Cross-table orchestration: index the source + each Reference
/// target table, materialize the edges, then fill each computed column by
/// matching the row's via cell value. Best-effort and pure-derivative — any
/// failure simply leaves that column blank (markdown stays the source of truth;
/// the values are never written back).
fn augment_relations(
    idx: &smart_table_index::SmartTableIndex,
    root: &std::path::Path,
    src_path: &str,
    table: &vault_smart_table::SmartTable,
    rows: &mut [query::Row],
) {
    use vault_smart_table::RelationKind;
    if table.relations.is_empty() {
        return;
    }
    let src_tid = smart_table_index::table_id_for(src_path);
    // Ensure the source rows are indexed (small tables skip the index on read).
    table.reindex_into(idx, src_path);

    // Index each Reference target table + materialize its edges. Map the
    // reference field key → whether its edges are ready to compute against.
    let mut ready_via: std::collections::HashSet<String> = std::collections::HashSet::new();
    for rel in &table.relations {
        if let RelationKind::Reference { target_table, display } = &rel.kind {
            if let Ok(entry) = vault::read(root, target_table) {
                let tgt = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
                tgt.reindex_into(idx, target_table);
                let tgt_tid = smart_table_index::table_id_for(target_table);
                if idx
                    .index_references(&src_tid, &rel.field_key, &tgt_tid, display)
                    .is_ok()
                {
                    ready_via.insert(rel.field_key.clone());
                }
            }
        }
    }

    // Fill each computed column by matching the row's via cell value.
    for rel in &table.relations {
        let (via, computed) = match &rel.kind {
            RelationKind::Lookup { via, target } if ready_via.contains(via) => {
                (via, idx.lookup_by_via(&src_tid, via, target))
            }
            RelationKind::Rollup { via, target, func } if ready_via.contains(via) => {
                (via, idx.rollup_by_via(&src_tid, via, target, func))
            }
            _ => continue,
        };
        let Ok(map) = computed else { continue };
        for row in rows.iter_mut() {
            let key = row.get(via).cloned().unwrap_or_default();
            let value = map.get(&key).cloned().unwrap_or_default();
            row.insert(rel.field_key.clone(), value);
        }
    }

    // Formula columns last, so they can reference the just-injected Lookup /
    // Rollup values. Pure per-row arithmetic — no index / vault needed. A
    // formula that can't evaluate leaves the cell blank (never a wrong number).
    for rel in &table.relations {
        if let RelationKind::Formula { expr } = &rel.kind {
            for row in rows.iter_mut() {
                let value = vault_smart_table::eval_formula(expr, row)
                    .map(format_formula_num)
                    .unwrap_or_default();
                row.insert(rel.field_key.clone(), value);
            }
        }
    }
}

/// Format a formula result: integers without a trailing `.0`, else trimmed.
fn format_formula_num(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        let s = format!("{n:.4}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn map_vault_err(e: vault::VaultError) -> McpError {
    McpError::internal_error(format!("vault: {e}"), None)
}

fn map_serde_err(e: serde_json::Error) -> McpError {
    McpError::internal_error(format!("serialize: {e}"), None)
}

/// Validate + URL-encode a ticker for the market.* tools. Rejects anything
/// outside `[A-Za-z0-9.^=-]` so a hostile symbol can't escape the fixed Yahoo
/// path (the market domain is exfil-free by construction). `^` (index prefix)
/// is percent-encoded; the rest are path-safe as-is.
fn sanitize_ticker(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s.len() > 16 {
        return None;
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '^' | '=' | '-'))
    {
        return None;
    }
    Some(s.replace('^', "%5E"))
}

/// GET a fixed Yahoo Finance endpoint with a browser-like User-Agent (Yahoo
/// 429s requests without one) and return the parsed JSON. Used only by the
/// controlled market.* tools — never exposed as a generic fetch.
async fn yahoo_get(url: &str) -> Result<serde_json::Value, McpError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| McpError::internal_error(format!("market client build: {e}"), None))?;
    let resp = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| McpError::internal_error(format!("market fetch: {e}"), None))?;
    if !resp.status().is_success() {
        return Err(McpError::internal_error(
            format!("market fetch: HTTP {}", resp.status()),
            None,
        ));
    }
    resp.json()
        .await
        .map_err(|e| McpError::internal_error(format!("market parse: {e}"), None))
}

/// Strip HTML tags from a string (Wikipedia search snippets wrap matches in
/// `<span>`). Tiny hand-rolled scrubber — no regex dep for one field.
fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// web.search backend — Tavily (BYOK). POSTs only the fixed Tavily search
/// endpoint; the API key never leaves the kernel. Returns [{title,url,snippet}].
async fn tavily_search(
    key: &str,
    query: &str,
    n: u32,
) -> Result<Vec<serde_json::Value>, McpError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| McpError::internal_error(format!("search client build: {e}"), None))?;
    let resp = client
        .post("https://api.tavily.com/search")
        .json(&serde_json::json!({
            "api_key": key,
            "query": query,
            "max_results": n,
            "search_depth": "basic",
        }))
        .send()
        .await
        .map_err(|e| McpError::internal_error(format!("tavily fetch: {e}"), None))?;
    if !resp.status().is_success() {
        return Err(McpError::internal_error(
            format!("tavily search: HTTP {}", resp.status()),
            None,
        ));
    }
    let j: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| McpError::internal_error(format!("tavily parse: {e}"), None))?;
    let mut out = Vec::new();
    if let Some(arr) = j["results"].as_array() {
        for r in arr.iter().take(n as usize) {
            out.push(serde_json::json!({
                "title": r["title"],
                "url": r["url"],
                "snippet": r["content"],
            }));
        }
    }
    Ok(out)
}

/// web.search keyless fallback — Wikipedia's search API (no key, reliable, but
/// encyclopedic only). GETs only the fixed MediaWiki endpoint; reqwest encodes
/// the query so it can't escape the URL. Returns [{title,url,snippet}].
async fn wikipedia_search(query: &str, n: u32) -> Result<Vec<serde_json::Value>, McpError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| McpError::internal_error(format!("search client build: {e}"), None))?;
    let resp = client
        .get("https://en.wikipedia.org/w/api.php")
        .query(&[
            ("action", "query"),
            ("list", "search"),
            ("format", "json"),
            ("srlimit", &n.to_string()),
            ("srsearch", query),
        ])
        .header("User-Agent", "CTRL/1.0 (https://github.com/soodooi/CTRL)")
        .send()
        .await
        .map_err(|e| McpError::internal_error(format!("wikipedia fetch: {e}"), None))?;
    if !resp.status().is_success() {
        return Err(McpError::internal_error(
            format!("wikipedia search: HTTP {}", resp.status()),
            None,
        ));
    }
    let j: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| McpError::internal_error(format!("wikipedia parse: {e}"), None))?;
    let mut out = Vec::new();
    if let Some(arr) = j["query"]["search"].as_array() {
        for r in arr {
            let title = r["title"].as_str().unwrap_or("");
            out.push(serde_json::json!({
                "title": title,
                "url": format!("https://en.wikipedia.org/wiki/{}", title.replace(' ', "_")),
                "snippet": strip_html(r["snippet"].as_str().unwrap_or("")),
            }));
        }
    }
    Ok(out)
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

    /// Slice 4c end-to-end (vault-backed): a `deals` table references `contacts`
    /// by name; `augment_relations` indexes both tables, materializes the edges,
    /// and injects the Lookup (email) + Rollup (sum spend) computed columns into
    /// the query result rows — without writing them to markdown.
    #[test]
    fn augment_relations_injects_lookup_and_rollup_from_vault() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();

        let cfm = serde_json::json!({ "schema": [
            { "key": "name", "label": "Name", "type": "text" },
            { "key": "email", "label": "Email", "type": "text" },
            { "key": "spend", "label": "Spend", "type": "number" }
        ]});
        let cbody = "\n| Name | Email | Spend |\n|---|---|---|\n| Acme | a@acme.co | 300 |\n| Beta | b@beta.co | 120 |\n";
        vault::write(root, "contacts.md", cbody, &cfm).unwrap();

        let dfm = serde_json::json!({ "schema": [
            { "key": "title", "label": "Title", "type": "text" },
            { "key": "contact", "label": "Contact", "type": "reference", "table": "contacts.md", "display": "name" },
            { "key": "c_email", "label": "Email", "type": "lookup", "via": "contact", "target": "email" },
            { "key": "c_total", "label": "Total", "type": "rollup", "via": "contact", "target": "spend", "fn": "sum" },
            { "key": "half", "label": "Half", "type": "formula", "expr": "{c_total} / 2" }
        ]});
        let dbody = "\n| Title | Contact | Email | Total | Half |\n|---|---|---|---|---|\n| D1 | Acme |  |  |  |\n| D2 | Beta |  |  |  |\n";
        vault::write(root, "deals.md", dbody, &dfm).unwrap();

        let entry = vault::read(root, "deals.md").unwrap();
        let table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        let mut rows = table.rows.clone();

        let idxdir = tempfile::TempDir::new().unwrap();
        let idx = smart_table_index::SmartTableIndex::open(&idxdir.path().join("st.db")).unwrap();
        augment_relations(&idx, root, "deals.md", &table, &mut rows);

        let d1 = rows.iter().find(|r| r.get("title").map(String::as_str) == Some("D1")).unwrap();
        assert_eq!(d1.get("c_email").map(String::as_str), Some("a@acme.co"));
        assert_eq!(d1.get("c_total").map(String::as_str), Some("300"));
        // Formula references the just-injected rollup: 300 / 2 = 150.
        assert_eq!(d1.get("half").map(String::as_str), Some("150"));
        let d2 = rows.iter().find(|r| r.get("title").map(String::as_str) == Some("D2")).unwrap();
        assert_eq!(d2.get("c_email").map(String::as_str), Some("b@beta.co"));
        assert_eq!(d2.get("c_total").map(String::as_str), Some("120"));
        assert_eq!(d2.get("half").map(String::as_str), Some("60"));
    }

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

    /// Pull the JSON-RPC result out of a Streamable-HTTP response body that may
    /// be either a bare JSON object or an SSE stream of `data:` lines.
    fn extract_jsonrpc(body: &str) -> serde_json::Value {
        for line in body.lines() {
            if let Some(data) = line.strip_prefix("data:") {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(data.trim()) {
                    return v;
                }
            }
        }
        serde_json::from_str(body).unwrap_or(serde_json::Value::Null)
    }

    /// End-to-end proof that `X-Ctrl-Intent` is read off the HTTP request and
    /// projects `tools/list` to the declared capability domains (SC3). Drives a
    /// real MCP initialize -> tools/list over the wire, so it also guards the
    /// `http::request::Parts` -> RequestContext extension threading.
    #[tokio::test]
    async fn intent_header_scopes_tools_list() {
        let data_dir = std::env::temp_dir().join("ctrl-test-mcp-intent");
        let _ = std::fs::remove_dir_all(&data_dir);
        let runtime = Arc::new(KernelRuntime::boot(data_dir).expect("kernel boot"));
        let handle = serve(runtime, None, "127.0.0.1:0").await.expect("serve");
        let url = handle.url();
        let token = handle.auth_token.as_ref().clone();
        let client = reqwest::Client::new();

        // initialize -> capture the session id the server assigns.
        let init = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("Authorization", format!("Bearer {token}"))
            .body(
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}"#,
            )
            .send()
            .await
            .expect("initialize");
        let session_id = init
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .expect("server returns a session id");

        // tools/list with an intent scoped to `vault` only.
        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("Authorization", format!("Bearer {token}"))
            .header("mcp-session-id", session_id)
            .header(visibility::INTENT_HEADER, "vault")
            .body(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#)
            .send()
            .await
            .expect("tools/list");
        let body = resp.text().await.expect("body");
        let json = extract_jsonrpc(&body);
        let tools = json["result"]["tools"]
            .as_array()
            .expect("tools array present");

        assert!(!tools.is_empty(), "expected a non-empty projected toolset");
        for t in tools {
            let name = t["name"].as_str().unwrap_or("");
            let domain = visibility::tool_domain(name);
            assert!(
                domain == "vault" || domain == "system",
                "tool '{name}' (domain '{domain}') leaked past the vault intent scope"
            );
        }
        // The projection must actually hide something — a write/net tool that
        // exists in the full set but is out of the vault scope.
        assert!(
            !tools.iter().any(|t| t["name"] == "http_post"),
            "http_post must be hidden under the vault intent"
        );
    }
}
