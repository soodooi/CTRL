// @ctrl/web — typed wrappers over kernel commands.
//
// Each function maps 1:1 to a `#[tauri::command]` in `src-tauri/src/commands/`.
// Argument and return shapes mirror the Rust structs.

import { invoke } from './bridge';

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
}

export const kernelStatus = (): Promise<KernelStatus> =>
  invoke<KernelStatus>('kernel_status');

export interface KeycapSummary {
  id: string;
  name: string;
  keycap_color: string;
  icon: string;
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
