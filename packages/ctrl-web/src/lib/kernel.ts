// @ctrl/web — typed wrappers over kernel commands.
//
// Each function maps 1:1 to a `#[tauri::command]` in `src-tauri/src/commands/`.
// Argument and return shapes mirror the Rust structs.

import { invoke } from './bridge';

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
