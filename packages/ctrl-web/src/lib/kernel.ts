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

// `icon` is widened to `Icon | string` for forward-compat with the
// kernel schema migration to a discriminated union (per
// .olym/skills/thorvg/SKILL.md §1 / brand-tokens §12.2). Today the
// kernel ships single-glyph strings; consumers must run the value
// through `normalizeIcon()` from `lib/icon.ts` before rendering.
export interface KeycapSummary {
  id: string;
  name: string;
  keycap_color: string;
  icon: Icon | string;
}

export const listKeycaps = (): Promise<KeycapSummary[]> =>
  invoke('list_keycaps');

export interface McpInstallArgs {
  server_url: string;
  tool_name: string;
  display_name: string;
  keycap_color?: string;
  icon?: string;
}

export const installKeycapFromMcp = (args: McpInstallArgs): Promise<KeycapSummary> =>
  invoke('install_keycap_from_mcp', { args });

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

export interface SetProviderKeyArgs {
  provider: string;
  api_key: string;
  base_url?: string;
  default_model?: string;
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

export const deleteProvider = (provider: string): Promise<void> =>
  invoke('config_delete_provider', { args: { provider } });

export interface RunKeycapResult {
  output: unknown;
  duration_ms: number;
}

export const runKeycap = (keycap_id: string, input: unknown): Promise<RunKeycapResult> =>
  invoke('run_keycap', { args: { keycap_id, input } });

export const mcpCall = (
  server_url: string,
  tool_name: string,
  args: unknown,
): Promise<unknown> =>
  invoke('mcp_call', { args: { server_url, tool_name, args } });

export const listMcpServers = (): Promise<string[]> => invoke('list_mcp_servers');

/**
 * Open the dedicated workspace window for a keycap activation.
 *
 * Per bao 2026-05-14: workspace is a SECOND window, separate from the
 * launcher pool, opened on demand per selected keycap. The workspace
 * window reuses across activations (single window, route reflects the
 * latest keycap).
 */
export const openWorkspace = (keycap_id: string): Promise<void> =>
  invoke('open_workspace', { keycap_id });

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
  /** Body excluding the YAML frontmatter block. */
  body: string;
  /** Parsed frontmatter as plain JSON. */
  frontmatter: Record<string, unknown>;
  /** Last modified, ms since epoch. */
  modified_ms: number;
  /** Byte size of the on-disk file. */
  size_bytes: number;
}

export interface VaultWriteArgs {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  keycap_id?: string;
}

export interface VaultWriteReply {
  absolute_path: string;
  path: string;
}

export const vaultWrite = (args: VaultWriteArgs): Promise<VaultWriteReply> =>
  invoke('vault_write', { args });

export const vaultRead = (path: string, keycap_id?: string): Promise<VaultEntry> =>
  invoke('vault_read', { args: { path, keycap_id: keycap_id ?? null } });

export const vaultList = (
  subdir?: string,
  keycap_id?: string,
): Promise<string[]> =>
  invoke('vault_list', {
    args: { subdir: subdir ?? null, keycap_id: keycap_id ?? null },
  });

export const vaultSearch = (
  query: string,
  limit = 50,
  keycap_id?: string,
): Promise<string[]> =>
  invoke('vault_search', {
    args: { query, limit, keycap_id: keycap_id ?? null },
  });

export const vaultDelete = (path: string, keycap_id?: string): Promise<void> =>
  invoke('vault_delete', { args: { path, keycap_id: keycap_id ?? null } });

export const vaultRootPath = (): Promise<string> => invoke('vault_root_path');

export const vaultRebuildIndex = (): Promise<number> =>
  invoke('vault_rebuild_index');
