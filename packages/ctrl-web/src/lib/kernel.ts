// @ctrl/web — typed wrappers over kernel commands.
//
// Each function maps 1:1 to a `#[tauri::command]` in `src-tauri/src/commands/`.
// Argument and return shapes mirror the Rust structs.

import { invoke } from './bridge';
import type { Icon } from './icon';

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
  stss_bridge_addr: string;
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

// `icon` is widened to `Icon | string` for forward-compat with the
// kernel schema migration to a discriminated union (per
// .olym/skills/thorvg/SKILL.md §1 / brand-tokens §12.2). Today the
// kernel ships single-glyph strings; consumers must run the value
// through `normalizeIcon()` from `lib/icon.ts` before rendering.
export interface McpSummary {
  id: string;
  name: string;
  mcp_color: string;
  icon: Icon | string;
}

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
  /** Recommended model ids — <datalist> fallback before the user types
   *  their key (decision 0007 §per-provider-models). Optional: older
   *  catalog snapshots / user overrides without the field keep the
   *  free-text-only behaviour. */
  models?: string[];
}

// Browser/dev fallback: outside Tauri (PWA dev preview) `invoke` rejects,
// so serve a bundled subset and the provider UI still renders. The real,
// full 20-template list comes from the kernel in the desktop app.
const FALLBACK_PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { id: 'anthropic', label: 'Anthropic Claude', defaultName: 'Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-6', keyHint: 'sk-ant-...; console.anthropic.com/settings/keys' },
  { id: 'volc', label: 'Volcano Ark / Doubao (ByteDance)', defaultName: 'Volc Doubao', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-1-5-pro-32k-250115', keyHint: 'UUID; console.volcengine.com -> API Key Management' },
  { id: 'zhipu', label: 'Zhipu GLM', defaultName: 'GLM', protocol: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', defaultModel: 'glm-5.2', keyHint: 'create an API key at z.ai → API Keys', models: ['glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.6', 'glm-4.5-air', 'glm-4-long'] },
  { id: 'openai', label: 'OpenAI', defaultName: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyHint: 'sk-...; platform.openai.com/api-keys' },
  { id: 'deepseek', label: 'DeepSeek', defaultName: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', keyHint: 'sk-...; platform.deepseek.com' },
  { id: 'kimi', label: 'Moonshot Kimi', defaultName: 'Kimi', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', keyHint: 'sk-...; platform.moonshot.cn' },
  { id: 'qwen', label: 'Alibaba Qwen (DashScope)', defaultName: 'Qwen', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-max', keyHint: 'sk-...; dashscope.console.aliyun.com' },
  { id: 'openrouter', label: 'OpenRouter', defaultName: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-3.5-sonnet', keyHint: 'sk-or-...; openrouter.ai/keys' },
  { id: 'custom', label: 'Custom (any OpenAI-compatible endpoint)', defaultName: '', protocol: 'openai', baseUrl: '', defaultModel: '', keyHint: 'paste your API key' },
];

export const listProviderTemplates = async (): Promise<ProviderTemplate[]> => {
  try {
    return await invoke<ProviderTemplate[]>('list_provider_templates');
  } catch {
    return FALLBACK_PROVIDER_TEMPLATES;
  }
};

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

export const setProviderKey = (args: SetProviderKeyArgs): Promise<void> =>
  invoke('config_set_provider_key', { args });

export interface TestProviderResult {
  success: boolean;
  message: string;
  elapsed_ms: number;
  model_count: number | null;
}

export const testProvider = (provider: string): Promise<TestProviderResult> =>
  invoke('config_test_provider', { args: { provider } });

// ADR-002 § provider v24 + vault 0012 (2026-06-15): generic model discovery via
// the OpenAI-compatible /v1/models standard — works for ANY endpoint (local
// ollama/LM Studio/llama.cpp, cloud, relay), no hardcoded per-runtime logic.
// Returns [] when the endpoint is down or doesn't support listing.
export const listModels = (baseUrl: string, apiKey?: string): Promise<string[]> =>
  invoke('provider_list_models', { args: { base_url: baseUrl, api_key: apiKey } });

export const deleteProvider = (provider: string): Promise<void> =>
  invoke('config_delete_provider', { args: { provider } });

// Irisy conversation history (reads hermes's session store via the kernel).
// ADR-002 § provider v27 + vault/ctrl/strategy/0012 §8 (2026-06-16).
export interface IrisySessionSummary {
  id: string;
  title: string;
  preview: string;
  started_at: string | null;
  ended_at: string | null;
  message_count: number;
}
export interface IrisySessionTurn {
  role: string;
  content: string;
}
export const listIrisySessions = (): Promise<IrisySessionSummary[]> =>
  invoke('irisy_session_list');
export const getIrisySession = (id: string): Promise<IrisySessionTurn[]> =>
  invoke('irisy_session_get', { id });

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

export const subscribe = (stream_id: string): Promise<StreamHandle> =>
  invoke('subscribe', { args: { stream_id } });

export const publish = (
  stream_id: string,
  kind: string,
  payload: unknown,
): Promise<void> =>
  invoke('publish', { args: { stream_id, kind, payload } });

export const listStreams = (): Promise<string[]> => invoke('list_streams');

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

// === Code Space (remote coding envs) ===
//
// All cs_* commands live behind these typed wrappers so the rest of the
// app never strings-types the Rust command names. Mirrors the Rust
// signatures in src-tauri/src/commands/code_space.rs.

/** Default PTY geometry. cs_spawn applies the same fallbacks server-side
    if omitted, but supplying them here keeps the frontend honest about
    what it asked for and gives the NewEnvModal a single place to override. */
export const DEFAULT_PTY_COLS = 80;
export const DEFAULT_PTY_ROWS = 24;

export interface CsSpawnArgs {
  command: string;
  args?: ReadonlyArray<string>;
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  cols?: number;
  rows?: number;
}

export interface CsSpawnReply {
  stream_id: string;
}

export const csSpawn = (spec: CsSpawnArgs): Promise<CsSpawnReply> =>
  invoke('cs_spawn', {
    args: {
      cols: DEFAULT_PTY_COLS,
      rows: DEFAULT_PTY_ROWS,
      ...spec,
    },
  });

/** Today returns `string[]` of active stream_ids. Defensive `unknown`
    return type lets callers map into a richer envelope when the kernel
    extends cs_list without breaking this typed surface. */
export const csList = (): Promise<unknown> => invoke('cs_list');

export const csStdin = (stream_id: string, data_b64: string): Promise<void> =>
  invoke('cs_stdin', { args: { stream_id, data_b64 } });

export const csResize = (stream_id: string, cols: number, rows: number): Promise<void> =>
  invoke('cs_resize', { args: { stream_id, cols, rows } });

export const csSignal = (stream_id: string, signal: string): Promise<void> =>
  invoke('cs_signal', { args: { stream_id, signal } });

export const csKill = (stream_id: string): Promise<void> =>
  invoke('cs_kill', { args: { stream_id } });

// === Vault (markdown + assets at ~/Documents/CTRL/) =================
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

export const vaultWrite = (args: VaultWriteArgs): Promise<VaultWriteReply> =>
  invoke('vault_write', { args });

export const vaultRead = (path: string, mcp_id?: string): Promise<VaultEntry> =>
  invoke('vault_read', { args: { path, mcp_id: mcp_id ?? null } });

export const vaultList = (
  subdir?: string,
  mcp_id?: string,
): Promise<string[]> =>
  invoke('vault_list', {
    args: { subdir: subdir ?? null, mcp_id: mcp_id ?? null },
  });

export const vaultSearch = (
  query: string,
  limit = 50,
  mcp_id?: string,
): Promise<string[]> =>
  invoke('vault_search', {
    args: { query, limit, mcp_id: mcp_id ?? null },
  });

export const vaultDelete = (path: string, mcp_id?: string): Promise<void> =>
  invoke('vault_delete', { args: { path, mcp_id: mcp_id ?? null } });

export const vaultRootPath = (): Promise<string> => invoke('vault_root_path');

export const vaultRebuildIndex = (): Promise<number> =>
  invoke('vault_rebuild_index');

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
  mcp_id?: string,
): Promise<BacklinkHit[]> =>
  invoke('vault_backlinks', { args: { path, mcp_id: mcp_id ?? null } });

export const vaultTags = (mcp_id?: string): Promise<TagCount[]> =>
  invoke('vault_tags', { args: { mcp_id: mcp_id ?? null } });

export const vaultNotesByTag = (
  tag: string,
  mcp_id?: string,
): Promise<string[]> =>
  invoke('vault_notes_by_tag', { args: { tag, mcp_id: mcp_id ?? null } });

export const vaultMentions = (
  text: string,
  mcp_id?: string,
): Promise<MentionHit[]> =>
  invoke('vault_mentions', { args: { text, mcp_id: mcp_id ?? null } });

export const vaultOrphans = (mcp_id?: string): Promise<string[]> =>
  invoke('vault_orphans', { args: { mcp_id: mcp_id ?? null } });

export const vaultBrokenLinks = (mcp_id?: string): Promise<BrokenLink[]> =>
  invoke('vault_broken_links', { args: { mcp_id: mcp_id ?? null } });

export const vaultGraphData = (mcp_id?: string): Promise<GraphData> =>
  invoke('vault_graph_data', { args: { mcp_id: mcp_id ?? null } });

export const vaultRename = (
  from: string,
  to: string,
  mcp_id?: string,
): Promise<void> =>
  invoke('vault_rename', { args: { from, to, mcp_id: mcp_id ?? null } });

export const vaultMove = (
  from: string,
  to: string,
  mcp_id?: string,
): Promise<void> =>
  invoke('vault_move', { args: { from, to, mcp_id: mcp_id ?? null } });

export const vaultCreateFolder = (
  path: string,
  mcp_id?: string,
): Promise<void> =>
  invoke('vault_create_folder', {
    args: { path, mcp_id: mcp_id ?? null },
  });

export const vaultSetStarred = (
  path: string,
  starred: boolean,
  mcp_id?: string,
): Promise<void> =>
  invoke('vault_set_starred', {
    args: { path, starred, mcp_id: mcp_id ?? null },
  });

export const vaultAliases = (
  path: string,
  mcp_id?: string,
): Promise<string[]> =>
  invoke('vault_aliases', { args: { path, mcp_id: mcp_id ?? null } });

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
  mcp_id?: string,
): Promise<SourcingRunReport> =>
  invoke('vault_sourcing_run', {
    args: { date, mcp_id: mcp_id ?? null },
  });

export const vaultSourcingPending = (
  mcp_id?: string,
): Promise<SourcingPendingReply> =>
  invoke('vault_sourcing_pending', {
    args: { mcp_id: mcp_id ?? null },
  });

// ADR-005 v2 § soul-md-compat §4.3 — SOUL.md Tauri surface.
export interface IrisySoulView {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  soul_md_version: string;
}
export const irisySoulRead = (): Promise<IrisySoulView> =>
  invoke('irisy_soul_read');
export const irisySoulWrite = (
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> =>
  invoke('irisy_soul_write', { args: { frontmatter, body } });

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
  invoke('vault_embed_note', { args: { path } });

export const vaultReembedAll = (
  force = false,
): Promise<{ embedded: number; skipped: number; failed: number }> =>
  invoke('vault_reembed_all', { args: { force } });

export const vaultEmbeddingStatus = (): Promise<EmbeddingStatus> =>
  invoke('vault_embedding_status');

export const vaultSemanticSearch = (
  query: string,
  limit = 10,
  threshold?: number,
): Promise<EmbeddingHit[]> =>
  invoke('vault_semantic_search', {
    args: { query, limit, threshold: threshold ?? null },
  });

export const vaultSuggestLinks = (
  for_path: string,
  limit = 5,
): Promise<EmbeddingHit[]> =>
  invoke('vault_suggest_links', { args: { for_path, limit } });

// Irisy synthesize — Layer 4 surface
// (brainstorm §5.3 / §5.5 / §5.10)
export interface QuestionVaultReply {
  answer: string;
  citations: string[];
}
export const irisyQuestionVault = (
  question: string,
  top_k = 6,
): Promise<QuestionVaultReply> =>
  invoke('irisy_question_vault', { args: { question, top_k } });

export interface SynthesizeReply {
  result: string;
  written_to: string | null;
}
export const irisySynthesizeNotes = (
  paths: string[],
  instruction: string,
  output_path?: string,
): Promise<SynthesizeReply> =>
  invoke('irisy_synthesize_notes', {
    args: { paths, instruction, output_path: output_path ?? null },
  });

export interface DailySummarizeReply {
  daily_path: string;
  summary: string;
  items_in_inbox: number;
}
export const irisyDailySummarize = (
  date?: string,
): Promise<DailySummarizeReply> =>
  invoke('irisy_daily_summarize', { args: { date: date ?? null } });

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
