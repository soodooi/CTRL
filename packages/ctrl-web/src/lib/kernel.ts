// @ctrl/web — typed wrappers over kernel commands.
//
// Each function maps 1:1 to a `#[tauri::command]` in `src-tauri/src/commands/`.
// Argument and return shapes mirror the Rust structs.

import { invoke } from './bridge';
import type { Icon } from './icon';

// === Platform API client (comms-system-design Phase B) ===
//
// `gateInvoke` calls a kernel capability THROUGH the :17873 gate — the SAME
// governed surface (audit + visibility) that external agents / BYO-CLI use —
// instead of a private per-capability Tauri command. This is what makes CTRL a
// platform rather than an app: the PWA is a first-class client of CTRL's own
// platform API, not a backdoor consumer. Capability wrappers migrate onto this;
// app-shell commands (window / lifecycle / keychain) stay on direct `invoke`.
//
// `args` is the tool's MCP arguments object directly (NOT wrapped in `{ args }`
// the way Tauri commands take it) — the bridge forwards it as the tools/call
// `arguments`.
// `intent` declares the scope this call needs. It is required when addressing one
// connector: the `source` domain alone authorizes no connector, so a call must
// name it as `source:<id>`. (ADR-002 substrate §17.5 v85)
export const gateInvoke = <T = unknown>(
  tool: string,
  args: Record<string, unknown> = {},
  intent?: string,
): Promise<T> =>
  invoke('gate_invoke', { tool, args, intent: intent ?? null }) as Promise<T>;

/** Mirrors `ResourceFreshness` in `src-tauri/src/kernel/resource.rs`. */
export interface ResourceFreshness {
  observed_at?: string | null;
  revision?: string | null;
  stale: boolean;
}

/** Mirrors `ResourceDegradation` in `src-tauri/src/kernel/resource.rs`.
 *  `retryable` is kernel-reported and never inferred from a message. */
export interface ResourceDegradation {
  code: string;
  summary: string;
  retryable: boolean;
}

export interface CanonicalResourceDescriptor {
  protocol_version: string;
  resource: string;
  content_type: string;
  /** Upstream Resources this one was derived from, as canonical refs. */
  provenance?: string[];
  freshness?: ResourceFreshness;
  degradation?: ResourceDegradation | null;
  presentation: {
    viewer?: string | null;
    title?: string | null;
    preferred_columns: string[];
  };
  /** Operations the owner advertises. A surface offers a write only when the
   *  descriptor declares it; it never assumes one from the content type.
   *  (ADR-002 substrate §15.2 v87) */
  produce?: { kind: string; review_required?: boolean }[];
}

/** Canonical Resource three-verb read surface through the governed gate.
 * (ADR-002 substrate §15 v83; ADR-003 frontend §8.5 v40) */
export const describeResource = (resourceRef: string): Promise<CanonicalResourceDescriptor> =>
  gateInvoke('describe', { ref: resourceRef });

/** Canonical write verb. The operation is the owner's typed operation object;
 *  the reply is that owner's Outcome. (ADR-002 substrate §15.5 v86) */
export const produceResource = <T>(
  resourceRef: string,
  operation: Record<string, unknown>,
): Promise<T> => gateInvoke('produce', { ref: resourceRef, operation });

export const queryResource = <T>(
  resourceRef: string,
  request: Record<string, unknown> = {},
): Promise<T> => gateInvoke('query', { ref: resourceRef, request });

// Report which note is focused (ADR-002 §1.9 v46 E2). Deliberately a Tauri
// command, NOT a gate tool: only the UI may set focus (C3 boundary — the
// brain reads it via `note_active_get` but can never forge it). Fire-and-forget.
export const setActiveNote = (path: string | null): Promise<void> =>
  invoke('set_active_note', { path }) as Promise<void>;

// === Kernel status (system instruments) ===
//
// Mirror of `src-tauri/src/commands/system.rs::KernelStatus`. The StatusBar
// + DefaultWorkspace dashboard read this every ~3s via `useKernelStatus`.
// `keep last good` semantics — if a poll fails, the consumer should keep
// the previous snapshot rather than blank the UI (per Zeus' guidance).
export interface KernelStatus {
  uptime_ms: number;
  // Fresh-install seeding state — 'copying' while the kernel copies the
  // builtin mcps from the app bundle into ~/.ctrl/mcps/, 'ready' once done.
  // The PWA shows "Setting up CTRL…" during 'copying' so the empty
  // Tools/Discover lists on a brand-new install don't read as broken.
  // Mirror of system.rs::FirstRunState (serde snake_case).
  // ADR-006 § cold-start-loop §6.1 G3 / §6.2 #3.
  first_run_state: 'copying' | 'ready';
  llm_adapters: string[];
  primary_adapter: string | null;
  mcp_servers_installed: number;
  vault_files: number;
  event_ws_addr: string;
  overall: 'ok' | 'degraded';
  warnings: string[];
  active_brain: string;
}

