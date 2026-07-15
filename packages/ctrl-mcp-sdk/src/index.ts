// @ctrl/mcp-sdk — single stable interface for any client that consumes
// mcps (Irisy / PWA components / future Janus persona / 3rd-party).
//
// Underlying transport (MCP / Tauri direct / REST) is hidden. ADR-004 cap § execution v1 §5
// says mcp = MCP server outward, but builtin / OAuth-wrap variants
// historically dispatch via Tauri invoke. SDK normalises both paths.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// Re-export manifest schema types, parser, and Zod schemas so supported SDK
// consumers can observe retired-value migration warnings without reaching into
// a private module path. Retired values remain parse-only and have no executor.
// (ADR-002 substrate § composition v65)
export type {
  L2NavItem,
  WorkspaceTab,
  WorkspaceDeclaration,
  UiSurface,
  WorkspaceUi,
  McpManifest,
  ValidationResult,
} from './manifest-schema';
export {
  L2NavItem as L2NavItemSchema,
  WorkspaceTab as WorkspaceTabSchema,
  WorkspaceDeclaration as WorkspaceDeclarationSchema,
  UiSurface as UiSurfaceSchema,
  WorkspaceUi as WorkspaceUiSchema,
  McpManifest as McpManifestSchema,
  // Public migration warnings for retired values; no live route is restored.
  // (ADR-002 substrate § composition v65)
  parseManifest,
} from './manifest-schema';

/* ---------- Types ---------- */

export interface McpInfo {
  id: string;
  name: string;
  description?: string;
  /** Tools exposed by this mcp (MCP tool names). Empty = single-action mcp. */
  tools: McpToolInfo[];
  /** What kind of mcp implementation backs this.
   *  `stss-publisher` is observable only for retired-manifest migration; it
   *  has no supported dispatch route. (ADR-002 substrate § composition v65) */
  variant:
    | 'builtin'
    | 'mcp-server'
    | 'oauth'
    | 'cli-wrapper'
    | 'local-agent'
    | 'skill'
    | 'stss-publisher';
  /** Optional platform restriction. */
  platforms?: Array<'macos' | 'windows' | 'linux'>;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  /** JSON Schema describing accepted args. */
  inputSchema?: unknown;
}

export interface McpResult {
  status: 'ok' | 'error' | 'cancelled' | 'permission_denied';
  /** Tool output payload. Shape depends on the mcp. */
  data?: unknown;
  error?: string;
}

export interface McpEvent {
  mcpId: string;
  kind: 'started' | 'progress' | 'output' | 'completed' | 'failed';
  ts: number;
  payload?: unknown;
}

export type Unsubscribe = () => void;

/* ---------- API ---------- */

/**
 * List installed mcps available to the current user.
 */
export async function listMcps(): Promise<McpInfo[]> {
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
 * Invoke a specific tool on a mcp. The mcp variant determines whether
 * this routes through MCP, Tauri direct command, or REST.
 */
export async function invokeMcp(
  id: string,
  tool: string,
  args: unknown = {},
): Promise<McpResult> {
  try {
    // Pattern G builtin shortcut: screenshot mcp has a dedicated Tauri cmd.
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
    // Generic Tauri path: run_action (current builtin / pre-MCP mcps).
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
 * Subscribe to mcp lifecycle events (started / progress / output / done / failed).
 * Returns an unsubscribe function.
 */
export async function onMcpEvent(
  handler: (event: McpEvent) => void,
): Promise<Unsubscribe> {
  try {
    const unlisten: UnlistenFn = await listen<McpEvent>(
      'mcp:event',
      (e) => handler(e.payload),
    );
    return unlisten;
  } catch (_e) {
    return () => undefined;
  }
}

/* ---------- Helpers ---------- */

function mapStatus(s: string): McpResult['status'] {
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

function normaliseToolDescriptor(raw: unknown): McpInfo {
  const r = raw as {
    id?: string;
    name?: string;
    description?: string;
    tools?: Array<{ name: string; description?: string; input_schema?: unknown }>;
    variant?: McpInfo['variant'];
    platforms?: McpInfo['platforms'];
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
