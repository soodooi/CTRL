// @ctrl/keycap-sdk — single stable interface for any client that consumes
// keycaps (Irisy / PWA components / future Janus persona / 3rd-party).
//
// Underlying transport (MCP / Tauri direct / REST) is hidden. ADR-010 §5
// says keycap = MCP server outward, but builtin / OAuth-wrap variants
// historically dispatch via Tauri invoke. SDK normalises both paths.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// Re-export manifest schema types + Zod parsers so consumers don't reach
// into a deeper module path (`@ctrl/keycap-sdk/manifest-schema`). Keep
// the surface flat: one package, one import path.
export type {
  L2NavItem,
  WorkspaceTab,
  WorkspaceDeclaration,
  UiSurface,
  WorkspaceUi,
} from './manifest-schema';
export {
  L2NavItem as L2NavItemSchema,
  WorkspaceTab as WorkspaceTabSchema,
  WorkspaceDeclaration as WorkspaceDeclarationSchema,
  UiSurface as UiSurfaceSchema,
  WorkspaceUi as WorkspaceUiSchema,
} from './manifest-schema';

/* ---------- Types ---------- */

export interface KeycapInfo {
  id: string;
  name: string;
  description?: string;
  /** Tools exposed by this keycap (MCP tool names). Empty = single-action keycap. */
  tools: KeycapToolInfo[];
  /** What kind of keycap implementation backs this. */
  variant: 'builtin' | 'mcp-server' | 'oauth' | 'cli-wrapper' | 'stss-publisher';
  /** Optional platform restriction. */
  platforms?: Array<'macos' | 'windows' | 'linux'>;
}

export interface KeycapToolInfo {
  name: string;
  description?: string;
  /** JSON Schema describing accepted args. */
  inputSchema?: unknown;
}

export interface KeycapResult {
  status: 'ok' | 'error' | 'cancelled' | 'permission_denied';
  /** Tool output payload. Shape depends on the keycap. */
  data?: unknown;
  error?: string;
}

export interface KeycapEvent {
  keycapId: string;
  kind: 'started' | 'progress' | 'output' | 'completed' | 'failed';
  ts: number;
  payload?: unknown;
}

export type Unsubscribe = () => void;

/* ---------- API ---------- */

/**
 * List installed keycaps available to the current user.
 */
export async function listKeycaps(): Promise<KeycapInfo[]> {
  try {
    // Tauri path first (desktop).
    const tools = await invoke<unknown[]>('list_tools');
    return (tools ?? []).map(normaliseToolDescriptor);
  } catch (_e) {
    // Browser / web-only fallback: hit ctrl backend REST (TBD wiring).
    return [];
  }
}

/**
 * Invoke a specific tool on a keycap. The keycap variant determines whether
 * this routes through MCP, Tauri direct command, or REST.
 */
export async function invokeKeycap(
  id: string,
  tool: string,
  args: unknown = {},
): Promise<KeycapResult> {
  try {
    // Pattern G builtin shortcut: screenshot keycap has a dedicated Tauri cmd.
    if (id === 'ctrl.builtin.screenshot') {
      const r = await invoke<{ status: string; error?: string }>(
        'screenshot_capture',
      );
      return {
        status: mapStatus(r.status),
        data: r,
        error: r.error,
      };
    }
    // Generic Tauri path: run_action (current builtin / pre-MCP keycaps).
    const out = await invoke<unknown>('run_action', { id, tool, args });
    return { status: 'ok', data: out };
  } catch (e: unknown) {
    return {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Subscribe to keycap lifecycle events (started / progress / output / done / failed).
 * Returns an unsubscribe function.
 */
export async function onKeycapEvent(
  handler: (event: KeycapEvent) => void,
): Promise<Unsubscribe> {
  try {
    const unlisten: UnlistenFn = await listen<KeycapEvent>(
      'keycap:event',
      (e) => handler(e.payload),
    );
    return unlisten;
  } catch (_e) {
    return () => undefined;
  }
}

/* ---------- Helpers ---------- */

function mapStatus(s: string): KeycapResult['status'] {
  switch (s) {
    case 'copied':
    case 'ok':
    case 'success':
      return 'ok';
    case 'cancelled':
      return 'cancelled';
    case 'permission_denied':
      return 'permission_denied';
    default:
      return 'error';
  }
}

function normaliseToolDescriptor(raw: unknown): KeycapInfo {
  const r = raw as {
    id?: string;
    name?: string;
    description?: string;
    tools?: Array<{ name: string; description?: string; input_schema?: unknown }>;
    variant?: KeycapInfo['variant'];
    platforms?: KeycapInfo['platforms'];
  };
  return {
    id: r.id ?? 'unknown',
    name: r.name ?? r.id ?? 'Unknown',
    description: r.description,
    variant: r.variant ?? 'builtin',
    platforms: r.platforms,
    tools: (r.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    })),
  };
}