export const kernelStatus = (): Promise<KernelStatus> =>
  invoke<KernelStatus>('kernel_status');

// True while the kernel is still seeding builtin mcps on a fresh install
// (first_run_state = 'copying'). Consumers show a "Setting up CTRL…" hint so
// empty Tools/Discover lists read as "still installing" rather than broken.
// Returns false on a null snapshot (no poll yet) — we'd rather not flash the
// setup hint than show it spuriously. ADR-006 § cold-start-loop §6.2 #3.
export function isSeedingFirstRun(status: KernelStatus | null): boolean {
  return status?.first_run_state === 'copying';
}

// === Unified local diagnostics ===
// Direct typed Tauri controls are the first-party surface. Only the read-only
// status/smoke/trace subset is projected through :17873; capture and export
// preview never become agent tools. (ADR-003 frontend § diagnostics-surface v26)
export type DiagnosticsModule = 'irisy' | 'coding' | 'notes';
export type DiagnosticsStartup = 'idle' | 'starting' | 'ready' | 'failed';
export type DiagnosticsHealth = 'ok' | 'degraded' | 'failed';

export interface DiagnosticsEvent {
  timestamp_ms: number;
  module: DiagnosticsModule;
  trace_id: string;
  session_id?: string;
  correlation_id?: string;
  kind: string;
  phase: string;
  severity: string;
  outcome: string;
  duration_ms?: number;
  attributes: Record<string, unknown>;
}

export interface DiagnosticsStatus {
  observed_at_ms: number;
  module: DiagnosticsModule;
  startup: DiagnosticsStartup;
  live: boolean;
  ready: boolean;
  health: DiagnosticsHealth;
  summary: string;
  capture_active: boolean;
  capture_expires_at_ms?: number;
  retained_events: number;
  attributes: Record<string, unknown>;
}

export interface DiagnosticsSmokeCheck {
  name: string;
  health: DiagnosticsHealth;
  summary: string;
}

export interface DiagnosticsSmoke {
  observed_at_ms: number;
  module: DiagnosticsModule;
  health: DiagnosticsHealth;
  checks: DiagnosticsSmokeCheck[];
}

export interface DiagnosticsTrace {
  module: DiagnosticsModule;
  correlation_id?: string;
  retention_seconds: number;
  capacity: number;
  events: DiagnosticsEvent[];
}

export interface DiagnosticsCaptureReply {
  module: DiagnosticsModule;
  active: boolean;
  expires_at_ms?: number;
}

export interface DiagnosticsExportPreview {
  generated_at_ms: number;
  module: DiagnosticsModule;
  status: DiagnosticsStatus;
  trace: DiagnosticsTrace;
  metadata_only: true;
  destination: 'local_user_selected_file';
  estimated_bytes: number;
}

// App-shell transport name; shared implementation remains kernel-owned.
// (ADR-003 frontend § diagnostics-surface v26)
export const diagnosticsStatus = (module: DiagnosticsModule): Promise<DiagnosticsStatus> =>
  invoke<DiagnosticsStatus>('app_diagnostics_status', { module });

// App-shell transport name; MCP keeps the protocol-level diagnostics_smoke.
// (ADR-003 frontend § diagnostics-surface v26)
export const diagnosticsSmoke = (module: DiagnosticsModule): Promise<DiagnosticsSmoke> =>
  invoke<DiagnosticsSmoke>('app_diagnostics_smoke', { module });

// App-shell transport name; both surfaces delegate to one Rust composer.
// (ADR-003 frontend § diagnostics-surface v26)
export const diagnosticsTrace = (
  module: DiagnosticsModule,
  correlationId?: string,
  limit?: number,
): Promise<DiagnosticsTrace> =>
  invoke<DiagnosticsTrace>('app_diagnostics_trace', {
    module,
    correlation_id: correlationId ?? null,
    limit: limit ?? null,
  });

export const diagnosticsCaptureStart = (
  module: DiagnosticsModule,
  durationSeconds: number,
): Promise<DiagnosticsCaptureReply> =>
  invoke<DiagnosticsCaptureReply>('diagnostics_capture_start', {
    module,
    duration_seconds: durationSeconds,
  });

export const diagnosticsCaptureStop = (
  module: DiagnosticsModule,
): Promise<DiagnosticsCaptureReply> =>
  invoke<DiagnosticsCaptureReply>('diagnostics_capture_stop', { module });

