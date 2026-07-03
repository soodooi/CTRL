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
use crate::kernel::review_gate;
use crate::kernel::local_storage::LocalStorage;
use crate::kernel::visibility::{self, Intent};
use crate::kernel::runtime::KernelRuntime;
use crate::kernel::{
    ai_column, calendar_source, manifest_source, provider::LlmPrompt, query, runtime_sources,
    smart_table_index, tasks_source, vault, vault_doc, vault_notes_source, vault_smart_table,
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

/// smart_table.delete_row — produce/delete a row (ADR-002 §14; Bitable record
/// delete parity).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableDeleteRowArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Zero-based row index to delete.
    pub row_index: usize,
}

/// smart_table.add_field — produce a new column (ADR-002 §14; Bitable field-create
/// parity).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableAddFieldArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Schema key for the new column (lowercase, unique).
    pub key: String,
    /// Human label.
    pub label: String,
    /// Cell type: text / number / date / checkbox / tags / select / url (+ the
    /// render-level types the schema accepts, e.g. currency / percent).
    #[serde(rename = "type")]
    pub cell_type: String,
    /// Options for a `select` / `tags` column.
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

/// smart_table.delete_field — produce/drop a column (ADR-002 §14; Bitable
/// field-delete parity).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableDeleteFieldArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Schema key of the column to drop.
    pub key: String,
}

/// smart_table.produce — the UNIFIED write verb (ADR-002 §14.13). One gate tool
/// over a typed `ProduceOp` union (set_cell / upsert_rows / delete_rows /
/// add_field / update_field / delete_field), dispatched to the table's
/// `RecordSink`. This is the §14 "produce" verb made literal — the bespoke
/// smart_table_* write tools collapse into this (they stay during the PWA
/// transition, ghostfolio_*→source_* style).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableProduceArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// The write operation to apply (tagged by `kind`).
    pub op: query::ProduceOp,
}

/// One field in a table-create request.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableFieldInput {
    /// Schema key (lowercase, unique within the table).
    pub key: String,
    /// Human label.
    pub label: String,
    /// Cell type: text / number / date / checkbox / tags / select / url (+ the
    /// render-level types the schema accepts).
    #[serde(rename = "type")]
    pub cell_type: String,
    /// Options for a `select` / `tags` column.
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

/// smart_table.create — produce a new empty table (ADR-002 §14; Bitable App-create
/// parity). Irisy builds a table from scratch.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableCreateArgs {
    /// Table title (kept verbatim in frontmatter; the file slug is derived).
    pub name: String,
    /// The columns (at least one).
    pub fields: Vec<SmartTableFieldInput>,
}

/// smart_table.batch_append_rows — produce many rows at once (ADR-002 §14; Bitable
/// batchCreate parity).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableBatchAppendArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Rows to append; each is cell values keyed by schema field key.
    pub rows: Vec<std::collections::BTreeMap<String, String>>,
}

/// smart_table.batch_delete_rows — delete many rows at once (ADR-002 §14; Bitable
/// batchDelete parity).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SmartTableBatchDeleteArgs {
    /// Vault-relative path to the smart-table `.md` file.
    pub path: String,
    /// Zero-based row indices to delete (out-of-range + duplicates ignored).
    pub row_indices: Vec<usize>,
}

/// task.query — a structured read over the LifeOS Task RecordSource (ADR-002
/// §14). Fill the parameter object; do NOT write a query string. Call
/// `task_describe` first to learn valid fields. `subdir` scopes the task
/// folder (default `Tasks/`).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TaskQueryArgs {
    /// Vault subdir the tasks live under (default `Tasks/`).
    #[serde(default)]
    pub subdir: Option<String>,
    /// Field filters, combined per `conjunction`. Each `field` must exist.
    #[serde(default)]
    pub filters: Vec<query::Filter>,
    /// How filters combine: `and` (default) or `or`.
    #[serde(default)]
    pub conjunction: query::Conjunction,
    /// Multi-key sort (first key wins).
    #[serde(default)]
    pub sort: Vec<query::SortKey>,
    /// Group keys applied in order (first is the primary level).
    #[serde(default)]
    pub group_by: Vec<String>,
    /// Cap the number of returned rows (match_count is reported pre-limit).
    #[serde(default)]
    pub limit: Option<usize>,
}

/// calendar.query — structured read over event notes (§14, same contract as
/// task_query / notes_query, different RecordSource).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CalendarQueryArgs {
    /// Field filters, combined per `conjunction`. Each `field` must exist.
    #[serde(default)]
    pub filters: Vec<query::Filter>,
    /// How filters combine: `and` (default) or `or`.
    #[serde(default)]
    pub conjunction: query::Conjunction,
    /// Multi-key sort (first key wins).
    #[serde(default)]
    pub sort: Vec<query::SortKey>,
    /// Group keys applied in order (first is the primary level).
    #[serde(default)]
    pub group_by: Vec<String>,
    /// Cap the number of returned rows (match_count is reported pre-limit).
    #[serde(default)]
    pub limit: Option<usize>,
}

/// calendar.produce — the unified §14.13 write verb over event notes. Rows are
/// addressed by scan index in `calendar_query` order.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CalendarProduceArgs {
    /// The write op (tagged by `kind`). Calendar supports set_cell /
    /// upsert_rows / delete_rows; field ops are unsupported (fixed schema).
    pub op: query::ProduceOp,
}

/// doc.produce — the unified §14.13 write verb over one vault markdown note
/// (the BLOCK profile: sections addressed by ATX heading).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DocProduceArgs {
    /// Vault-relative path to the markdown note.
    pub path: String,
    /// The write op (tagged by `kind`). Docs support append_section /
    /// replace_section / delete_section; record ops are unsupported here.
    pub op: query::ProduceOp,
}

/// mcp_pack.provision — one-click + silent setup of an installed feature pack
/// (bring up its declared service + run bootstrap auth) from its manifest data.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpPackProvisionArgs {
    /// Installed pack id (folder under `~/.ctrl/mcps/`).
    pub mcp_id: String,
}

/// mcp_pack.validate — evaluate a brain-authored candidate manifest before
/// install (mcp-builder review + evals). The brain generates the manifest with
/// its own model, then validates here for structured, self-correctable feedback.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpPackValidateArgs {
    /// The candidate feature-pack manifest to evaluate (a full manifest object).
    pub manifest: serde_json::Value,
}

/// mcp_pack.scaffold — draft a §14 record_source from an OpenAPI operation
/// (AutoMCP posture, §7.4). Best-effort draft + spec-repair notes.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpPackScaffoldArgs {
    /// The OpenAPI 3 document (a JSON object).
    pub openapi: serde_json::Value,
    /// The read path to scaffold from, e.g. `/api/v1/portfolio/holdings`.
    pub path: String,
    /// HTTP method (default `GET`).
    #[serde(default)]
    pub method: Option<String>,
}

/// mcp_pack.publish — publish an installed pack to a registry/commons (§7.6
/// share-and-be-shared). Evals first, then POSTs the manifest.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpPackPublishArgs {
    /// Installed pack id (folder under `~/.ctrl/mcps/`).
    pub mcp_id: String,
    /// Registry endpoint override; otherwise the configured `ctrl:registry:publish_url`.
    #[serde(default)]
    pub registry: Option<String>,
}

/// source.describe — the GENERIC §14 read type-layer over ANY installed
/// connector that declares a `record_source` (ADR-002 §14.12). No per-connector
/// tool; the source is addressed by `source_id`.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SourceDescribeArgs {
    /// Installed connector id (folder under `~/.ctrl/mcps/`), e.g. `ctrl-ghostfolio`.
    pub source_id: String,
}

/// source.query — generic structured read over an installed connector's records
/// (ADR-002 §14.12). Same filter/sort/group request as every §14 source.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SourceQueryArgs {
    /// Installed connector id, e.g. `ctrl-ghostfolio`.
    pub source_id: String,
    /// Field filters, combined per `conjunction`. Each `field` must exist.
    #[serde(default)]
    pub filters: Vec<query::Filter>,
    /// How filters combine: `and` (default) or `or`.
    #[serde(default)]
    pub conjunction: query::Conjunction,
    /// Multi-key sort (first key wins).
    #[serde(default)]
    pub sort: Vec<query::SortKey>,
    /// Group keys applied in order (first is the primary level).
    #[serde(default)]
    pub group_by: Vec<String>,
    /// Cap the number of returned rows (match_count is reported pre-limit).
    #[serde(default)]
    pub limit: Option<usize>,
}

/// source.produce — generic §14 write into an installed connector (ADR-002
/// §14.12). `input` keys match the source's declared `produce` body `from`
/// fields; routed through the gate + audited, same as any write.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SourceProduceArgs {
    /// Installed connector id, e.g. `ctrl-ghostfolio`.
    pub source_id: String,
    /// The produce input object; keys match the source's produce body map.
    pub input: serde_json::Value,
}

/// task.create — produce/write a new checkbox task line (ADR-002 §14 produce
/// verb). Appends `- [ ] <title>` to a note (inline-checkbox substrate).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TaskCreateArgs {
    /// Task text (required, non-empty).
    pub title: String,
    /// Optional due date `YYYY-MM-DD` (rendered as a `📅` inline marker).
    #[serde(default)]
    pub due: Option<String>,
    /// Optional tags (rendered as inline `#tag` tokens).
    #[serde(default)]
    pub tags: Vec<String>,
    /// Target note (vault-relative path). Omit to append to today's daily note.
    #[serde(default)]
    pub note: Option<String>,
}

/// task.update — produce/write one field of a task in place (ADR-002 §14
/// produce verb). Complete a task with field=`status`, value=`done`.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TaskUpdateArgs {
    /// Vault-relative path to the note holding the task.
    pub note: String,
    /// Zero-based line index of the checkbox (from `task_query`'s `line` field).
    pub line: usize,
    /// Field to set: `status` (todo/doing/done) / `due` / `title` / `tags`.
    pub field: String,
    /// New value (for `tags`, a comma-separated list).
    pub value: String,
}

/// task.produce — the unified §14.13 write verb over the task source. Rows are
/// addressed by their scan index in `task_query` order.
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct TaskProduceArgs {
    /// The write op (tagged by `kind`). Tasks support set_cell / upsert_rows /
    /// delete_rows; field ops (add/update/delete_field) are unsupported.
    pub op: query::ProduceOp,
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
    /// Return match context snippets (ADR-002 §1.9 v46 E13). When true, each
    /// hit is {path, context} with ~context_length chars around the first
    /// match; when false/absent, plain path strings (back-compat).
    #[serde(default)]
    pub with_context: bool,
    /// Snippet radius in chars (default 100), used with `with_context`.
    #[serde(default)]
    pub context_length: Option<usize>,
}

/// note.periodic — resolve/read/create the periodic note for a date (ADR-002
/// §1.9 v46 E1; LRA /periodic/ parity).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NotePeriodicArgs {
    /// Which period: daily / weekly / monthly / quarterly / yearly.
    pub period: crate::kernel::periodic_notes::Period,
    /// Anchor date YYYY-MM-DD (default: today).
    #[serde(default)]
    pub date: Option<String>,
    /// Create the note (with journal frontmatter) when missing.
    #[serde(default)]
    pub create: bool,
}

