// Cross-window event contract. The keyboard window is the controller and
// holds source-of-truth state; the pool and workspace windows are
// subordinate views that subscribe to broadcasts and emit user-action
// events back. All payloads are JSON; Tauri serializes them transparently.

import { emit, emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Tool } from './tools';

// ─── Window labels (must match tauri.conf.json) ──────────────────────────────

export const WINDOW_KEYBOARD = 'main';
export const WINDOW_POOL = 'pool';
export const WINDOW_WORKSPACE = 'workspace';

// ─── State broadcasts (keyboard → others) ────────────────────────────────────

export const EV_TOOLS_STATE = 'tools:state';
export interface ToolsStatePayload {
  poolTools: Tool[];
  suggestedToolIds: string[];
  /** null when no chord pending; otherwise tool ids whose chord starts with the prefix. */
  chordCandidateIds: string[] | null;
  aiReady: boolean;
  suggestionLabel: string | null;
}

export const EV_WORKSPACE_STATE = 'workspace:state';
export type WorkspaceResultKind = 'success' | 'error' | 'notify';
export interface WorkspaceResultPayload {
  text: string;
  kind: WorkspaceResultKind;
  toolName?: string;
  retryable?: boolean;
  isChat?: boolean;
}
export interface WorkspaceStatePayload {
  result: WorkspaceResultPayload | null;
  canRetry: boolean;
}

// ─── Action events (others → keyboard) ───────────────────────────────────────

export const EV_POOL_RUN = 'pool:run';
export interface PoolRunPayload {
  toolId: string;
  actionId?: string; // omitted = first action
}

export const EV_POOL_PIN_TOGGLE = 'pool:pin-toggle';
export interface PoolPinTogglePayload {
  toolId: string;
}

export const EV_POOL_CLOSE = 'pool:close';
export const EV_WORKSPACE_CLOSE = 'workspace:close';
export const EV_WORKSPACE_RETRY = 'workspace:retry';

export const EV_WORKSPACE_COPY = 'workspace:copy';
export interface WorkspaceCopyPayload {
  text: string;
}

export const EV_WORKSPACE_CHAT_SEND = 'workspace:chat-send';
export interface WorkspaceChatSendPayload {
  prompt: string;
  /** Prior turns the chat workspace has on screen, oldest first. */
  history: { role: 'user' | 'assistant'; text: string }[];
}

// ─── Typed broadcast helpers ─────────────────────────────────────────────────

export function broadcastToolsState(payload: ToolsStatePayload): Promise<void> {
  return emit(EV_TOOLS_STATE, payload);
}

export function broadcastWorkspaceState(payload: WorkspaceStatePayload): Promise<void> {
  return emit(EV_WORKSPACE_STATE, payload);
}

// ─── Typed emit helpers (subordinate → keyboard) ─────────────────────────────

export function emitToKeyboard<P>(eventName: string, payload?: P): Promise<void> {
  return emitTo(WINDOW_KEYBOARD, eventName, payload);
}

// ─── Typed listen helpers ────────────────────────────────────────────────────

export function listenTyped<P>(
  eventName: string,
  handler: (payload: P) => void,
): Promise<UnlistenFn> {
  return listen<P>(eventName, (e) => handler(e.payload));
}