export const diagnosticsExportPreview = (
  module: DiagnosticsModule,
  correlationId?: string,
): Promise<DiagnosticsExportPreview> =>
  invoke<DiagnosticsExportPreview>('diagnostics_export_preview', {
    module,
    correlation_id: correlationId ?? null,
  });

// `icon` is widened to `Icon | string` for forward-compat with the
// kernel schema migration to the `McpIcon` discriminated union in
// `packages/ctrl-mcp-sdk/src/manifest-schema.ts`. Today the
// kernel ships single-glyph strings; consumers must run the value
// through `normalizeIcon()` from `lib/icon.ts` before rendering.
export interface McpSummary {
  id: string;
  name: string;
  mcp_color: string;
  icon: Icon | string;
}

export interface LocalSkill {
  name: string;
  description?: string;
  path: string;
}

/** Hot-scan the local plain-text skill authority. No UI cache: newly installed
 * skills appear on the next open. (ADR-003 frontend §8.5 v39;
 * ADR-003 frontend §8.6 v39) */
export const listLocalSkills = (query?: string): Promise<LocalSkill[]> =>
  invoke<LocalSkill[]>('list_local_skills', { query });

export const listMcps = (): Promise<McpSummary[]> =>
  invoke('list_mcps');

export interface McpInstallArgs {
  server_url: string;
  tool_name: string;
  display_name: string;
  mcp_color?: string;
  icon?: string;
}

export const installMcpFromMcp = (args: McpInstallArgs): Promise<McpSummary> =>
  invoke('install_mcp_from_mcp', { args });

// === Provider config (Settings → General) ===
//
// Mirrors `src-tauri/src/commands/config.rs`. Three round-trips drive
// the entire provider table: list → set/test/delete → list. The kernel
// owns config.toml + Keychain writes; the PWA never touches them
// directly.
export interface ProviderInfo {
  name: string;
  display_name: string;
  base_url: string;
  default_model: string;
  has_key_in_config: boolean;
  has_key_in_keychain: boolean;
  is_active: boolean;
}

export const listProviders = (): Promise<ProviderInfo[]> =>
  invoke('config_list_providers');

/** bao 2026-06-06: provider preset list is data, not code. Kernel returns
 *  bundled defaults merged with ~/.ctrl/provider-templates.json user
 *  override (community / per-user contributable, no rebuild required). */
export interface ProviderTemplate {
  id: string;
  label: string;
  defaultName: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  defaultModel: string;
  keyHint: string;
  /** Current catalogue model ids. The add/edit UI renders an explicit
   *  selector and keeps a free-text model-id escape hatch. Optional:
   *  older catalogue snapshots / user overrides without the field retain
   *  the free-text-only behaviour. */
  models?: string[];
}

// Browser-only preview fallback. Runtime provider/model truth comes from the
// kernel's bundled floor + Models.dev refresh + user override; this small list
// exists only because Tauri invoke is unavailable in a plain Vite preview.
// (ADR-002 substrate §3.10 v67)
const FALLBACK_PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { id: 'anthropic', label: 'Anthropic Claude', defaultName: 'Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-6', keyHint: 'sk-ant-...; console.anthropic.com/settings/keys' },
  { id: 'zhipu', label: 'Z.AI', defaultName: 'Z.AI', protocol: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', defaultModel: 'glm-5.2', keyHint: 'create a general API key at z.ai → API Keys', models: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-5v-turbo', 'glm-4.7', 'glm-4.7-flashx', 'glm-4.7-flash', 'glm-4.6', 'glm-4.6v', 'glm-4.5', 'glm-4.5-air', 'glm-4.5-flash', 'glm-4.5v'] },
  { id: 'zai-coding-plan', label: 'Z.AI Coding Plan', defaultName: 'Z.AI Coding Plan', protocol: 'openai', baseUrl: 'https://api.z.ai/api/coding/paas/v4', defaultModel: 'glm-5.2', keyHint: 'use your Individual or Team Coding Plan key; general Z.AI keys are not interchangeable', models: ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-5v-turbo', 'glm-4.7', 'glm-4.5-air'] },
  { id: 'custom', label: 'Custom (any OpenAI-compatible endpoint)', defaultName: '', protocol: 'openai', baseUrl: '', defaultModel: '', keyHint: 'paste your API key' },
];

export const listProviderTemplates = async (): Promise<ProviderTemplate[]> => {
  try {
    return await invoke<ProviderTemplate[]>('list_provider_templates');
  } catch {
    return FALLBACK_PROVIDER_TEMPLATES;
  }
};

/** Refresh Models.dev-backed provider/model data, preserving the cached or
 * bundled catalogue when the network is unavailable.
 * (ADR-002 substrate §3.10 v67) */
export const refreshProviderCatalog = (): Promise<number> =>
  invoke<number>('refresh_provider_catalog');

