// usePiRpc — typed wrappers around the generic `pi_rpc` / `pi_sessions` /
// `restart_brain` Tauri commands.
//
// bao 2026-06-05 ("open all Pi capability"): every Pi RpcClient method
// is reachable from the PWA via these wrappers. Each fn here is a thin
// `invoke('pi_rpc', { method, args })` call; the heavy lifting happens
// in PiBridge.callRpc on the daemon side. No bespoke per-method state.
//
// Naming: one function per RpcClient method, plus listSessions /
// deleteSession that hit the /api/sessions fs route, plus
// refreshBrain that kills + respawns the ctrl-pi-mcp daemon.

import { invoke } from '@tauri-apps/api/core';

async function rpc<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
  return (await invoke<T>('pi_rpc', { method, args })) as T;
}

// ── Session lifecycle ──────────────────────────────────────────────────

export interface SessionMeta {
  path: string;
  id: string;
  name: string | null;
  createdAt: string;
  firstMessage: string | null;
  sizeBytes: number;
}

export const listSessions = (): Promise<SessionMeta[]> =>
  invoke<SessionMeta[]>('pi_sessions', { op: 'list', path: null });

export const deleteSession = (path: string): Promise<{ ok: boolean }> =>
  invoke<{ ok: boolean }>('pi_sessions', { op: 'delete', path });

export const newSession = (parentSession?: string): Promise<{ cancelled: boolean }> =>
  rpc('newSession', parentSession ? [parentSession] : []);

export const switchSession = (sessionPath: string): Promise<{ cancelled: boolean }> =>
  rpc('switchSession', [sessionPath]);

export const fork = (entryId: string): Promise<{ text: string; cancelled: boolean }> =>
  rpc('fork', [entryId]);

export const cloneSession = (): Promise<{ cancelled: boolean }> => rpc('clone');

export const getForkMessages = (): Promise<Array<{ entryId: string; text: string }>> =>
  rpc('getForkMessages');

export const setSessionName = (name: string): Promise<void> => rpc('setSessionName', [name]);

export const getState = (): Promise<unknown> => rpc('getState');

export const getSessionStats = (): Promise<unknown> => rpc('getSessionStats');

export const getMessages = (): Promise<unknown[]> => rpc('getMessages');

export const getLastAssistantText = (): Promise<string | null> => rpc('getLastAssistantText');

// ── Steering / abort ───────────────────────────────────────────────────

export const steer = (message: string): Promise<void> => rpc('steer', [message]);

export const followUp = (message: string): Promise<void> => rpc('followUp', [message]);

export const abort = (): Promise<void> => rpc('abort');

export const setSteeringMode = (mode: 'all' | 'one-at-a-time'): Promise<void> =>
  rpc('setSteeringMode', [mode]);

export const setFollowUpMode = (mode: 'all' | 'one-at-a-time'): Promise<void> =>
  rpc('setFollowUpMode', [mode]);

// ── Model + Thinking ───────────────────────────────────────────────────

export interface ModelInfo {
  provider: string;
  id: string;
  contextWindow: number;
  reasoning: boolean;
}

export const getAvailableModels = (): Promise<ModelInfo[]> => rpc('getAvailableModels');

export const setModel = (provider: string, modelId: string): Promise<{ provider: string; id: string }> =>
  rpc('setModel', [provider, modelId]);

export const cycleModel = (): Promise<unknown> => rpc('cycleModel');

export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

export const setThinkingLevel = (level: ThinkingLevel): Promise<void> =>
  rpc('setThinkingLevel', [level]);

export const cycleThinkingLevel = (): Promise<unknown> => rpc('cycleThinkingLevel');

// ── Compaction / auto-retry ────────────────────────────────────────────

export const compact = (customInstructions?: string): Promise<unknown> =>
  rpc('compact', customInstructions ? [customInstructions] : []);

export const setAutoCompaction = (enabled: boolean): Promise<void> =>
  rpc('setAutoCompaction', [enabled]);

export const setAutoRetry = (enabled: boolean): Promise<void> =>
  rpc('setAutoRetry', [enabled]);

export const abortRetry = (): Promise<void> => rpc('abortRetry');

// ── Bash relay ─────────────────────────────────────────────────────────

export const bash = (command: string): Promise<unknown> => rpc('bash', [command]);

export const abortBash = (): Promise<void> => rpc('abortBash');

// ── Export / commands ──────────────────────────────────────────────────

export const exportHtml = (outputPath?: string): Promise<{ path: string }> =>
  rpc('exportHtml', outputPath ? [outputPath] : []);

export const getCommands = (): Promise<unknown[]> => rpc('getCommands');

// ── Brain daemon control ───────────────────────────────────────────────

/** Kill the ctrl-pi-mcp daemon and let the supervisor respawn it within
 *  ~500ms. Picks up wrapper-file or `--extension` changes since the
 *  last spawn. Use after editing pi-bridge.ts / adding extensions in
 *  dev, or as a "refresh brain" UI affordance. */
export const refreshBrain = (): Promise<string> => invoke<string>('restart_brain');