/// note.recent_changes — most recently modified notes (ADR-002 §1.9 v46 E12).
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct NoteRecentChangesArgs {
    /// Max results (default 20).
    #[serde(default)]
    pub limit: Option<usize>,
    /// Only notes modified within the last N days (default: no cutoff).
    #[serde(default)]
    pub days: Option<u32>,
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
pub struct McpPackUninstallArgs {
    /// Installed pack id to remove (the manifest `id`).
    pub mcp_id: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct McpPackWriteFileArgs {
    /// Installed pack id (install the pack first).
    pub mcp_id: String,
    /// Pack-relative path, e.g. "skills/analyze-cn-stocks/SKILL.md". No ".." or absolute.
    pub path: String,
    /// File text content (skill markdown, SVG icon, static data).
    pub content: String,
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

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DiscoverPacksArgs {
    /// Keyword to search packs by (e.g. "stock price"). Omit to browse top entries.
    #[serde(default)]
    pub query: Option<String>,
    /// Max entries per source to return (default 25, capped server-side at 100).
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DiscoverSkillsArgs {
    /// Keyword query matched against published SKILL.md skills on GitHub.
    pub query: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SkillListArgs {
    /// Optional keyword filter (matches skill name + description). Omit for all.
    #[serde(default)]
    pub query: Option<String>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SkillReadArgs {
    /// The skill's SKILL.md path, exactly as returned by skill_list.
    pub path: String,
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

    /// smart_table.delete_row — the produce/delete verb (ADR-002 §14; Bitable
    /// record-delete parity). Reads fresh, removes the row by index, re-serializes,
    /// writes back. Routed through the gate so it is audited + review-gated (a
    /// destructive write, like vault.delete).
    #[tool(description = "Delete a row from a smart table by zero-based row index, then write it back.")]
    async fn smart_table_delete_row(
        &self,
        Parameters(args): Parameters<SmartTableDeleteRowArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        if !table.delete_row(args.row_index) {
            return Err(McpError::invalid_params(
                format!("delete_row rejected: row {} out of range", args.row_index),
                None,
            ));
        }
        let new_body = table.serialize_body();
        vault::write(&root, &args.path, &new_body, &entry.frontmatter).map_err(map_vault_err)?;
        if let Some(idx) = self.st_index.as_deref() {
            table.reindex_into(idx, &args.path);
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "deleted row {} from {}",
            args.row_index, args.path
        ))]))
    }

    /// smart_table.add_field — produce a new column (ADR-002 §14; Bitable
    /// field-create parity). Appends the field to the frontmatter `schema` array
    /// (preserving sibling items, incl. relational fields' metadata) + an empty
    /// cell to every row. Schema write → audited + review-gated.
    #[tool(
        description = "Add a column to a smart table: key + label + type (text/number/date/checkbox/tags/select/url) + optional options for select/tags. Fails if the key already exists."
    )]
    async fn smart_table_add_field(
        &self,
        Parameters(args): Parameters<SmartTableAddFieldArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        if table.has_field(&args.key) {
            return Err(McpError::invalid_params(
                format!("field '{}' already exists", args.key),
                None,
            ));
        }
        let cell_type = query::CellType::parse(&args.cell_type);
        table.add_field(query::FieldSpec {
            key: args.key.clone(),
            label: args.label.clone(),
            cell_type,
            options: args.options.clone(),
        });
        // Append the schema item to the frontmatter (never rebuild — preserve
        // every sibling, incl. relational flow-string items verbatim).
        let mut frontmatter = entry.frontmatter.clone();
        let mut item = serde_json::Map::new();
        item.insert("key".into(), serde_json::json!(args.key));
        item.insert("label".into(), serde_json::json!(args.label));
        item.insert("type".into(), serde_json::json!(args.cell_type));
        if let Some(opts) = &args.options {
            item.insert("options".into(), serde_json::json!(opts));
        }
        match frontmatter.get_mut("schema").and_then(|v| v.as_array_mut()) {
            Some(arr) => arr.push(serde_json::Value::Object(item)),
            None => {
                frontmatter
                    .as_object_mut()
                    .ok_or_else(|| McpError::internal_error("frontmatter not an object", None))?
                    .insert("schema".into(), serde_json::json!([serde_json::Value::Object(item)]));
            }
        }
        let new_body = table.serialize_body();
        vault::write(&root, &args.path, &new_body, &frontmatter).map_err(map_vault_err)?;
        if let Some(idx) = self.st_index.as_deref() {
            table.reindex_into(idx, &args.path);
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "added field {} ({}) to {}",
            args.key, args.cell_type, args.path
        ))]))
    }

    /// smart_table.delete_field — produce/drop a column (ADR-002 §14; Bitable
    /// field-delete parity). Removes the field from the frontmatter `schema` (by
    /// key, both object + flow-string forms) and from every row. Schema write →
    /// audited + review-gated.
    #[tool(description = "Delete a column from a smart table by schema key (drops it from the schema + every row).")]
    async fn smart_table_delete_field(
        &self,
        Parameters(args): Parameters<SmartTableDeleteFieldArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        if !table.delete_field(&args.key) {
            return Err(McpError::invalid_params(
                format!("no such field '{}'", args.key),
                None,
            ));
        }
        let mut frontmatter = entry.frontmatter.clone();
        if let Some(arr) = frontmatter.get_mut("schema").and_then(|v| v.as_array_mut()) {
            arr.retain(|it| {
                vault_smart_table::schema_item_key(it).as_deref() != Some(args.key.as_str())
            });
        }
        let new_body = table.serialize_body();
        vault::write(&root, &args.path, &new_body, &frontmatter).map_err(map_vault_err)?;
        if let Some(idx) = self.st_index.as_deref() {
            table.reindex_into(idx, &args.path);
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "deleted field {} from {}",
            args.key, args.path
        ))]))
    }

    /// smart_table.produce — the UNIFIED §14 write verb (ADR-002 §14.13). Reads
    /// fresh, dispatches one typed `ProduceOp` to the table's `RecordSink`, then
    /// persists: body from `serialize_body`, and for schema-mutating ops the
    /// frontmatter `schema` is rebuilt from `serialize_schema` (round-trips
    /// relational metadata + options). Routed through the gate → audited +
    /// review-gated like every produce. This one verb subsumes the bespoke
    /// smart_table_* write tools (kept during the PWA transition).
    #[tool(
        description = "Write to a smart table with ONE unified produce verb. `op` is a tagged union: {kind:\"set_cell\",row,field,value} / {kind:\"upsert_rows\",rows:[{field:value}]} / {kind:\"delete_rows\",indices:[..]} / {kind:\"add_field\",key,label,type,options?,relation?} / {kind:\"update_field\",key,label?,type?,options?} / {kind:\"delete_field\",key}. relation = {kind:\"reference\"|\"lookup\"|\"rollup\",..} for relational columns."
    )]
    async fn smart_table_produce(
        &self,
        Parameters(args): Parameters<SmartTableProduceArgs>,
    ) -> Result<CallToolResult, McpError> {
        use query::RecordSink;
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        let summary = describe_produce_op(&args.op);
        // Apply the op to the in-memory table (validates + mutates fields/rows).
        table
            .produce(args.op.clone())
            .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
        let new_body = table.serialize_body();
        // Row-only ops leave frontmatter untouched. Schema-mutating ops patch the
        // existing `schema` array IN PLACE (never full-regenerate) so untouched
        // columns keep their render-level type sugar (currency/percent/…) + any
        // extra keys — matching the bespoke smart_table_add_field/delete_field.
        let mut frontmatter = entry.frontmatter.clone();
        patch_schema_in_place(&mut frontmatter, &args.op, &table)?;
        vault::write(&root, &args.path, &new_body, &frontmatter).map_err(map_vault_err)?;
        if let Some(idx) = self.st_index.as_deref() {
            table.reindex_into(idx, &args.path);
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "produce {} on {}",
            summary, args.path
        ))]))
    }

    /// smart_table.create — produce a new empty table (ADR-002 §14; Bitable
    /// App-create parity). Seeds `tables/<slug>.md` from a name + fields so Irisy
    /// can build a table from scratch. `create` verb → audited + review-gated.
    #[tool(
        description = "Create a new smart table from a name + fields (each key/label/type[/options]). Seeds an empty table at tables/<slug>.md and returns its path. Then use smart_table_append_row to add data."
    )]
    async fn smart_table_create(
        &self,
        Parameters(args): Parameters<SmartTableCreateArgs>,
    ) -> Result<CallToolResult, McpError> {
        if args.fields.is_empty() {
            return Err(McpError::invalid_params("a table needs at least one field", None));
        }
        let root = vault_root()?;
        let fields: Vec<query::FieldSpec> = args
            .fields
            .iter()
            .map(|f| query::FieldSpec {
                key: f.key.clone(),
                label: f.label.clone(),
                cell_type: query::CellType::parse(&f.cell_type),
                options: f.options.clone(),
            })
            .collect();
        let (frontmatter, body) = vault_smart_table::seed_table(&args.name, &fields);
        let path = unique_table_path(&root, &slugify(&args.name));
        let lock = self.vault_write_lock(&path).await;
        let _write_guard = lock.lock().await;
        vault::write(&root, &path, &body, &frontmatter).map_err(map_vault_err)?;
        if let Some(idx) = self.st_index.as_deref() {
            let table = vault_smart_table::SmartTable::parse(&frontmatter, &body);
            table.reindex_into(idx, &path);
        }
        Ok(CallToolResult::success(vec![Content::text(format!("created table {path}"))]))
    }

    /// smart_table.batch_append_rows — produce many rows in one write (ADR-002 §14;
    /// Bitable batchCreate parity). Reads fresh, appends all, one re-serialize.
    #[tool(description = "Append multiple rows to a smart table in one call (each row = values keyed by field key). Bitable batch-create parity.")]
    async fn smart_table_batch_append_rows(
        &self,
        Parameters(args): Parameters<SmartTableBatchAppendArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        let n = table.append_rows(args.rows.into_iter().map(|r| r.into_iter().collect()).collect());
        let new_body = table.serialize_body();
        vault::write(&root, &args.path, &new_body, &entry.frontmatter).map_err(map_vault_err)?;
        if let Some(idx) = self.st_index.as_deref() {
            table.reindex_into(idx, &args.path);
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "appended {n} rows to {}",
            args.path
        ))]))
    }

    /// smart_table.batch_delete_rows — delete many rows in one write (ADR-002 §14;
    /// Bitable batchDelete parity). Descending-order removal; out-of-range ignored.
    #[tool(description = "Delete multiple rows from a smart table by zero-based indices in one call (out-of-range + duplicate indices ignored). Bitable batch-delete parity.")]
    async fn smart_table_batch_delete_rows(
        &self,
        Parameters(args): Parameters<SmartTableBatchDeleteArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let mut table = vault_smart_table::SmartTable::parse(&entry.frontmatter, &entry.content);
        let n = table.delete_rows(&args.row_indices);
        let new_body = table.serialize_body();
        vault::write(&root, &args.path, &new_body, &entry.frontmatter).map_err(map_vault_err)?;
        if let Some(idx) = self.st_index.as_deref() {
            table.reindex_into(idx, &args.path);
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "deleted {n} rows from {}",
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

    /// task.describe — the LifeOS Task source's type layer (ADR-002 §14, GOAL
    /// Phase 1). Same `describe` verb as smart-table / notes: tasks are just
    /// another RecordSource. Call before task_query so Irisy only references
    /// valid fields (path/title/status/due/priority/tags/created/modified).
    #[tool(
        description = "Describe the LifeOS tasks source as a queryable RecordSource: fields (path/title/status/due/priority/tags/created/modified) and supported operators. Call before task_query."
    )]
    async fn task_describe(&self) -> Result<CallToolResult, McpError> {
        let body = serde_json::to_string(&tasks_source::describe()).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// task.query — structured read over the LifeOS tasks (ADR-002 §14), routed
    /// through the shared kernel query engine — identical contract to
    /// `smart_table.query` / `notes.query`, different RecordSource.
    #[tool(
        description = "Query LifeOS tasks by status/due/priority/tags with a structured filter/sort/group request (not a query string). Returns matching tasks. Call task_describe first."
    )]
    async fn task_query(
        &self,
        Parameters(args): Parameters<TaskQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let source = tasks_source::TaskSource::load(&root, args.subdir.as_deref());
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

    /// task.create — the produce/write verb (ADR-002 §14): append a `- [ ]`
    /// checkbox task to a note (inline-checkbox substrate; vim test). Omit
    /// `note` to capture into today's daily note.
    #[tool(
        description = "Create a LifeOS task: append a `- [ ]` checkbox line with `title` (required), optional `due` (YYYY-MM-DD) and `tags`, to `note` (default: today's daily note). Returns the note path."
    )]
    async fn task_create(
        &self,
        Parameters(args): Parameters<TaskCreateArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let now = chrono::Local::now().date_naive();
        let target = args
            .note
            .clone()
            .unwrap_or_else(|| format!("daily/{}.md", now.format("%Y-%m-%d")));
        let lock = self.vault_write_lock(&target).await;
        let _write_guard = lock.lock().await;
        let path = tasks_source::create(
            &root,
            args.note.as_deref(),
            &args.title,
            args.due.as_deref(),
            &args.tags,
            now,
        )
        .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!("created task in {path}"))]))
    }

    /// task.update — the produce/write verb (ADR-002 §14): rewrite one checkbox
    /// line in place (status/due/title/tags). Complete a task with
    /// field=`status`, value=`done`.
    #[tool(
        description = "Update one field of a LifeOS task by note + line (from task_query): field='status' value='done' completes it; also due/title/tags. Rewrites the checkbox line in place."
    )]
    async fn task_update(
        &self,
        Parameters(args): Parameters<TaskUpdateArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.note).await;
        let _write_guard = lock.lock().await;
        let now = chrono::Local::now().date_naive();
        tasks_source::update(&root, &args.note, args.line, &args.field, &args.value, now)
            .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!(
            "updated {} line {} field {}",
            args.note, args.line, args.field
        ))]))
    }

    /// task.produce — the UNIFIED §14.13 write verb over the task source. Same
    /// typed `ProduceOp` union as smart_table_produce, dispatched to TaskSource's
    /// `RecordSink` (set_cell / upsert_rows / delete_rows; field ops unsupported —
    /// tasks have a fixed schema). Rows are addressed by scan index in task_query
    /// order. produce self-persists across the addressed notes. Review-gated.
    #[tool(
        description = "Write to LifeOS tasks with the unified produce verb. `op` (tagged by kind): {kind:\"set_cell\",row,field,value} sets status/due/title/tags on the row-th task from task_query; {kind:\"upsert_rows\",rows:[{title,path?,due?,tags?}]} creates tasks (path = target note, default today's daily); {kind:\"delete_rows\",indices:[..]} removes checkbox lines. add/update/delete_field are unsupported (fixed schema)."
    )]
    async fn task_produce(
        &self,
        Parameters(args): Parameters<TaskProduceArgs>,
    ) -> Result<CallToolResult, McpError> {
        use query::RecordSink;
        let root = vault_root()?;
        let now = chrono::Local::now().date_naive();
        let summary = describe_produce_op(&args.op);
        // Scan the whole vault so row indices match task_query, inject the clock.
        let mut source = tasks_source::TaskSource::load(&root, None).with_today(now);
        // Lock EVERY note this op writes before dispatching — tasks are multi-note,
        // but each note still needs the same write lock the bespoke task_create /
        // task_update hold, or a concurrent single-note write could lose an update.
        // Sorted + deduped so multi-lock acquisition can't deadlock. (Row-index
        // addressing across the earlier task_query call is still a documented TOCTOU
        // — locks bound intra-call safety, not cross-call.)
        let mut notes = source.affected_notes(&args.op, now);
        notes.sort();
        notes.dedup();
        let mut _guards = Vec::with_capacity(notes.len());
        for n in &notes {
            _guards.push(self.vault_write_lock(n).await.lock_owned().await);
        }
        source
            .produce(args.op)
            .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!("task produce {summary}"))]))
    }

    /// calendar.describe — the calendar source's type layer (ADR-002 §14.13
    /// slice 3 — the first product built trait-only: 3 verbs, zero bespoke
    /// per-op tools). Events are one-note-per-event under `calendar/`.
    #[tool(
        description = "Describe the calendar as a queryable RecordSource: fields (path/title/date/start/end/location/tags) and supported operators. Call before calendar_query."
    )]
    async fn calendar_describe(&self) -> Result<CallToolResult, McpError> {
        let body = serde_json::to_string(&calendar_source::describe()).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// calendar.query — structured read over event notes (ADR-002 §14), routed
    /// through the shared kernel query engine — identical contract to
    /// task_query / notes_query, different RecordSource.
    #[tool(
        description = "Query calendar events by date/title/location/tags with a structured filter/sort/group request (e.g. date within:today / this_week). Returns matching events. Call calendar_describe first."
    )]
    async fn calendar_query(
        &self,
        Parameters(args): Parameters<CalendarQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let source = calendar_source::CalendarSource::load(&root);
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

    /// calendar.produce — the UNIFIED §14.13 write verb over event notes. Same
    /// typed `ProduceOp` union as smart_table_produce / task_produce, dispatched
    /// to CalendarSource's `RecordSink`. Rows are addressed by scan index in
    /// calendar_query order. Locks every note the op writes. Review-gated.
    #[tool(
        description = "Write to the calendar with the unified produce verb. `op` (tagged by kind): {kind:\"set_cell\",row,field,value} edits one event field (title/date/start/end/location/tags) on the row-th event from calendar_query; {kind:\"upsert_rows\",rows:[{title,date,start?,end?,location?,tags?}]} creates event notes (date=YYYY-MM-DD); {kind:\"delete_rows\",indices:[..]} deletes event notes. Field ops are unsupported (fixed schema)."
    )]
    async fn calendar_produce(
        &self,
        Parameters(args): Parameters<CalendarProduceArgs>,
    ) -> Result<CallToolResult, McpError> {
        use query::RecordSink;
        let root = vault_root()?;
        let summary = describe_produce_op(&args.op);
        let mut source = calendar_source::CalendarSource::load(&root);
        // Lock every event note this op writes (same posture as task_produce).
        let mut notes = source.affected_notes(&args.op);
        notes.sort();
        notes.dedup();
        let mut _guards = Vec::with_capacity(notes.len());
        for n in &notes {
            _guards.push(self.vault_write_lock(n).await.lock_owned().await);
        }
        source
            .produce(args.op)
            .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
        Ok(CallToolResult::success(vec![Content::text(format!("calendar produce {summary}"))]))
    }

    /// doc.produce — the UNIFIED §14.13 write verb over one markdown note (the
    /// BLOCK profile: sections addressed by ATX heading, the AI-native way to
    /// say "rewrite the Overview section"). Same typed `ProduceOp` union as the
    /// record sources; record ops return Unsupported here (supported_ops works
    /// in both directions). Frontmatter passes through verbatim. Review-gated.
    #[tool(
        description = "Edit one markdown note surgically with the unified produce verb. `op` (tagged by kind): {kind:\"append_section\",heading?,content} appends under the named heading (or end of doc when heading omitted); {kind:\"replace_section\",heading,content} replaces the body under a heading (heading kept); {kind:\"delete_section\",heading} removes a heading + its body incl. nested subsections; {kind:\"set_frontmatter_key\",key,value} / {kind:\"delete_frontmatter_key\",key} edit ONE top-level frontmatter key in place (other keys/comments byte-identical; set creates the block on a plain note). Heading match is case-insensitive on the text after #s; with duplicate headings the FIRST match wins. Call note_map first to see the headings. Prefer this over vault_write — it never rewrites the whole file."
    )]
    async fn doc_produce(
        &self,
        Parameters(args): Parameters<DocProduceArgs>,
    ) -> Result<CallToolResult, McpError> {
        use query::RecordSink;
        let root = vault_root()?;
        let lock = self.vault_write_lock(&args.path).await;
        let _write_guard = lock.lock().await;
        let summary = describe_produce_op(&args.op);
        // Frontmatter ops bypass DocBody (it models the body only): surgical
        // single-key patch at the raw-bytes layer (ADR-002 §1.9 v46 E4).
        match &args.op {
            query::ProduceOp::SetFrontmatterKey { key, value } => {
                vault::patch_frontmatter_key(&root, &args.path, key, Some(value))
                    .map_err(map_vault_err)?;
            }
            query::ProduceOp::DeleteFrontmatterKey { key } => {
                vault::patch_frontmatter_key(&root, &args.path, key, None)
                    .map_err(map_vault_err)?;
            }
            _ => {
                let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
                let mut doc = vault_doc::DocBody::parse(&entry.content);
                doc.produce(args.op)
                    .map_err(|e| McpError::invalid_params(e.to_string(), None))?;
                // write_body, NOT write: raw frontmatter bytes pass through
                // verbatim (key order / comments / quoting), and a plain note
                // without frontmatter stays writable + fm-less.
                vault::write_body(&root, &args.path, &doc.serialize())
                    .map_err(map_vault_err)?;
            }
        }
        Ok(CallToolResult::success(vec![Content::text(format!(
            "doc produce {summary} on {}",
            args.path
        ))]))
    }

    /// note.map — the document map (ADR-002 §1.9 v46 E9): headings tree +
    /// `^block-id` refs + frontmatter keys, so the AI targets `doc_produce`
    /// anchors it can SEE instead of guessing (LRA `vault_get_document_map`
    /// parity, fence-aware).
    #[tool(
        description = "Get a note's document map: headings (level/text/line, code fences excluded), ^block-id refs, and frontmatter keys. Call before doc_produce to pick a real heading anchor."
    )]
    async fn note_map(
        &self,
        Parameters(args): Parameters<VaultPathArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let doc = vault_doc::DocBody::parse(&entry.content);
        let fm_keys: Vec<String> = entry
            .frontmatter
            .as_object()
            .map(|o| o.keys().cloned().collect())
            .unwrap_or_default();
        let body = serde_json::to_string(&serde_json::json!({
            "path": args.path,
            "headings": doc.map_headings(),
            "block_refs": doc.map_block_refs(),
            "frontmatter_keys": fm_keys,
        }))
        .map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// note.get — ONE structured read (ADR-002 §1.9 v46 E10, LRA NoteJson
    /// parity): content + frontmatter + tags + stat + outgoing links +
    /// backlinks in a single call, instead of 3-4 separate gate calls.
    #[tool(
        description = "Read a note with ALL its context in one call: content, frontmatter, tags, stat (mtime/size), outgoing links, and backlinks. Prefer this over vault_read when you also need the note's connections."
    )]
    async fn note_get(
        &self,
        Parameters(args): Parameters<VaultPathArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let entry = vault::read(&root, &args.path).map_err(map_vault_err)?;
        let g = crate::kernel::vault_graph::scan(&root)
            .map_err(|e| McpError::internal_error(format!("note.get: {e}"), None))?;
        let node = g.node_of(&args.path);
        let stat = std::fs::metadata(root.join(&args.path)).ok();
        let body = serde_json::to_string(&serde_json::json!({
            "path": args.path,
            "content": entry.content,
            "frontmatter": entry.frontmatter,
            "tags": node.map(|n| n.tags.clone()).unwrap_or_default(),
            "links": node.map(|n| n.outlinks.clone()).unwrap_or_default(),
            "backlinks": g.backlinks_of(&args.path),
            "stat": stat.map(|m| serde_json::json!({
                "size": m.len(),
                "mtime_ms": m.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64),
            })),
        }))
        .map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// source.describe — GENERIC §14 type layer over ANY installed connector that
    /// declares a `record_source` (ADR-002 §14.12). Loads the manifest, builds
    /// the describe from data — zero per-connector code. This is the product-grade
    /// zero-code path the ghostfolio_* tools prototype; new connectors need no
    /// bespoke gate tools (§7.4/§7.5).
    #[tool(
        description = "Describe an installed connector's queryable records by source_id: fields + operators, read from its manifest record_source. Works for any connector. Call before source_query."
    )]
    async fn source_describe(
        &self,
        Parameters(args): Parameters<SourceDescribeArgs>,
    ) -> Result<CallToolResult, McpError> {
        let spec = load_source_spec(&args.source_id)?;
        let d = manifest_source::ManifestConnectorSource::describe_spec(&spec);
        let body = serde_json::to_string(&d).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// source.query — GENERIC §14 read over an installed connector (ADR-002
    /// §14.12). Resolves creds kernel-side (never the LLM), fetches the
    /// self-hosted instance live from the manifest's declared endpoint, and runs
    /// the SAME shared kernel query engine — identical contract to smart_table /
    /// ghostfolio, but data-driven for any connector.
    #[tool(
        description = "Query an installed connector's records by source_id with a structured filter/sort/group request (not a query string). Fetches the self-hosted instance live from its manifest. Call source_describe first."
    )]
    async fn source_query(
        &self,
        Parameters(args): Parameters<SourceQueryArgs>,
    ) -> Result<CallToolResult, McpError> {
        let (spec, base_url, token) = load_source(&args.source_id)?;
        let source = manifest_source::fetch(&spec, &base_url, &token)
            .await
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
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

    /// source.produce — GENERIC §14 write into an installed connector (ADR-002
    /// §14.12 / §14.9). Builds the request body from the manifest's `produce`
    /// map over the caller's `input`, POSTs to the declared endpoint. Serial +
    /// side-effecting; routed through the gate so it is audited (write approval =
    /// review-gate discipline). Creds kernel-side.
    #[tool(
        description = "Record data into an installed connector by source_id (a write): pass an input object whose keys match the source's produce fields. POSTs to the manifest-declared endpoint and returns the created resource."
    )]
    async fn source_produce(
        &self,
        Parameters(args): Parameters<SourceProduceArgs>,
    ) -> Result<CallToolResult, McpError> {
        let (spec, base_url, token) = load_source(&args.source_id)?;
        let input = args.input.as_object().cloned().unwrap_or_default();
        let created = manifest_source::produce(&spec, &base_url, &token, &input)
            .await
            .map_err(|e| McpError::internal_error(e.to_string(), None))?;
        let body = serde_json::to_string(&created).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// mcp_pack.provision — the generic one-click + silent setup (feature-pack
    /// provision+auth engine): read an installed pack's manifest, bring up its
    /// declared `provision.service` (docker compose) and run its `auth.bootstrap`
    /// (mint + store the credential). Zero manual entry; idempotent. This is what
    /// makes any self-hosted connector one-click — driven by manifest data.
    #[tool(
        description = "Provision + auto-authenticate an installed feature pack from its manifest (one-click, silent): bring up its declared service and run bootstrap auth. Idempotent. Requires a container runtime for service packs."
    )]
    async fn mcp_pack_provision(
        &self,
        Parameters(args): Parameters<McpPackProvisionArgs>,
    ) -> Result<CallToolResult, McpError> {
        let dir = crate::commands::kernel::mcp_dir().map_err(|e| McpError::internal_error(e, None))?;
        let path = dir.join(&args.mcp_id).join("manifest.json");
        let bytes = std::fs::read(&path).map_err(|e| {
            McpError::invalid_params(format!("no installed manifest for {}: {e}", args.mcp_id), None)
        })?;
        let manifest: serde_json::Value = serde_json::from_slice(&bytes).map_err(map_serde_err)?;
        let summary = crate::kernel::pack_provision::install_pack(&args.mcp_id, &manifest)
            .await
            .map_err(|e| McpError::internal_error(e, None))?;
        Ok(CallToolResult::success(vec![Content::text(summary)]))
    }

    /// mcp_pack.validate — the evals gate a brain calls to check a candidate
    /// manifest BEFORE install (mcp-builder review + evals; §7.4/§7.5). Returns a
    /// structured report (ok + issues{field,severity,fix} + a positive
    /// record_source describe eval) the authoring brain self-corrects from — the
    /// quality step home-grown pipelines skip. Read-only: validates, never writes.
    #[tool(
        description = "Evaluate a candidate feature-pack manifest BEFORE install: checks id/version, that it declares actions[] or a §14 record_source, and that any record_source is coherent (parses, has fields + a read endpoint, describe resolves). Returns { ok, issues[{field,severity,fix}] } to self-correct. Call before mcp_pack_install."
    )]
    async fn mcp_pack_validate(
        &self,
        Parameters(args): Parameters<McpPackValidateArgs>,
    ) -> Result<CallToolResult, McpError> {
        let report = crate::kernel::pack_validate::validate_manifest(&args.manifest);
        let body = serde_json::to_string(&report).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// mcp_pack.scaffold — draft a §14 record_source from an OpenAPI read op
    /// (AutoMCP, §7.4). The research: codegen is largely solved, spec quality is
    /// the bottleneck — so this returns a best-effort draft + spec-repair notes
    /// the author refines (edit) then evals (mcp_pack_validate) before install.
    /// Read-only: pure transform, no writes.
    #[tool(
        description = "Draft a §14 record_source from an OpenAPI operation (a GET path returning a list). Returns { record_source, notes } — a best-effort draft (endpoint + array location + fields from the response schema) plus repair notes (auth/missing fields). Refine it, then mcp_pack_validate before install."
    )]
    async fn mcp_pack_scaffold(
        &self,
        Parameters(args): Parameters<McpPackScaffoldArgs>,
    ) -> Result<CallToolResult, McpError> {
        let method = args.method.as_deref().unwrap_or("GET");
        let scaffold = crate::kernel::openapi::record_source_from_openapi(&args.openapi, &args.path, method)
            .ok_or_else(|| {
                McpError::invalid_params(
                    format!("no {} operation at '{}' in the OpenAPI spec", method.to_uppercase(), args.path),
                    None,
                )
            })?;
        let out = serde_json::json!({ "record_source": scaffold.record_source, "notes": scaffold.notes });
        let body = serde_json::to_string(&out).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// mcp_pack.publish — the produce side of share-and-be-shared (§7.6): evals an
    /// installed pack, then POSTs its manifest to a registry/commons. Never
    /// publishes a broken pack (evals first). Registry URL + token resolve
    /// kernel-side (never the LLM); returns the published reference.
    #[tool(
        description = "Publish an installed feature pack to a registry/commons (share-and-be-shared). Evals the manifest first (never publishes a pack with errors — returns the issues to fix), then POSTs it. Returns the published reference {id,namespace,url}."
    )]
    async fn mcp_pack_publish(
        &self,
        Parameters(args): Parameters<McpPackPublishArgs>,
    ) -> Result<CallToolResult, McpError> {
        let manifest = read_installed_manifest(&args.mcp_id)?;
        let (url, token) = resolve_registry_creds(args.registry.as_deref()).ok_or_else(|| {
            McpError::invalid_params(
                "no registry configured — set ctrl:registry:publish_url (+ optional :publish_token)",
                None,
            )
        })?;
        let published = crate::kernel::pack_publish::publish(&manifest, &url, &token)
            .await
            .map_err(|e| match e {
                crate::kernel::pack_publish::PublishError::Blocked(issues) => {
                    // Surface the eval issues so the author fixes them (not published).
                    let detail = serde_json::to_string(&issues).unwrap_or_default();
                    McpError::invalid_params(format!("pack has eval errors, not published: {detail}"), None)
                }
                other => McpError::internal_error(other.to_string(), None),
            })?;
        let body = serde_json::to_string(&published).map_err(map_serde_err)?;
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
        if !args.with_context {
            // Back-compat shape: plain path strings (the PWA consumes this).
            let body = serde_json::to_string(&hits).map_err(map_serde_err)?;
            return Ok(CallToolResult::success(vec![Content::text(body)]));
        }
        // E13 (ADR-002 §1.9 v46): attach ~context_length chars around the first
        // case-insensitive match so the AI can judge relevance without a second
        // read per hit (LRA /search/simple/ contextLength parity).
        let radius = args.context_length.unwrap_or(100);
        let needle = args.query.to_lowercase();
        let rich: Vec<serde_json::Value> = hits
            .into_iter()
            .map(|path| {
                let context = vault::read(&root, &path)
                    .ok()
                    .and_then(|e| snippet_around(&e.content, &needle, radius));
                serde_json::json!({ "path": path, "context": context })
            })
            .collect();
        let body = serde_json::to_string(&rich).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// note.periodic — resolve (and optionally create) the daily / weekly /
    /// monthly / quarterly / yearly note for a date (ADR-002 §1.9 v46 E1).
    /// Daily resolution matches the task source's daily-note convention, so
    /// "add a task to today" and "open today's note" land on the same file.
    #[tool(
        description = "Resolve the periodic note for a date: period=daily/weekly/monthly/quarterly/yearly, date=YYYY-MM-DD (default today). Returns {path, exists, content?, frontmatter?}; create=true seeds it (journal frontmatter) when missing. Use with doc_produce to append to today's daily note."
    )]
    async fn note_periodic(
        &self,
        Parameters(args): Parameters<NotePeriodicArgs>,
    ) -> Result<CallToolResult, McpError> {
        use crate::kernel::periodic_notes;
        let root = vault_root()?;
        let date = match &args.date {
            Some(s) => chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d")
                .map_err(|_| McpError::invalid_params(format!("'{s}' is not YYYY-MM-DD"), None))?,
            None => chrono::Local::now().date_naive(),
        };
        let path = periodic_notes::note_path(args.period, date);
        let lock = self.vault_write_lock(&path).await;
        let _write_guard = lock.lock().await;
        let entry = vault::read(&root, &path).ok();
        let exists = entry.is_some();
        if !exists && args.create {
            vault::write(&root, &path, "", &periodic_notes::seed_frontmatter(args.period))
                .map_err(map_vault_err)?;
        }
        let body = serde_json::to_string(&serde_json::json!({
            "path": path,
            "exists": exists || args.create,
            "content": entry.as_ref().map(|e| e.content.clone()),
            "frontmatter": entry.as_ref().map(|e| e.frontmatter.clone()),
        }))
        .map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// note.recent_changes — most recently modified notes by mtime (ADR-002
    /// §1.9 v46 E12; the "what did I touch lately" recall the LRA ecosystem
    /// had to work around via search).
    #[tool(
        description = "List the most recently modified notes: [{path, mtime_ms}] sorted newest first. Optional days cutoff. Answers \"what did I work on recently\"."
    )]
    async fn note_recent_changes(
        &self,
        Parameters(args): Parameters<NoteRecentChangesArgs>,
    ) -> Result<CallToolResult, McpError> {
        let root = vault_root()?;
        let limit = args.limit.unwrap_or(20);
        let cutoff_ms = args.days.map(|d| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            now.saturating_sub(u64::from(d) * 86_400_000)
        });
        let mut rows: Vec<(String, u64)> = vault::list(&root, None)
            .map_err(map_vault_err)?
            .into_iter()
            .filter_map(|p| {
                let m = std::fs::metadata(root.join(&p)).ok()?;
                let mtime_ms = m
                    .modified()
                    .ok()?
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_millis() as u64;
                if cutoff_ms.is_some_and(|c| mtime_ms < c) {
                    return None;
                }
                Some((p, mtime_ms))
            })
            .collect();
        rows.sort_by_key(|r| std::cmp::Reverse(r.1));
        rows.truncate(limit);
        let out: Vec<serde_json::Value> = rows
            .into_iter()
            .map(|(path, mtime_ms)| serde_json::json!({ "path": path, "mtime_ms": mtime_ms }))
            .collect();
        let body = serde_json::to_string(&out).map_err(map_serde_err)?;
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

    /// mcp.pack_uninstall — remove an installed feature pack (the brain managing
    /// the user's packs, e.g. "uninstall the stocks pack and let's redo it").
    /// Same remove path the PWA uses; errors clearly if the pack isn't installed
    /// so the brain reports "X was not installed" instead of faking success.
    #[tool(description = "Uninstall a feature pack by id (removes it from the user's installed packs)")]
    async fn mcp_pack_uninstall(
        &self,
        Parameters(args): Parameters<McpPackUninstallArgs>,
    ) -> Result<CallToolResult, McpError> {
        let dir = crate::commands::kernel::mcp_dir()
            .map_err(|e| McpError::internal_error(e, None))?;
        crate::commands::kernel::uninstall_from(&dir, &args.mcp_id)
            .map_err(|e| McpError::invalid_params(e, None))?;
        let body = serde_json::to_string(&serde_json::json!({ "uninstalled": args.mcp_id }))
            .map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// mcp.pack_write_file — write a skill / asset file into an installed pack
    /// (the brain shipping the SKILL.md / icon its manifest's cap_asset declares;
    /// install_into carries only manifest + server code). The path stays inside
    /// the pack dir (no traversal). This is how Irisy ships a pack WITH a skill:
    /// install the manifest, then write each declared skill/asset file.
    #[tool(description = "Write a skill or asset file (e.g. skills/<name>/SKILL.md) into an installed feature pack")]
    async fn mcp_pack_write_file(
        &self,
        Parameters(args): Parameters<McpPackWriteFileArgs>,
    ) -> Result<CallToolResult, McpError> {
        let dir = crate::commands::kernel::mcp_dir()
            .map_err(|e| McpError::internal_error(e, None))?;
        crate::commands::kernel::write_pack_file(&dir, &args.mcp_id, &args.path, &args.content)
            .map_err(|e| McpError::invalid_params(e, None))?;
        let body = serde_json::to_string(&serde_json::json!({ "wrote": args.path, "mcp_id": args.mcp_id }))
            .map_err(map_serde_err)?;
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
    /// fetch — it calls only fixed search backends. It first tries any BYOK keyed
    /// provider whose key is in the keychain, in priority order: Tavily
    /// (`tavily`), Brave Search (`brave`), Serper/Google (`serper`), Exa (`exa`).
    /// With no key set it degrades to a keyless FULL-WEB search (DuckDuckGo, then
    /// Wikipedia), so the tool works out of the box and upgrades per key added.
    /// Because it can't reach an arbitrary URL or POST user data anywhere, the
    /// `websearch` domain is first-party-visible without opening `net`.
    #[tool(
        description = "Search the web and return titles + URLs + snippets. Uses a \
BYOK keyed provider if one is configured (Tavily / Brave / Serper / Exa), else a \
keyless full-web fallback (DuckDuckGo, then Wikipedia). Use this for facts / news \
/ research you don't already hold."
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
        // BYOK keyed providers first (Tavily / Brave / Serper / Exa), tried in
        // priority order — the first one whose key is in the keychain and returns
        // hits wins; on its error or empty result we degrade to the next
        // configured key, then to the keyless full-web path (DuckDuckGo → real web
        // + Wikipedia fallback). Keys never leave the kernel (ADR-006 §
        // byok-no-claude — keychain account == provider slug). web_search works
        // keyless out of the box and upgrades per key the user sets; cloud-down on
        // any keyed provider degrades, never hard-fails (derived rule #1).
        let (results, source, note) = match first_keyed_web_search(query, n).await {
            Some((r, src)) => (r, src, ""),
            None => keyless_web_search(query, n).await?,
        };
        let body = serde_json::to_string(&serde_json::json!({
            "source": source,
            "results": results,
            "note": note,
        }))
        .map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// discover.packs — search BOTH the MCP Registry and Smithery for installable
    /// feature packs / MCP servers to reuse (feature-pack creation take-stock
    /// channel ②, ADR-002 substrate § composition §7.4 names both sources). A
    /// CONTROLLED discovery tool like web_search: it only GETs the two fixed
    /// registry endpoints, never a raw fetch, so the `discover` domain is
    /// first-party-visible without opening `net` (ADR-010 § trust-domains, SC3).
    /// Returns one normalized, source-tagged listing merged from both registries.
    #[tool(
        description = "Search the MCP Registry + Smithery (2000+ servers) for \
feature packs / MCP servers to reuse — returns merged, source-tagged listings \
(id, name, description, url, source). Pass `query` to search by keyword (e.g. \
\"stock price\"). Use this when building a feature pack, to find an existing \
server before authoring one."
    )]
    async fn discover_packs(
        &self,
        Parameters(args): Parameters<DiscoverPacksArgs>,
    ) -> Result<CallToolResult, McpError> {
        let body = crate::commands::pack_registry::discover_packs(
            args.query,
            args.limit.unwrap_or(25),
        )
        .await
        .map_err(|e| McpError::internal_error(e, None))?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// discover.skills — search published SKILL.md skills on GitHub (feature-pack
    /// creation take-stock channel ①, ADR-002 substrate § composition §7.4).
    /// Another CONTROLLED discovery tool: it queries only GitHub's fixed
    /// code-search endpoint, never a raw fetch, so the `discover` domain is
    /// first-party-visible without opening `net`. Needs a GitHub PAT in the
    /// keychain; without one it returns a clear setup error (degrade, never
    /// crash — derived rule #1). Reuses the search_skills command core.
    #[tool(
        description = "Search published skills (SKILL.md) on GitHub by keyword — \
returns repo / name / description / stars / url. Use this when building a feature \
pack, to find a reusable skill before writing one. Requires a GitHub token."
    )]
    async fn discover_skills(
        &self,
        Parameters(args): Parameters<DiscoverSkillsArgs>,
    ) -> Result<CallToolResult, McpError> {
        let reply = crate::commands::skills::search_skills(args.query)
            .await
            .map_err(|e| McpError::internal_error(e, None))?;
        let body = serde_json::to_string(&reply).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// skill.list — list the user's LOCAL installed skills (~/.claude/skills +
    /// plugin cache), so the brain can reuse a skill the user already has before
    /// authoring one or searching GitHub (discover_skills). Returns name /
    /// description / path; pass the path to skill_read to see the full SKILL.md.
    #[tool(description = "List the user's local installed skills (name + description + path), optional keyword filter")]
    async fn skill_list(
        &self,
        Parameters(args): Parameters<SkillListArgs>,
    ) -> Result<CallToolResult, McpError> {
        let skills = crate::commands::skills::list_local_skills(args.query)
            .await
            .map_err(|e| McpError::internal_error(e, None))?;
        let body = serde_json::to_string(&skills).map_err(map_serde_err)?;
        Ok(CallToolResult::success(vec![Content::text(body)]))
    }

    /// skill.read — read a local skill's full SKILL.md so the brain can see HOW
    /// the skill works (its steps) before reusing it. Confined to the skill
    /// directories skill_list scans — it cannot read arbitrary files. Pass a
    /// path from skill_list.
    #[tool(description = "Read a local skill's SKILL.md content by its path (from skill_list)")]
    async fn skill_read(
        &self,
        Parameters(args): Parameters<SkillReadArgs>,
    ) -> Result<CallToolResult, McpError> {
        let content = crate::commands::skills::read_local_skill(args.path)
            .await
            .map_err(|e| McpError::invalid_params(e, None))?;
        Ok(CallToolResult::success(vec![Content::text(content)]))
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
// `<server>_<tool>` entries (generic downstream merge; first consumer was the
// retired Obsidian connector, ADR-002 §1.9 v46). This is why Irisy/hermes see
// a connected downstream server's tools directly, not only behind mcp_proxy_*.
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
        let installed = self.runtime.mcp_host.list_installed().await;
        let downstream_ids: Vec<String> = installed.iter().map(|d| d.id.clone()).collect();
        for desc in &installed {
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
        // Source-aware projection: a downstream tool whose namespaced name
        // collides with a first-party prefix/exact name must stay gated as `mcp`
        // (SC3), mirroring `dispatch_tool`'s downstream-first routing.
        tools.retain(|t| intent.allows_tool_with_downstream(t.name.as_ref(), &downstream_ids));
        // Capped-brain curation: the embedded brain (hermes) truncates a long
        // listing to ~25 tools by list order, which silently dropped the entire
        // feature-pack creation suite (it sorts late in declaration order).
        // Project the brain to a curated, ordered allowlist so the creation +
        // research suite is present and FIRST — never truncated away. Only the
        // brain is capped; the PWA keeps the full first-party set (see
        // visibility::BRAIN_TOOLSET).
        if visibility::is_capped_brain(&caller) {
            tools.retain(|t| visibility::brain_tool_rank(t.name.as_ref()).is_some());
            tools.sort_by_key(|t| visibility::brain_tool_rank(t.name.as_ref()).unwrap_or(usize::MAX));
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
        // Source-aware gate: classify a downstream-namespaced tool as `mcp` even
        // when its name collides with a first-party prefix/exact name, so it
        // can't be reached under a narrow first-party intent (SC3). Mirrors the
        // downstream-first routing in `dispatch_tool`.
        let downstream_ids: Vec<String> = self
            .runtime
            .mcp_host
            .list_installed()
            .await
            .into_iter()
            .map(|d| d.id)
            .collect();
        let denied = !intent.allows_tool_with_downstream(&tool_name, &downstream_ids);

        // SC1 compile-time trust boundary: capture the cross-domain call as a
        // `GateRequest` here at the gate, before `request` is consumed. Only the
        // gate can build one — internal traffic has no constructor, so the type
        // system (not convention) keeps kernel self-calls off the ledger.
        let gate_req =
            audit::GateRequest::at_gate(caller, &tool_name, request.arguments.as_ref());

        // Review gate (ADR-002 §264 + ADR-006 §4): high-blast-radius calls
        // (write/delete/command/network-write) need explicit human approval
        // before they run. The confirm the human sees is built HERE from the
        // parsed tool + structured args (never the caller's prose — C3 anti-
        // injection), and approval arrives out-of-band via the Tauri command
        // surface the external brain can't reach. Opt-in (CTRL_REVIEW_GATE=1)
        // until the PWA approval modal is wired; fail-closed on timeout.
        // Scope to EXTERNAL callers (the BYO-CLI brain): first-party app
        // surfaces (pwa/irisy/hermes) are CTRL's own and not the C3 threat.
        let needs_review = !denied
            && review_gate::ReviewGate::enforcing()
            && !visibility::is_first_party(gate_req.caller())
            && review_gate::requires_review(&tool_name);
        let review_denied = if needs_review {
            let summary = summarize_args(request.arguments.as_ref());
            let rx = self
                .runtime
                .review_gate
                .request(gate_req.caller(), &tool_name, summary);
            match tokio::time::timeout(review_gate::REVIEW_TIMEOUT, rx).await {
                Ok(Ok(true)) => false,            // approved
                Ok(Ok(false)) => true,           // denied by human
                Ok(Err(_)) | Err(_) => true,     // dropped or timed out → deny
            }
        } else {
            false
        };

        // Network allowlist (ADR-002 §2): http_get/http_post are the prime
        // exfiltration surface. For EXTERNAL callers (the BYO-CLI brain /
        // packs), enforce the caller's declared network allowlist on the
        // target URL — fail-closed, so a caller can only reach hosts it
        // declared. First-party app surfaces (pwa/irisy/hermes) are NOT bound
        // here: Irisy's web search/fetch goes through the scoped `web_search`
        // (domain `websearch`, first-party), never these raw net tools, so its
        // search + data-fetch capability is untouched.
        let net_denied = !denied
            && matches!(tool_name.as_str(), "http_get" | "http_post")
            && !visibility::is_first_party(gate_req.caller())
            && {
                let url = request
                    .arguments
                    .as_ref()
                    .and_then(|m| m.get("url"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let method = if tool_name == "http_post" { "POST" } else { "GET" };
                let cap = crate::kernel::capability_resolver::resolve_for_mcp(gate_req.caller());
                !crate::kernel::capability_resolver::network_authorizes(&cap, url, method)
            };

        let result = if denied {
            Err(McpError::invalid_request(
                format!("tool '{tool_name}' is out of scope for the declared intent"),
                None,
            ))
        } else if review_denied {
            Err(McpError::invalid_request(
                format!("tool '{tool_name}' denied at the review gate (no approval)"),
                None,
            ))
        } else if net_denied {
            Err(McpError::invalid_request(
                format!(
                    "tool '{tool_name}' target is not in the caller's declared network allowlist (exfil control, ADR-002 §2)"
                ),
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

/// Resolve the gate's Bearer token, STABLE across kernel reboots.
///
/// The token used to be a fresh `Uuid::new_v4()` per boot. That broke the
/// embedded brain: hermes is a long-lived process that registers the gate as an
/// MCP server BY NAME ("ctrl") and is idempotent — it will not re-register a
/// name it already knows. So after any kernel restart (frequent under
/// `tauri dev`'s file-watcher), hermes kept its cached connection carrying the
/// OLD token; every gate call then 401'd and the brain silently saw ZERO CTRL
/// tools (verified on real hardware 2026-06-28: the gate returns 24 tools to a
/// fresh client, but the live hermes never reconnected). The per-boot rotation
/// also left the BYO-CLI `.mcp.json` pinned to a dead token.
///
/// Persisting the token in `~/.ctrl/state/gate-token` (mode 0600) keeps hermes's
/// cached registration and the projected `.mcp.json` valid across reboots. It is
/// a loopback-only, single-user secret; the file is owner-read/write only.
fn resolve_stable_gate_token() -> String {
    let path = std::env::var_os("HOME").map(|home| {
        std::path::PathBuf::from(home)
            .join(".ctrl")
            .join("state")
            .join("gate-token")
    });
    if let Some(path) = &path {
        if let Ok(existing) = std::fs::read_to_string(path) {
            let trimmed = existing.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    let token = Uuid::new_v4().to_string();
    if let Some(path) = &path {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(path, &token).is_ok() {
            // Owner-only perms — the token authorizes every gate call.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
    token
}

/// Build the axum router with auth middleware + spawn the listener.
/// Returns the handle holding the stable auth token; the accept loop
/// runs as a tokio task spawned on the current runtime.
pub async fn serve(
    runtime: Arc<KernelRuntime>,
    local_storage: Option<Arc<LocalStorage>>,
    addr: &str,
) -> Result<McpServerHandle> {
    let token = Arc::new(resolve_stable_gate_token());
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

/// ~`radius` chars of context around the first case-insensitive occurrence of
/// `needle_lower` (pre-lowercased) in `content`, char-boundary safe. None when
/// the needle is absent (e.g. an FTS stem matched but the literal didn't).
fn snippet_around(content: &str, needle_lower: &str, radius: usize) -> Option<String> {
    let lower = content.to_lowercase();
    let at = lower.find(needle_lower)?;
    // Map the byte offset in the lowered string back to the source string
    // conservatively: lowercasing can change byte lengths (rare, non-ASCII),
    // so clamp to the nearest char boundary in the source.
    let start = at.saturating_sub(radius);
    let end = (at + needle_lower.len() + radius).min(content.len());
    let start = (0..=start.min(content.len())).rev().find(|&i| content.is_char_boundary(i))?;
    let end = (end..=content.len()).find(|&i| content.is_char_boundary(i))?;
    let mut s = content[start..end].trim().to_string();
    if start > 0 {
        s = format!("…{s}");
    }
    if end < content.len() {
        s = format!("{s}…");
    }
    Some(s)
}

/// A short human summary of a produce op for the gate's success message + audit
/// trail (the op itself is structured; this is just the log line).
fn describe_produce_op(op: &query::ProduceOp) -> String {
    match op {
        query::ProduceOp::SetCell { row, field, .. } => format!("set_cell row {row} field {field}"),
        query::ProduceOp::UpsertRows { rows } => format!("upsert_rows ({} rows)", rows.len()),
        query::ProduceOp::DeleteRows { indices } => {
            format!("delete_rows ({} rows)", indices.len())
        }
        query::ProduceOp::AddField { key, .. } => format!("add_field {key}"),
        query::ProduceOp::UpdateField { key, .. } => format!("update_field {key}"),
        query::ProduceOp::DeleteField { key } => format!("delete_field {key}"),
        query::ProduceOp::AppendSection { heading, .. } => format!(
            "append_section {}",
            heading.as_deref().unwrap_or("(end of doc)")
        ),
        query::ProduceOp::ReplaceSection { heading, .. } => format!("replace_section {heading}"),
        query::ProduceOp::DeleteSection { heading } => format!("delete_section {heading}"),
        query::ProduceOp::SetFrontmatterKey { key, .. } => format!("set_frontmatter_key {key}"),
        query::ProduceOp::DeleteFrontmatterKey { key } => {
            format!("delete_frontmatter_key {key}")
        }
    }
}

/// Patch the frontmatter `schema:` array IN PLACE for a schema-mutating produce
/// op (§14.13). Row-only ops are a no-op. In-place (vs full-regenerate) preserves
/// render-level type sugar + extra keys on untouched columns; the just-mutated
/// `table` supplies the fresh item shape for add / flow-string fallback.
fn patch_schema_in_place(
    frontmatter: &mut serde_json::Value,
    op: &query::ProduceOp,
    table: &vault_smart_table::SmartTable,
) -> Result<(), McpError> {
    let (key_is_schema, target_key) = match op {
        query::ProduceOp::AddField { key, .. }
        | query::ProduceOp::UpdateField { key, .. }
        | query::ProduceOp::DeleteField { key } => (true, key.as_str()),
        _ => (false, ""),
    };
    if !key_is_schema {
        return Ok(());
    }
    let obj = frontmatter
        .as_object_mut()
        .ok_or_else(|| McpError::internal_error("frontmatter not an object", None))?;
    let arr = obj
        .entry("schema")
        .or_insert_with(|| serde_json::Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| McpError::internal_error("frontmatter `schema` not an array", None))?;
    match op {
        query::ProduceOp::AddField { key, .. } => {
            // The field was just added to `table`; emit its item shape (base type
            // is correct — a brand-new column has no prior render-level type).
            if let Some(item) = table.serialize_field(key) {
                arr.push(item);
            }
        }
        query::ProduceOp::DeleteField { .. } => {
            arr.retain(|it| {
                vault_smart_table::schema_item_key(it).as_deref() != Some(target_key)
            });
        }
        query::ProduceOp::UpdateField { key, label, cell_type, options } => {
            let pos = arr.iter().position(|it| {
                vault_smart_table::schema_item_key(it).as_deref() == Some(key.as_str())
            });
            match pos.and_then(|p| arr[p].as_object_mut()) {
                // Object item → patch only the provided keys (render-level type of
                // an UNchanged column survives).
                Some(item) => {
                    if let Some(l) = label {
                        item.insert("label".into(), serde_json::json!(l));
                    }
                    if let Some(t) = cell_type {
                        item.insert("type".into(), serde_json::to_value(t).unwrap_or(serde_json::Value::Null));
                    }
                    if let Some(o) = options {
                        item.insert("options".into(), serde_json::json!(o));
                    }
                }
                // Legacy flow-string item (or missing) → best-effort rebuild from
                // the mutated table (order preserved when the slot exists).
                None => {
                    if let Some(fresh) = table.serialize_field(key) {
                        match pos {
                            Some(p) => arr[p] = fresh,
                            None => arr.push(fresh),
                        }
                    }
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Slugify a table title into a filename stem (ASCII lowercase alnum, `-`
/// separated). Non-ASCII (e.g. CJK) titles collapse to `table` — the title stays
/// verbatim in frontmatter; only the file stem is ASCII (mirrors the front end's
/// `createSmartTable`).
fn slugify(name: &str) -> String {
    let slug = name
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "table".to_string()
    } else {
        slug
    }
}

/// A free `tables/<slug>.md` path (never overwrite an existing table — append a
/// counter, like the front end's `uniqueTablePath`).
fn unique_table_path(root: &std::path::Path, slug: &str) -> String {
    if !root.join(format!("tables/{slug}.md")).exists() {
        return format!("tables/{slug}.md");
    }
    for n in 2..10_000 {
        let candidate = format!("tables/{slug}-{n}.md");
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("tables/{slug}-{}.md", std::process::id())
}


/// Read an installed connector's manifest from disk (`~/.ctrl/mcps/<id>/`).
fn read_installed_manifest(source_id: &str) -> Result<serde_json::Value, McpError> {
    let dir = crate::commands::kernel::mcp_dir().map_err(|e| McpError::internal_error(e, None))?;
    let path = dir.join(source_id).join("manifest.json");
    let bytes = std::fs::read(&path).map_err(|e| {
        McpError::invalid_params(format!("no installed manifest for {source_id}: {e}"), None)
    })?;
    serde_json::from_slice(&bytes).map_err(map_serde_err)
}

/// Build a connector's §14 spec from its installed manifest (`record_source` +
/// reused `auth.token_exchange`). Creds not needed — describe is the type layer.
fn load_source_spec(source_id: &str) -> Result<manifest_source::RecordSourceSpec, McpError> {
    let manifest = read_installed_manifest(source_id)?;
    manifest_source::spec_from_manifest(&manifest).ok_or_else(|| {
        McpError::invalid_params(format!("{source_id} declares no record_source"), None)
    })
}

/// Registry creds for publish (§7.6): endpoint (call override → env → configured
/// `ctrl:registry:publish_url`) + optional bearer token (`:publish_token`). Env
/// override lets tests + power users target a specific registry. Kernel-side.
fn resolve_registry_creds(registry_override: Option<&str>) -> Option<(String, String)> {
    let from_env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    let cred = |field: &str| {
        crate::shell::credential_vault::get(&format!("ctrl:registry:{field}"))
            .ok()
            .flatten()
            .filter(|v| !v.trim().is_empty())
    };
    let url = registry_override
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .or_else(|| from_env("CTRL_REGISTRY_PUBLISH_URL"))
        .or_else(|| cred("publish_url"))?;
    let token = from_env("CTRL_REGISTRY_PUBLISH_TOKEN")
        .or_else(|| cred("publish_token"))
        .unwrap_or_default();
    Some((url, token))
}

/// Generic connector creds: base URL (provision-set `_base_url` → configured
/// `base_url`) + the security token stored under the manifest's declared
/// `send_secret`. Kernel-side only; the token never crosses the LLM boundary.
fn resolve_pack_creds(source_id: &str, send_secret: &str) -> Option<(String, String)> {
    let cred = |field: &str| {
        crate::shell::credential_vault::get(&format!("mcp:{source_id}:{field}"))
            .ok()
            .flatten()
            .filter(|v| !v.trim().is_empty())
    };
    let url = cred("_base_url").or_else(|| cred("base_url"))?;
    let token = cred(send_secret)?;
    Some((url, token))
}

/// Load a connector's spec + resolved creds for a live read/write. Bundles the
/// two so `source_query` / `source_produce` share one manifest read.
fn load_source(
    source_id: &str,
) -> Result<(manifest_source::RecordSourceSpec, String, String), McpError> {
    let manifest = read_installed_manifest(source_id)?;
    let spec = manifest_source::spec_from_manifest(&manifest).ok_or_else(|| {
        McpError::invalid_params(format!("{source_id} declares no record_source"), None)
    })?;
    let send_secret = manifest_source::send_secret_of(&manifest).unwrap_or_else(|| "token".into());
    let (base_url, token) = resolve_pack_creds(source_id, &send_secret).ok_or_else(|| {
        McpError::invalid_params(
            format!("{source_id} not configured — provision or set its credentials (mcp:{source_id}:_base_url / :{send_secret})"),
            None,
        )
    })?;
    Ok((spec, base_url, token))
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

/// BYOK web-search providers in priority order (ADR-006 § byok-no-claude v1).
/// The keychain account slug IS the provider name — a user upgrades web_search by
/// storing a key under any of these (same place as the Tavily key). Returns the
/// first configured provider's non-empty results tagged with its slug, or None
/// when no key is set / every keyed attempt errors or is empty — the caller then
/// degrades to the keyless path. Cloud-down on one provider falls through to the
/// next, never hard-fails (derived rule #1).
async fn first_keyed_web_search(
    query: &str,
    n: u32,
) -> Option<(Vec<serde_json::Value>, &'static str)> {
    const PROVIDERS: &[&str] = &["tavily", "brave", "serper", "exa"];
    for &slug in PROVIDERS {
        let Some(key) = crate::kernel::provider::registry::read_credential(slug)
            .filter(|k| !k.is_empty())
        else {
            continue;
        };
        let attempt = match slug {
            "tavily" => tavily_search(&key, query, n).await,
            "brave" => brave_search(&key, query, n).await,
            "serper" => serper_search(&key, query, n).await,
            "exa" => exa_search(&key, query, n).await,
            _ => continue,
        };
        if let Ok(hits) = attempt {
            if !hits.is_empty() {
                return Some((hits, slug));
            }
        }
        // configured but errored / empty — degrade to the next configured provider
    }
    None
}

/// web.search backend — Brave Search API (BYOK, keychain account `brave`). GETs
/// only the fixed Brave endpoint with the key in the X-Subscription-Token header;
/// the key never leaves the kernel. Returns [{title,url,snippet}].
async fn brave_search(key: &str, query: &str, n: u32) -> Result<Vec<serde_json::Value>, McpError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| McpError::internal_error(format!("search client build: {e}"), None))?;
    let count = n.to_string();
    let resp = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .query(&[("q", query), ("count", count.as_str())])
        .header("X-Subscription-Token", key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| McpError::internal_error(format!("brave fetch: {e}"), None))?;
    if !resp.status().is_success() {
        return Err(McpError::internal_error(
            format!("brave search: HTTP {}", resp.status()),
            None,
        ));
    }
    let j: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| McpError::internal_error(format!("brave parse: {e}"), None))?;
    Ok(map_brave_results(&j, n))
}

/// web.search backend — Serper.dev (Google results, BYOK, keychain account
/// `serper`). POSTs only the fixed Serper endpoint with the key in the X-API-KEY
/// header; the key never leaves the kernel. Returns [{title,url,snippet}].
async fn serper_search(key: &str, query: &str, n: u32) -> Result<Vec<serde_json::Value>, McpError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| McpError::internal_error(format!("search client build: {e}"), None))?;
    let resp = client
        .post("https://google.serper.dev/search")
        .header("X-API-KEY", key)
        .json(&serde_json::json!({ "q": query, "num": n }))
        .send()
        .await
        .map_err(|e| McpError::internal_error(format!("serper fetch: {e}"), None))?;
    if !resp.status().is_success() {
        return Err(McpError::internal_error(
            format!("serper search: HTTP {}", resp.status()),
            None,
        ));
    }
    let j: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| McpError::internal_error(format!("serper parse: {e}"), None))?;
    Ok(map_serper_results(&j, n))
}

/// web.search backend — Exa (neural search, BYOK, keychain account `exa`). POSTs
/// only the fixed Exa endpoint with the key in the x-api-key header; the key
/// never leaves the kernel. Asks for text contents so results carry a snippet.
async fn exa_search(key: &str, query: &str, n: u32) -> Result<Vec<serde_json::Value>, McpError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| McpError::internal_error(format!("search client build: {e}"), None))?;
    let resp = client
        .post("https://api.exa.ai/search")
        .header("x-api-key", key)
        .json(&serde_json::json!({
            "query": query,
            "numResults": n,
            "contents": { "text": { "maxCharacters": 300 } },
        }))
        .send()
        .await
        .map_err(|e| McpError::internal_error(format!("exa fetch: {e}"), None))?;
    if !resp.status().is_success() {
        return Err(McpError::internal_error(
            format!("exa search: HTTP {}", resp.status()),
            None,
        ));
    }
    let j: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| McpError::internal_error(format!("exa parse: {e}"), None))?;
    Ok(map_exa_results(&j, n))
}

/// Map a Brave web-search response to [{title,url,snippet}]. Brave nests hits
/// under `web.results[]` with a `description` snippet. Pure — unit-tested.
fn map_brave_results(j: &serde_json::Value, n: u32) -> Vec<serde_json::Value> {
    j["web"]["results"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .take(n as usize)
                .map(|r| {
                    serde_json::json!({
                        "title": r["title"],
                        "url": r["url"],
                        "snippet": r["description"],
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Map a Serper response to [{title,url,snippet}]. Serper returns Google organic
/// hits under `organic[]` with `link` + `snippet`. Pure — unit-tested.
fn map_serper_results(j: &serde_json::Value, n: u32) -> Vec<serde_json::Value> {
    j["organic"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .take(n as usize)
                .map(|r| {
                    serde_json::json!({
                        "title": r["title"],
                        "url": r["link"],
                        "snippet": r["snippet"],
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Map an Exa response to [{title,url,snippet}]. Exa returns hits under
/// `results[]` with a `text` field (requested via contents). Pure — unit-tested.
fn map_exa_results(j: &serde_json::Value, n: u32) -> Vec<serde_json::Value> {
    j["results"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .take(n as usize)
                .map(|r| {
                    serde_json::json!({
                        "title": r["title"],
                        "url": r["url"],
                        "snippet": r["text"],
                    })
                })
                .collect()
        })
        .unwrap_or_default()
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

/// Keyless full-web search via DuckDuckGo's lite endpoint (scraped HTML — the
/// same source the ddgs library uses; ADR-002 § brain v37 verified ddgs on real
/// hardware). No API key, returns real web results (github / products / API
/// docs), so Irisy's reach isn't limited to GitHub + the MCP registry.
/// Best-effort: returns whatever it parses; the caller falls back to Wikipedia.
async fn duckduckgo_search(query: &str, n: u32) -> Result<Vec<serde_json::Value>, McpError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| McpError::internal_error(format!("search client build: {e}"), None))?;
    let resp = client
        .get("https://lite.duckduckgo.com/lite/")
        .query(&[("q", query)])
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)",
        )
        .send()
        .await
        .map_err(|e| McpError::internal_error(format!("duckduckgo fetch: {e}"), None))?;
    if !resp.status().is_success() {
        return Err(McpError::internal_error(
            format!("duckduckgo search: HTTP {}", resp.status()),
            None,
        ));
    }
    let html = resp
        .text()
        .await
        .map_err(|e| McpError::internal_error(format!("duckduckgo read: {e}"), None))?;
    Ok(parse_ddg_lite(&html, n as usize))
}

/// Percent-decode a URL-encoded string (`%3A` -> `:`, `+` -> space). Bytes that
/// aren't valid `%XX` pass through verbatim; the result is UTF-8 lossy-decoded.
/// Small enough to avoid pulling in a percent-encoding crate.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolve a DuckDuckGo lite href into the real target URL. Lite wraps every
/// result in a redirect: `//duckduckgo.com/l/?uddg=<percent-encoded-url>&rut=…`
/// (the `&` is `&amp;` in the raw HTML). Pull out `uddg` and decode it; pass
/// direct `http(s)` hrefs through unchanged. Returns None for anything else
/// (relative nav, JS, ad slots without a real target).
fn ddg_real_url(href: &str) -> Option<String> {
    if href.starts_with("http://") || href.starts_with("https://") {
        return Some(href.to_string());
    }
    let key = "uddg=";
    let start = href.find(key)? + key.len();
    let rest = &href[start..];
    // Value ends at the next param separator (`&amp;` in raw HTML, or a bare `&`).
    let end = rest.find("&amp;").or_else(|| rest.find('&')).unwrap_or(rest.len());
    let decoded = percent_decode(&rest[..end]);
    (decoded.starts_with("http://") || decoded.starts_with("https://")).then_some(decoded)
}

/// Parse DuckDuckGo lite result anchors into {title, url, snippet}. Lite renders
/// each hit as `<a rel="nofollow" href="//duckduckgo.com/l/?uddg=…" class="result-link">
/// TITLE</a>` — the href is a redirect wrapper, resolved via `ddg_real_url`. Pure +
/// testable, so the scrape contract is pinned by a unit test without a network call.
fn parse_ddg_lite(html: &str, n: usize) -> Vec<serde_json::Value> {
    let re = match regex::Regex::new(
        r#"(?s)<a\b[^>]*\bhref="([^"]+)"[^>]*\bclass=['"]?result-link['"]?[^>]*>(.*?)</a>"#,
    ) {
        Ok(re) => re,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for cap in re.captures_iter(html) {
        let raw_href = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let Some(url) = ddg_real_url(raw_href) else {
            continue;
        };
        // Skip DuckDuckGo's own ad / internal endpoints.
        if url.contains("duckduckgo.com/y.js") || url.contains("duckduckgo.com/l/") {
            continue;
        }
        let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        let title = title.trim();
        if title.is_empty() {
            continue;
        }
        out.push(serde_json::json!({ "title": title, "url": url, "snippet": "" }));
        if out.len() >= n {
            break;
        }
    }
    out
}

/// Keyless full-web search: DuckDuckGo (real web) first, Wikipedia as the final
/// fallback (DDG unreachable / scrape returned nothing). Returns
/// (results, source, note) for web_search's response.
async fn keyless_web_search(
    query: &str,
    n: u32,
) -> Result<(Vec<serde_json::Value>, &'static str, &'static str), McpError> {
    match duckduckgo_search(query, n).await {
        Ok(r) if !r.is_empty() => Ok((
            r,
            "duckduckgo",
            "Keyless full-web search via DuckDuckGo. Set a Tavily key for higher-quality results.",
        )),
        _ => Ok((
            wikipedia_search(query, n).await?,
            "wikipedia",
            "DuckDuckGo returned nothing; degraded to keyless Wikipedia (encyclopedic only).",
        )),
    }
}

/// Shared executor for http.get + http.post. Single reqwest::Client
/// per call (cheap; reqwest pools internally). Returns a JSON string
/// that the MCP caller parses: `{ status: u16, body: String, headers: {} }`.
/// Errors map to McpError::internal_error with the underlying message
/// so creator-side debugging is straightforward.
/// Build the human-facing review summary GATE-SIDE from the structured
/// call arguments (ADR-002 §264 review gate, C3 anti-injection). Each
/// argument renders as `key=value` with values capped so a huge body can't
/// flood the modal; the human reads this, never the caller's prose. Keys
/// are sorted for a stable, predictable display.
fn summarize_args(args: Option<&serde_json::Map<String, serde_json::Value>>) -> String {
    let Some(map) = args else {
        return "(no arguments)".to_string();
    };
    if map.is_empty() {
        return "(no arguments)".to_string();
    }
    let mut keys: Vec<&String> = map.keys().collect();
    keys.sort();
    let mut parts = Vec::new();
    for k in keys {
        let v = &map[k];
        let rendered = match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        let capped: String = if rendered.chars().count() > 80 {
            let head: String = rendered.chars().take(80).collect();
            format!("{head}… ({} chars)", rendered.chars().count())
        } else {
            rendered
        };
        parts.push(format!("{k}={capped}"));
    }
    parts.join(", ")
}

/// SSRF / internal-egress floor for the kernel HTTP tools (ADR-002 §2:335
/// "network http (allowlist-bound)"). The pack shell is already network-
/// denied by the sandbox (ADR-004 §1); `http_get`/`http_post` are the only
/// network egress left, so they must not be turnable into a pivot into the
/// loopback / cloud-metadata / private LAN surface. Per-URL *allowlist*
/// binding is per-pack (manifest `capabilities.network.http.allowlist`) and
/// awaits the pack-context-on-call wiring; this is the caller-agnostic
/// deny-floor that holds regardless.
///
/// Rejects: loopback, link-local (incl. 169.254.169.254 metadata),
/// RFC1918 / unique-local private ranges, and the `localhost` / `*.local`
/// hostnames — checked against EVERY address the host resolves to.
fn guard_egress(url: &str) -> Result<(), McpError> {
    use std::net::{IpAddr, ToSocketAddrs};

    let parsed = reqwest::Url::parse(url)
        .map_err(|e| McpError::invalid_params(format!("http: bad url '{url}': {e}"), None))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(McpError::invalid_params(
                format!("http: scheme '{other}' not allowed (http/https only)"),
                None,
            ))
        }
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| McpError::invalid_params("http: url has no host".to_string(), None))?;
    // host_str keeps brackets on IPv6 literals ("[::1]"); strip for parsing.
    let host_bare = host.trim_start_matches('[').trim_end_matches(']');
    let lower = host_bare.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".local") || lower.ends_with(".internal") {
        return Err(McpError::invalid_params(
            format!("http: host '{host}' is internal — egress denied"),
            None,
        ));
    }

    let blocked = |ip: &IpAddr| -> bool {
        match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4.is_broadcast()
                    || v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64 // 100.64/10 CGNAT
            }
            IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    || (v6.segments()[0] & 0xffc0) == 0xfe80 // link-local
                    || (v6.segments()[0] & 0xfe00) == 0xfc00 // unique-local
                    || v6.to_ipv4_mapped().map(|m| m.is_loopback() || m.is_private()).unwrap_or(false)
            }
        }
    };

    // IP literal → check directly; hostname → resolve and check every
    // address it lands on (DNS-rebind floor).
    let port = parsed.port_or_known_default().unwrap_or(443);
    let addrs: Vec<IpAddr> = if let Ok(ip) = host_bare.parse::<IpAddr>() {
        vec![ip]
    } else {
        (host_bare, port)
            .to_socket_addrs()
            .map_err(|e| McpError::invalid_params(format!("http: resolve '{host}': {e}"), None))?
            .map(|sa| sa.ip())
            .collect()
    };
    if addrs.is_empty() || addrs.iter().any(blocked) {
        return Err(McpError::invalid_params(
            "http: host resolves to an internal address — egress denied".to_string(),
            None,
        ));
    }
    Ok(())
}

async fn http_request(
    method: reqwest::Method,
    url: String,
    headers: std::collections::BTreeMap<String, String>,
    body: Option<serde_json::Value>,
    timeout_ms: Option<u64>,
) -> Result<String, McpError> {
    guard_egress(&url)?;
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(30_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        // Follow redirects (many APIs http→https), but re-check every hop so
        // an allowlisted host can't 30x-redirect into the internal surface
        // guard_egress just cleared.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 10 {
                return attempt.stop();
            }
            match guard_egress(attempt.url().as_str()) {
                Ok(()) => attempt.follow(),
                Err(_) => attempt.stop(),
            }
        }))
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
    use crate::kernel::query::RecordSink;
    use crate::kernel::runtime::KernelRuntime;

    // ── §14.13 unified produce: in-place schema patch preserves rich per-item
    // keys the kernel model doesn't know about (ai_prompt / color_op / system /
    // min-max — written by the frontend serializeSmartTable). A schema-mutating
    // produce must NOT strip these off untouched columns (markdown = truth).
    fn rich_frontmatter() -> serde_json::Value {
        serde_json::json!({
            "schema": [
                { "key": "id", "label": "ID", "type": "text", "system": true },
                { "key": "amount", "label": "Amount", "type": "currency", "symbol": "$", "min": 0, "max": 1000 },
                { "key": "stage", "label": "Stage", "type": "select", "options": ["new", "won"],
                  "ai_op": "classify", "ai_prompt": "pick a stage", "color_op": "eq", "color_value": "won", "color_bg": "#0f0" }
            ]
        })
    }

    fn schema_item<'a>(fm: &'a serde_json::Value, key: &str) -> &'a serde_json::Map<String, serde_json::Value> {
        fm["schema"]
            .as_array()
            .unwrap()
            .iter()
            .find(|it| it["key"] == key)
            .unwrap_or_else(|| panic!("no schema item '{key}'"))
            .as_object()
            .unwrap()
    }

    #[test]
    fn produce_add_field_preserves_sibling_rich_keys() {
        let mut fm = rich_frontmatter();
        let mut table = vault_smart_table::SmartTable::parse(&fm, "");
        let op = query::ProduceOp::AddField {
            key: "owner".into(),
            label: "Owner".into(),
            cell_type: query::CellType::Text,
            options: None,
            relation: None,
        };
        table.produce(op.clone()).unwrap();
        patch_schema_in_place(&mut fm, &op, &table).unwrap();
        // New column appended…
        assert_eq!(schema_item(&fm, "owner")["type"], "text");
        // …and EVERY rich key on siblings survives verbatim.
        assert_eq!(schema_item(&fm, "amount")["type"], "currency");
        assert_eq!(schema_item(&fm, "amount")["symbol"], "$");
        assert_eq!(schema_item(&fm, "amount")["max"], 1000);
        assert_eq!(schema_item(&fm, "stage")["ai_prompt"], "pick a stage");
        assert_eq!(schema_item(&fm, "stage")["color_bg"], "#0f0");
        assert_eq!(schema_item(&fm, "id")["system"], true);
    }

    #[test]
    fn produce_update_field_patches_only_named_keys() {
        let mut fm = rich_frontmatter();
        let mut table = vault_smart_table::SmartTable::parse(&fm, "");
        // Rename the amount column's label only — its currency/symbol/min/max stay.
        let op = query::ProduceOp::UpdateField {
            key: "amount".into(),
            label: Some("Deal Size".into()),
            cell_type: None,
            options: None,
        };
        table.produce(op.clone()).unwrap();
        patch_schema_in_place(&mut fm, &op, &table).unwrap();
        let amt = schema_item(&fm, "amount");
        assert_eq!(amt["label"], "Deal Size");
        assert_eq!(amt["type"], "currency", "type sugar NOT downgraded");
        assert_eq!(amt["symbol"], "$");
        assert_eq!(amt["min"], 0);
        assert_eq!(amt["max"], 1000);
    }

    #[test]
    fn produce_delete_field_keeps_other_items_verbatim() {
        let mut fm = rich_frontmatter();
        let mut table = vault_smart_table::SmartTable::parse(&fm, "");
        let op = query::ProduceOp::DeleteField { key: "stage".into() };
        table.produce(op.clone()).unwrap();
        patch_schema_in_place(&mut fm, &op, &table).unwrap();
        let arr = fm["schema"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert!(arr.iter().all(|it| it["key"] != "stage"));
        // The surviving currency column keeps its full config.
        assert_eq!(schema_item(&fm, "amount")["symbol"], "$");
    }

    #[test]
    fn produce_row_ops_leave_schema_untouched() {
        let mut fm = rich_frontmatter();
        let before = fm["schema"].clone();
        let table = vault_smart_table::SmartTable::parse(&fm, "");
        let op = query::ProduceOp::SetCell { row: 0, field: "amount".into(), value: "5".into() };
        patch_schema_in_place(&mut fm, &op, &table).unwrap();
        assert_eq!(fm["schema"], before, "row-only op must not touch the schema");
    }

    #[test]
    fn snippet_around_clamps_and_marks_ellipses() {
        let content = "aaaa needle bbbb";
        // Full string within radius: no ellipses.
        assert_eq!(snippet_around(content, "needle", 100).unwrap(), "aaaa needle bbbb");
        // Tight radius: both ellipses.
        let s = snippet_around(&format!("{}needle{}", "x".repeat(300), "y".repeat(300)), "needle", 10).unwrap();
        assert!(s.starts_with('…') && s.ends_with('…') && s.contains("needle"));
        // Case-insensitive (needle passed pre-lowered).
        assert!(snippet_around("Has NEEDLE here", "needle", 50).is_some());
        // Absent needle → None.
        assert!(snippet_around("nothing", "needle", 50).is_none());
        // Non-ASCII neighbors: char-boundary safe (must not panic).
        let cjk_adjacent = "\u{4f60}\u{597d}needle\u{4e16}\u{754c}";
        assert!(snippet_around(cjk_adjacent, "needle", 1).is_some());
    }

    #[test]
    fn parse_ddg_lite_extracts_real_web_results() {
        // REAL DuckDuckGo lite shape (verified against live HTML 2026-06-28):
        // every href is a redirect wrapper `//duckduckgo.com/l/?uddg=<encoded>&amp;rut=…`,
        // protocol-relative, with `&amp;`-separated params — NOT a direct link.
        let html = r#"
            <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fghostfolio%2Fghostfolio&amp;rut=abc123" class="result-link">Ghostfolio on GitHub</a>
            <td class='result-snippet'>open source wealth</td>
            <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fghostfol.io%2F&amp;rut=def456" class="result-link">Ghostfolio site</a>
            <a href="https://duckduckgo.com/y.js?ad=1" class='result-link'>sponsored ad</a>
        "#;
        let out = parse_ddg_lite(html, 5);
        // Both real web results parsed (github + product site), redirect unwrapped
        // and percent-decoded — Irisy isn't limited to GitHub-only / encyclopedic.
        assert!(out.len() >= 2, "expected >=2 results, got {}", out.len());
        assert_eq!(out[0]["url"], "https://github.com/ghostfolio/ghostfolio");
        assert_eq!(out[0]["title"], "Ghostfolio on GitHub");
        assert_eq!(out[1]["url"], "https://ghostfol.io/");
        // The y.js ad slot (no real uddg target) is dropped.
        assert!(out.iter().all(|r| !r["url"].as_str().unwrap().contains("y.js")));
        // The cap is honored.
        assert!(parse_ddg_lite(html, 1).len() == 1);
    }

    #[test]
    fn ddg_real_url_unwraps_redirect_and_decodes() {
        assert_eq!(
            ddg_real_url("//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.twenty.com%2F&amp;rut=x"),
            Some("https://docs.twenty.com/".to_string())
        );
        // Direct links pass through.
        assert_eq!(
            ddg_real_url("https://example.com/a?b=c"),
            Some("https://example.com/a?b=c".to_string())
        );
        // No real target -> None.
        assert_eq!(ddg_real_url("//duckduckgo.com/l/?rut=x"), None);
        assert_eq!(ddg_real_url("/about"), None);
    }

    #[test]
    fn keyed_search_mappers_pull_title_url_snippet() {
        // Brave: hits under web.results[] with `description` snippet.
        let brave = serde_json::json!({ "web": { "results": [
            { "title": "Rust", "url": "https://rust-lang.org", "description": "systems lang" },
            { "title": "Cargo", "url": "https://crates.io", "description": "packages" },
        ]}});
        let out = map_brave_results(&brave, 1);
        assert_eq!(out.len(), 1, "respects max n");
        assert_eq!(out[0]["url"], "https://rust-lang.org");
        assert_eq!(out[0]["snippet"], "systems lang");

        // Serper: Google organic hits under organic[] with `link` + `snippet`.
        let serper = serde_json::json!({ "organic": [
            { "title": "Tokio", "link": "https://tokio.rs", "snippet": "async runtime" },
        ]});
        let out = map_serper_results(&serper, 5);
        assert_eq!(out[0]["url"], "https://tokio.rs");
        assert_eq!(out[0]["snippet"], "async runtime");

        // Exa: hits under results[] with a `text` field.
        let exa = serde_json::json!({ "results": [
            { "title": "Serde", "url": "https://serde.rs", "text": "serialization" },
        ]});
        let out = map_exa_results(&exa, 5);
        assert_eq!(out[0]["url"], "https://serde.rs");
        assert_eq!(out[0]["snippet"], "serialization");

        // Garbage / missing arrays degrade to empty, never panic.
        assert!(map_brave_results(&serde_json::json!({}), 5).is_empty());
        assert!(map_serper_results(&serde_json::json!({ "organic": "nope" }), 5).is_empty());
        assert!(map_exa_results(&serde_json::json!(7), 5).is_empty());
    }

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

    #[test]
    fn guard_egress_blocks_internal_targets() {
        // Loopback + metadata + private ranges + internal hostnames denied.
        for bad in [
            "http://127.0.0.1/x",
            "http://localhost:8080/",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.5/",
            "http://192.168.1.1/admin",
            "http://[::1]/",
            "https://kernel.internal/",
            "https://foo.local/",
            " file:///etc/passwd".trim(),
            "ftp://example.com/",
        ] {
            assert!(
                guard_egress(bad).is_err(),
                "egress guard must deny internal/odd target: {bad}"
            );
        }
        // A normal public host is allowed (resolves to a routable address).
        assert!(
            guard_egress("https://example.com/").is_ok(),
            "public host should pass the egress guard"
        );
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

    /// End-to-end proof that the LifeOS task tools are reachable THROUGH the gate
    /// over real HTTP, and that their argument objects deserialize from JSON-RPC
    /// params (the serde-shape layer that bit the content/body drift before).
    /// Read-only: `task_describe` + `task_query` touch no vault writes and don't
    /// depend on HOME, so this is deterministic; the create/update write path is
    /// covered by the `tasks_source` tempdir unit tests. GOAL Phase 1.
    #[tokio::test]
    async fn task_tools_reachable_over_the_wire() {
        let data_dir = std::env::temp_dir().join("ctrl-test-mcp-tasks");
        let _ = std::fs::remove_dir_all(&data_dir);
        let runtime = Arc::new(KernelRuntime::boot(data_dir).expect("kernel boot"));
        let handle = serve(runtime, None, "127.0.0.1:0").await.expect("serve");
        let url = handle.url();
        let token = handle.auth_token.as_ref().clone();
        let client = reqwest::Client::new();

        // initialize -> session id (shared helper shape as the intent test).
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

        let call = |id: u32, name: &str, args: serde_json::Value| {
            let body = serde_json::json!({
                "jsonrpc": "2.0", "id": id, "method": "tools/call",
                "params": { "name": name, "arguments": args }
            })
            .to_string();
            client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .header("Authorization", format!("Bearer {token}"))
                .header("mcp-session-id", session_id.clone())
                // Scope the caller to the `tasks` domain so the gate's visibility
                // trim exposes the task tools (default external caller gets the
                // minimal set — proof the SC3 trim is live).
                .header(visibility::INTENT_HEADER, "tasks")
                .body(body)
                .send()
        };

        // task_describe over the wire → a Record source advertising `status`.
        let resp = call(2, "task_describe", serde_json::json!({})).await.expect("task_describe");
        let text = extract_jsonrpc(&resp.text().await.expect("body"))["result"]["content"][0]
            ["text"]
            .as_str()
            .expect("describe content text")
            .to_string();
        let describe: serde_json::Value = serde_json::from_str(&text).expect("describe json");
        assert_eq!(describe["source_kind"], "record");
        assert!(
            describe["fields"].as_array().unwrap().iter().any(|f| f["key"] == "status"),
            "task_describe must advertise a status field"
        );

        // task_query over the wire with a real filter+sort payload → the
        // arguments must deserialize (the serde-shape guard) and the result must
        // be the uniform QueryResult shape. Read-only against an empty vault.
        let resp = call(
            3,
            "task_query",
            serde_json::json!({
                "filters": [{ "field": "status", "op": "neq", "value": "done" }],
                "sort": [{ "field": "due" }]
            }),
        )
        .await
        .expect("task_query");
        let text = extract_jsonrpc(&resp.text().await.expect("body"))["result"]["content"][0]
            ["text"]
            .as_str()
            .expect("query content text")
            .to_string();
        let result: serde_json::Value = serde_json::from_str(&text).expect("query json");
        assert!(result["rows"].is_array(), "query result must carry a rows array");
        assert!(result["match_count"].is_number(), "query result must carry match_count");
    }

    /// End-to-end proof that the GENERIC §14 connector tools (source_describe /
    /// source_query / source_produce, ADR-002 §14.12) are reachable THROUGH the
    /// gate under the `source` intent, hidden otherwise, and actually run the
    /// manifest loader (a bogus source_id surfaces the "no installed manifest"
    /// path). Race-free: no HOME manipulation — the manifest→spec→rows data path
    /// is covered by the `manifest_source` unit tests over the real manifest.
    #[tokio::test]
    async fn source_tools_reachable_and_wired_over_the_wire() {
        let data_dir = std::env::temp_dir().join("ctrl-test-mcp-source");
        let _ = std::fs::remove_dir_all(&data_dir);
        let runtime = Arc::new(KernelRuntime::boot(data_dir).expect("kernel boot"));
        let handle = serve(runtime, None, "127.0.0.1:0").await.expect("serve");
        let url = handle.url();
        let token = handle.auth_token.as_ref().clone();
        let client = reqwest::Client::new();

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

        // tools/list under the `source` intent → the generic trio is reachable,
        // out-of-scope tools hidden.
        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("Authorization", format!("Bearer {token}"))
            .header("mcp-session-id", session_id.clone())
            .header(visibility::INTENT_HEADER, "source")
            .body(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#)
            .send()
            .await
            .expect("tools/list");
        let json = extract_jsonrpc(&resp.text().await.expect("body"));
        let names: Vec<String> = json["result"]["tools"]
            .as_array()
            .expect("tools array")
            .iter()
            .map(|t| t["name"].as_str().unwrap_or("").to_string())
            .collect();
        assert!(names.iter().any(|n| n == "source_describe"), "source_describe reachable");
        assert!(names.iter().any(|n| n == "source_query"), "source_query reachable");
        assert!(names.iter().any(|n| n == "source_produce"), "source_produce reachable");
        assert!(!names.iter().any(|n| n == "http_post"), "out-of-scope tool hidden by intent trim");

        // source_describe with a bogus id → the tool runs and reaches the manifest
        // loader (proves wiring, not just registration).
        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("Authorization", format!("Bearer {token}"))
            .header("mcp-session-id", session_id)
            .header(visibility::INTENT_HEADER, "source")
            .body(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"source_describe","arguments":{"source_id":"no-such-pack"}}}"#)
            .send()
            .await
            .expect("source_describe");
        let out = extract_jsonrpc(&resp.text().await.expect("body"));
        let msg = serde_json::to_string(&out).unwrap_or_default();
        assert!(
            msg.contains("no installed manifest"),
            "source_describe must reach the manifest loader for an unknown id, got: {msg}"
        );
    }
}