/**
 * Live model list from a configured provider's own `/models` endpoint
 * (decision 0007 §per-provider-models, 2026-06-19). Falls back to the
 * manifest's static `models` array server-side when the provider is
 * unreachable / doesn't expose `/models` (Anthropic) / key missing.
 *
 * Returns an empty array outside Tauri (browser dev) so the PWA keeps
 * the free-text model input working.
 */
export const listProviderModels = async (providerId: string): Promise<string[]> => {
  try {
    return await invoke<string[]>('provider_list_models', { providerId });
  } catch {
    return [];
  }
};

/**
 * Ad-hoc live model query for the +Add flow — calls the provider's
 * `/models` endpoint with raw `endpoint` + `api_key` before the
 * provider is saved to ~/.ctrl/providers/. Lets the PWA show a real
 * <datalist> the moment the user finishes typing their key.
 *
 * Returns an empty array on any failure (network / 4xx / parse) —
 * caller keeps the free-text model input working.
 */
export const queryProviderModels = async (
  endpoint: string,
  apiKey: string,
): Promise<string[]> => {
  try {
    return await invoke<string[]>('provider_query_models', { endpoint, apiKey });
  } catch {
    return [];
  }
};

export interface SetProviderKeyArgs {
  /** Slug — sanitized server-side to [a-z0-9_-], used as keychain account
   *  + manifest filename `~/.ctrl/providers/<slug>.toml`. */
  provider: string;
  api_key: string;
  base_url?: string;
  default_model?: string;
  /** bao 2026-06-05 e: free-form provider fields. */
  display_name?: string;
  /** "openai" (default) or "anthropic". Maps to manifest `shape`. */
  api_protocol?: 'openai' | 'anthropic';
  /** Recommended model ids carried from the catalog (decision 0007
   *  §per-provider-models). Persisted into the manifest's `models[]` so
   *  provider_list_models' static fallback stays populated after the
   *  catalog drifts / cloud cache expires. */
  models?: string[];
}

/** Returns the canonical provider id persisted by the kernel.
 * (ADR-002 substrate § provider v67) */
export const setProviderKey = (args: SetProviderKeyArgs): Promise<string> =>
  invoke<string>('config_set_provider_key', { args });

export interface TestProviderResult {
  success: boolean;
  message: string;
  elapsed_ms: number;
  model_count: number | null;
}

export const testProvider = (provider: string): Promise<TestProviderResult> =>
  invoke('config_test_provider', { args: { provider } });

export const deleteProvider = (provider: string): Promise<void> =>
  invoke('config_delete_provider', { args: { provider } });

// Managed engine selection/install wrappers are absent from the fixed Irisy API.
// (ADR-005 irisy §11 v40)
export interface RunMcpResult {
  output: unknown;
  duration_ms: number;
}

export const runMcp = (mcp_id: string, input: unknown): Promise<RunMcpResult> =>
  invoke('run_mcp', { args: { mcp_id, input } });

export const mcpCall = (
  server_url: string,
  tool_name: string,
  args: unknown,
): Promise<unknown> =>
  invoke('mcp_call', { args: { server_url, tool_name, args } });

// Smart-table AI column (ADR-003 §6.5.4) — the "AI-as-column" differentiator.
// Runs an LLM down a column, {field}-templated, resume-safe, cost-gated. The
// PWA-facing twin of the :17873 gate tool; both reuse the same kernel core.
export type AiColumnOp = 'classify' | 'extract' | 'summarize' | 'translate' | 'generate';

export interface AiColumnArgs {
  path: string;
  target_field: string;
  /** Prompt template; `{field}` tokens reference other columns in the row. */
  prompt: string;
  op: AiColumnOp;
  /** Re-run rows whose target cell is already filled (default false). */
  force?: boolean;
  /** Confirm a run over the cost gate (kernel rejects with needs_confirmation otherwise). */
  confirm_over_gate?: boolean;
}

export interface AiColumnSummary {
  rows_total: number;
  rows_planned: number;
  rows_written: number;
  errors: Array<{ row: number; message: string }>;
}

export const smartTableRunAiColumn = (args: AiColumnArgs): Promise<AiColumnSummary> =>
  gateInvoke('smart_table_run_ai_column', { ...args });

// §14 Unified Operation Interface — read half (describe / query) over the PWA
// bridge. The in-app twin of the :17873 gate's `smart_table.describe` /
// `.query`; both run the SAME kernel engine (kernel::query::run_query) so the
// viewer never drifts from a second client-side implementation (ADR-002 §14).
export type QueryOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'before'
  | 'after'
  | 'within'
  | 'is'
  | 'has_tag';

export interface QueryFieldSpec {
  key: string;
  label: string;
  /** Semantic base type the kernel filters/sorts by. */
  type: string;
  options?: string[];
}

/** What `smart_table.describe` returns: the type layer the UI reads before
 *  composing a query (drives the valid field + operator menus). */
export interface SmartTableDescribe {
  source_kind: string;
  fields: QueryFieldSpec[];
  operators: QueryOperator[];
}

export interface QueryFilter {
  field: string;
  op: QueryOperator;
  value: string;
}

export interface QuerySortKey {
  field: string;
  desc?: boolean;
}

export interface SmartTableQueryRequest {
  filters?: QueryFilter[];
  /** How filters combine (default 'and'). 'or' passes a row matching any. */
  conjunction?: 'and' | 'or';
  sort?: QuerySortKey[];
  /** Group keys applied in order (multi-level); equal values made contiguous. */
  group_by?: string[];
  limit?: number | null;
}

export interface SmartTableQueryResult {
  rows: Array<Record<string, string>>;
  /** Pre-limit match count (rows may be capped by `limit`). */
  match_count: number;
}

/** Describe a smart table — fields, types, operators. Routed through the
 *  platform API (`gateInvoke`): the PWA calls the same governed gate tool an
 *  external agent would (comms-system-design Phase B, first migration). Shape is
 *  identical to the old `smart_table_describe` Tauri command (same kernel
 *  `describe`, no relational augmentation), so this is behavior-preserving. */
export const describeSmartTable = (path: string): Promise<SmartTableDescribe> =>
  gateInvoke('smart_table_describe', { path });

/** Run a structured filter/sort/group query through the shared kernel engine.
 *  Rejects unknown field references with the valid set (anti-hallucination). */
export const querySmartTable = (
  path: string,
  request: SmartTableQueryRequest = {},
): Promise<SmartTableQueryResult> =>
  gateInvoke('smart_table_query', {
    path,
    filters: request.filters ?? [],
    conjunction: request.conjunction ?? 'and',
    sort: request.sort ?? [],
    group_by: request.group_by ?? [],
    limit: request.limit ?? null,
  });

// ─── Generic §14 connector source (ADR-002 §14.12) ──────────────────────────
// Any installed connector that declares a `record_source` is describe/query'd
// through the SAME gate + shared engine as smart-table — data-driven, so the PWA
// reads a product-grade data view (e.g. Ghostfolio holdings) with zero per-pack
// code. Addressed by source_id (the installed pack id).

/** Describe a connector's records — fields + operators, read from its manifest
 *  record_source. Same shape as a smart-table describe (the §14 type layer). */
export const describeSource = (sourceId: string): Promise<SmartTableDescribe> =>
  gateInvoke('source_describe', { source_id: sourceId });

/** Query a connector's records live through the gate (fetches the self-hosted
 *  instance from its manifest). Same request/result shape as smart_table.query. */
export const querySource = (
  sourceId: string,
  request: SmartTableQueryRequest = {},
): Promise<SmartTableQueryResult> =>
  gateInvoke('source_query', {
    source_id: sourceId,
    filters: request.filters ?? [],
    conjunction: request.conjunction ?? 'and',
    sort: request.sort ?? [],
    group_by: request.group_by ?? [],
    limit: request.limit ?? null,
  });

// ─── Feature-pack evals (ADR-002 §7.4/§7.5, mcp-builder review+evals) ────────
// Validate a candidate manifest BEFORE install so a bad pack self-corrects
// instead of shipping — the quality step home-grown pipelines skip.

export interface PackValidationIssue {
  field: string;
  severity: 'error' | 'warn';
  message: string;
  fix?: string;
}

export interface PackValidationReport {
  /** True iff there are no error-severity issues (warnings still allow install). */
  ok: boolean;
  issues: PackValidationIssue[];
  /** When a coherent §14 record_source is declared, its describe field count. */
  record_source_fields?: number;
}

/** Evaluate a candidate feature-pack manifest through the gate (mcp_pack_validate).
 *  Returns structured, self-correctable issues. */
export const validatePack = (manifest: unknown): Promise<PackValidationReport> =>
  gateInvoke('mcp_pack_validate', { manifest });

// ─── LifeOS tasks (ADR-002 §14 Task source, GOAL Phase 1) ───────────────────
// Inline-checkbox tasks scanned across the vault, operated through the SAME
// :17873 gate an external agent uses (task_describe/query/create/update).

export interface TaskRow {
  path: string;
  line: string;
  title: string;
  status: string;
  due: string;
  /** Obsidian-Tasks `✅` completion date, set when the task is completed. */
  done: string;
  tags: string;
}
export interface TaskQueryResult {
  rows: TaskRow[];
  match_count: number;
}
export interface TaskQueryRequest {
  subdir?: string | null;
  filters?: Array<{ field: string; op: string; value: string }>;
  conjunction?: 'and' | 'or';
  sort?: Array<{ field: string; desc?: boolean }>;
  group_by?: string[];
  limit?: number | null;
}

/** Query LifeOS tasks (open/done/due) through the shared kernel engine. */
export const queryTasks = (request: TaskQueryRequest = {}): Promise<TaskQueryResult> =>
  gateInvoke('task_query', {
    subdir: request.subdir ?? null,
    filters: request.filters ?? [],
    conjunction: request.conjunction ?? 'and',
    sort: request.sort ?? [],
    group_by: request.group_by ?? [],
    limit: request.limit ?? null,
  });

/** Create a task: append a `- [ ]` checkbox line (default: today's daily note). */
export const createTask = (args: {
  title: string;
  due?: string | null;
  tags?: string[];
  note?: string | null;
}): Promise<string> =>
  gateInvoke('task_create', {
    title: args.title,
    due: args.due ?? null,
    tags: args.tags ?? [],
    note: args.note ?? null,
  });

/** Update one field of a task in place (status='done' completes it). */
export const updateTask = (args: {
  note: string;
  line: number;
  field: 'status' | 'due' | 'title' | 'tags';
  value: string;
}): Promise<string> => gateInvoke('task_update', { ...args });

export const listMcpServers = (): Promise<string[]> => invoke('list_mcp_servers');

/**
 * Open the dedicated workspace window for a mcp activation.
 *
 * Per bao 2026-05-14: workspace is a SECOND window, separate from the
 * launcher pool, opened on demand per selected mcp. The workspace
 * window reuses across activations (single window, route reflects the
 * latest mcp).
 */
export const openWorkspace = (mcp_id: string): Promise<void> =>
  invoke('open_workspace', { mcp_id });

export interface StreamHandle {
  stream_id: string;
  bridge_url: string;
}

// The event stream is a plain CBOR-over-WS (event-stream protocol deprecated, ADR-010
// § transports v5, SC6). `subscribe` is the one remaining call — it returns the
// authed WS URL the cell-stream hooks connect to. The publish / listStreams
// wrappers retired with their dead Tauri commands.
export const subscribe = (stream_id: string): Promise<StreamHandle> =>
  invoke('subscribe', { args: { stream_id } });

export interface LogEntry {
  id: string;
  ts_ms: number;
  kind: string;
  payload: unknown;
}

export const readLog = (since_ms?: number, limit?: number): Promise<LogEntry[]> =>
  invoke('read_log', { args: { since_ms: since_ms ?? null, limit: limit ?? null } });

export const appendEvent = (kind: string, payload: unknown): Promise<string> =>
  invoke('append_event', { args: { kind, payload } });

export const queryMemory = (text: string, k?: number): Promise<LogEntry[]> =>
  invoke('query', { args: { text, k: k ?? null } });

export const storeKey = (account: string, value: string): Promise<void> =>
  invoke('store_key', { account, value });

export const getKey = (account: string): Promise<string | null> =>
  invoke('get_key', { account });

export const deleteKey = (account: string): Promise<void> =>
  invoke('delete_key', { account });

// === Vault (markdown + assets at ~/Documents/CTRL/) =================
// Canonical product resources cross the governed gate; retained wrappers here
// are typed compatibility boundaries, not a second content owner.
// (ADR-003 frontend §8.5 v40)
//
// Mirrors src-tauri/src/commands/vault.rs. All paths relative to vault
// root (machine-portable). Frontmatter is JSON over the wire; kernel
// renders it as YAML on disk so vim / VMark / Obsidian see normal
// markdown files.

export interface VaultEntry {
  /** Relative path under vault root. */
  path: string;
  /** Parsed frontmatter as plain JSON. */
  frontmatter: Record<string, unknown>;
  /** Body excluding the YAML frontmatter block. Matches the Rust
   *  `kernel::vault::VaultEntry.content` field name exactly — the kernel
   *  serializes this struct verbatim, so the wire field is `content`, not
   *  `body` (the previous name silently resolved to `undefined`). */
  content: string;
}

export interface VaultWriteArgs {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  mcp_id?: string;
}

export interface VaultWriteReply {
  absolute_path: string;
  path: string;
}

// Capability calls route through the platform API (gateInvoke → :17873 gate),
// not private Tauri commands (comms-system-design Phase B). The gate tool takes
// the MCP arguments directly (no `{ args }` envelope, no `mcp_id` — governance
// is the gate's, not check_cap's). Shapes mirror the bespoke commands.
// NB: the gate's vault_write field is `body`, not `content` (the retired Tauri
// command used `content`); map it here so writes (new table / note save) land.
export const vaultWrite = (args: VaultWriteArgs): Promise<VaultWriteReply> =>
  gateInvoke('vault_write', {
    path: args.path,
    body: args.content,
    frontmatter: args.frontmatter,
  });

export const vaultRead = (path: string, _mcp_id?: string): Promise<VaultEntry> =>
  gateInvoke('vault_read', { path });

export const vaultList = (
  subdir?: string,
  _mcp_id?: string,
): Promise<string[]> => gateInvoke('vault_list', { subdir: subdir ?? null });

/** Reset Irisy's engine session so the next turn re-hydrates from the current
 * transcript. Reset failure must propagate: callers serialize owner changes
 * and block dispatch rather than reuse stale scope. (ADR-005 irisy §11 v38) */
export const resetEngine = (): Promise<void> =>
  invoke<void>('irisy_reset_engine');

export const vaultSearch = (
  query: string,
  limit = 50,
  _mcp_id?: string,
): Promise<string[]> => gateInvoke('vault_search', { query, limit });

export const vaultDelete = (path: string, _mcp_id?: string): Promise<void> =>
  gateInvoke('vault_delete', { path });

export const vaultRootPath = (): Promise<string> => gateInvoke('vault_root_path');

export const vaultRebuildIndex = (): Promise<number> =>
  gateInvoke('vault_rebuild_index');

// ADR-002 substrate § vault v1 §8.3 #9-21 (2026-06-01) — graph + mutation
// + watcher primitives (memory `decision_vault_adr_002_section_8`).
// Mirrors src-tauri/src/commands/vault.rs; Daily Note + Sourcing
// routines (frontend feature layer) compose from these calls.

export interface BacklinkHit {
  from: string;
  snippet: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface MentionHit {
  path: string;
  snippet: string;
}

export interface BrokenLink {
  from: string;
  target: string;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphData {
  nodes: string[];
  edges: GraphEdge[];
}

export type VaultWatchEventKind = 'create' | 'modify' | 'remove' | 'other';

export interface VaultWatchEvent {
  path: string;
  kind: VaultWatchEventKind;
  ts_ms: number;
}

export const vaultBacklinks = (
  path: string,
  _mcp_id?: string,
): Promise<BacklinkHit[]> =>
  gateInvoke('vault_backlinks', { path });

export const vaultTags = (_mcp_id?: string): Promise<TagCount[]> =>
  gateInvoke('vault_tags', {});

export const vaultNotesByTag = (
  tag: string,
  _mcp_id?: string,
): Promise<string[]> => gateInvoke('vault_notes_by_tag', { tag });

export const vaultMentions = (
  text: string,
  _mcp_id?: string,
): Promise<MentionHit[]> => gateInvoke('vault_mentions', { text });

export const vaultOrphans = (_mcp_id?: string): Promise<string[]> =>
  gateInvoke('vault_orphans', {});

export const vaultBrokenLinks = (_mcp_id?: string): Promise<BrokenLink[]> =>
  gateInvoke('vault_broken_links', {});

export const vaultGraphData = (_mcp_id?: string): Promise<GraphData> =>
  gateInvoke('vault_graph_data', {});

export const vaultRename = (
  from: string,
  to: string,
  _mcp_id?: string,
): Promise<void> => gateInvoke('vault_rename', { from, to });

export const vaultMove = (
  from: string,
  to: string,
  _mcp_id?: string,
): Promise<void> => gateInvoke('vault_move', { from, to });

export const vaultCreateFolder = (
  path: string,
  _mcp_id?: string,
): Promise<void> => gateInvoke('vault_create_folder', { path });

// Vault root configuration — point CTRL at the user's own (Obsidian) vault.
// These stay on bespoke Tauri commands (not the gate): choosing where the vault
// IS can't go through a gate scoped to a vault.
export interface VaultConfig {
  /** True once the user picked a vault (else still on the fallback default). */
  configured: boolean;
  /** The resolved vault root currently in effect. */
  root: string;
  /** Whether the vault is auto-committed to git on a schedule. */
  auto_sync: boolean;
}

export const vaultGetConfig = (): Promise<VaultConfig> =>
  invoke('vault_get_config');

export const vaultSetRoot = (path: string): Promise<VaultConfig> =>
  invoke('vault_set_root', { path });

export const vaultSetAutoSync = (enabled: boolean): Promise<void> =>
  invoke('vault_set_auto_sync', { args: { enabled } });

/** Open the OS folder picker (native, via the Tauri dialog plugin) and return
 *  the chosen absolute path, or null if the user cancelled. */
export const pickVaultFolder = async (): Promise<string | null> => {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const res = await open({
    directory: true,
    multiple: false,
    title: 'Choose your vault folder (e.g. your Obsidian vault)',
  });
  return typeof res === 'string' ? res : null;
};

export const vaultSetStarred = (
  path: string,
  starred: boolean,
  _mcp_id?: string,
): Promise<void> => gateInvoke('vault_set_starred', { path, starred });

export const vaultAliases = (
  path: string,
  _mcp_id?: string,
): Promise<string[]> => gateInvoke('vault_aliases', { path });

export const vaultWatchRecent = (
  since_ms: number,
  prefix?: string,
  mcp_id?: string,
): Promise<VaultWatchEvent[]> =>
  invoke('vault_watch_recent', {
    args: {
      since_ms,
      prefix: prefix ?? null,
      mcp_id: mcp_id ?? null,
    },
  });

// ADR-002 § vault v1 §8.4 — sourcing routine. Run produces a
// review-queue file at `.ctrl/review-queue/<date>.md`; pending
// reports the inbox size for the L2 badge.

export interface SourcingRunReport {
  review_path: string;
  items_processed: number;
  skipped_already_indexed: number;
}

export interface SourcingPendingReply {
  count: number;
}

export const vaultSourcingRun = (
  date: string,
  _mcp_id?: string,
): Promise<SourcingRunReport> => gateInvoke('vault_sourcing_run', { date });

export const vaultSourcingPending = (
  _mcp_id?: string,
): Promise<SourcingPendingReply> => gateInvoke('vault_sourcing_pending', {});

// ADR-005 v2 § soul-md-compat §4.3 — SOUL.md Tauri surface.
export interface IrisySoulView {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  soul_md_version: string;
}
// SOUL.md rides the gate's memory-domain tools (irisy_soul_get/set), same as
// external CLI drivers — the bespoke irisy_soul_read/write Tauri commands
// retired onto this one governed path (SC5 convergence). The gate get returns
// the identical { path, frontmatter, body, soul_md_version } shape.
export const irisySoulRead = (): Promise<IrisySoulView> =>
  gateInvoke('irisy_soul_get');
export const irisySoulWrite = (
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> =>
  gateInvoke('irisy_soul_set', { frontmatter, body });

// ADR-002 v5 §10 — vault embeddings TS surface.
export interface EmbeddingHit {
  path: string;
  score: number;
  snippet: string;
}
export interface EmbeddingStatus {
  total: number;
  embedded: number;
  stale: number;
  last_run_at_ms: number | null;
  provider_status: string;
  model: string;
}

export const vaultEmbedNote = (
  path: string,
): Promise<{ path: string; vector_dims: number; cached: boolean }> =>
  gateInvoke('vault_embed_note', { path });

export const vaultReembedAll = (
  force = false,
): Promise<{ embedded: number; skipped: number; failed: number }> =>
  gateInvoke('vault_reembed_all', { force });

export const vaultEmbeddingStatus = (): Promise<EmbeddingStatus> =>
  gateInvoke('vault_embedding_status');

export const vaultSemanticSearch = (
  query: string,
  limit = 10,
  threshold?: number,
): Promise<EmbeddingHit[]> =>
  gateInvoke('vault_semantic_search', { query, limit, threshold: threshold ?? null });

export const vaultSuggestLinks = (
  for_path: string,
  limit = 5,
): Promise<EmbeddingHit[]> =>
  gateInvoke('vault_suggest_links', { for_path, limit });

// Bespoke Irisy synthesis commands are retired; one Irisy capability path
// remains governed by its explicit context and gate scope.
// (ADR-005 irisy §11 v40)
// ADR-002 § vault v1 §8.6 v5 (2026-06-03) — vault-side git via the
// kernel-spawned git CLI. Mirrors src-tauri/src/commands/git.rs.

export interface GitStatusReply {
  initialised: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  clean: boolean;
  last_error: string | null;
}

export interface GitLogEntry {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export const gitStatus = (): Promise<GitStatusReply> => invoke('git_status');

export const gitInit = (): Promise<string> => invoke('git_init');

export const gitCommitAll = (message: string): Promise<string> =>
  invoke('git_commit_all', { args: { message } });

export const gitPush = (): Promise<string> => invoke('git_push');

/** One-click vault sync: init + stage + commit + push (composes git; the user's
 *  remote carries the vault, CTRL stays out of the data path). */
export const vaultGitSync = (): Promise<string> => invoke('vault_git_sync');

export const gitLog = (): Promise<GitLogEntry[]> => invoke('git_log');

// Screenshot OCR (ADR-002 substrate § OCR = on-device Vision). The kernel runs
// the interactive region capture + local text recognition; the PWA drops the
// recognized text into the composer. macOS-only for now (Windows path pending).
export interface ScreenshotOcrReply {
  text: string;
  char_count: number;
  cancelled: boolean;
}

export const captureScreenAndOcr = (): Promise<ScreenshotOcrReply> =>
  invoke('capture_screen_and_ocr');
