// workspace-shape — the "workspace template" model.
//
// Per bao 2026-05-25 + 2026-05-25 architecture review: a workspace is
// NOT a separately-managed user-facing template gallery. Its shape is
// DERIVED from the mcp's (source × target). One canonical lookup
// table, edited in code. Power users override per-mcp via the
// manifest's optional `workspace?` field.
//
// This module is the lookup. `workspace-store.ts` is where instances
// get spawned; `WorkspaceShell.tsx` renders them.

import type { TabKind } from './tab-store';

export type McpKind =
  | 'mcp-tool' // 90% default (kernel MCP server exposing tools)
  | 'brain' // text.chat producer (pi)
  | 'oauth-platform' // feishu / notion / linear OAuth-backed
  | 'local-cli' // wrapped command-line tool
  | 'builtin'; // simplest default

export type WorkspaceLayout = 'single' | 'tabs' | 'split-h' | 'split-v';

/**
 * A single tab spec in a shape. `kind` matches TabKind from tab-store
 * so the existing renderer keeps working; `title` is the default
 * label (instance customizes if user renames).
 */
export interface TabSpec {
  kind: TabKind;
  title: string;
  /** Tab-kind specific seed. `mcp-output` gets `{mcpId}`, etc. */
  initialState?: Record<string, unknown>;
}

export interface ShapeSpec {
  layout: WorkspaceLayout;
  tabs: ReadonlyArray<TabSpec>;
}

/**
 * Canonical derivation table. Keep this small — the cleaner the table,
 * the less time users spend trying to predict what their click will do.
 *
 * 'tabs' layout = a tab strip + active tab fills body (today's TabBar).
 * 'single' = one body, no tab strip (smallest cognitive load).
 * 'split-h' / 'split-v' = future, currently fall back to 'tabs' in the
 * renderer until a Pane split component lands.
 */
export const SHAPE_BY_KIND: Readonly<Record<McpKind, ShapeSpec>> = {
  'mcp-tool': {
    layout: 'single',
    tabs: [{ kind: 'mcp-output', title: 'Run' }],
  },
  brain: {
    layout: 'tabs',
    tabs: [{ kind: 'session-stream', title: 'Chat' }],
  },
  'oauth-platform': {
    layout: 'tabs',
    tabs: [
      { kind: 'external-embed', title: 'Viewer' },
      { kind: 'mcp-output', title: 'Actions' },
    ],
  },
  'local-cli': {
    layout: 'tabs',
    tabs: [{ kind: 'session-stream', title: 'Terminal' }],
  },
  builtin: {
    layout: 'single',
    tabs: [{ kind: 'mcp-output', title: 'Output' }],
  },
};

/**
 * Stand-in until zeus's D1 envelope ships `target` + `source` per-mcp.
 * Mirrors the inferTarget/inferSource logic from pool.tsx — the moment
 * the real fields land, drop this in favor of reading `k.target`.
 */
export const inferKindFromId = (id: string): McpKind => {
  if (id === 'pi') return 'brain';
  if (id.startsWith('mcp:')) return 'mcp-tool';
  if (id.startsWith('oauth:')) return 'oauth-platform';
  if (id.startsWith('local:')) return 'local-cli';
  return 'mcp-tool'; // safest builtin default — most builtins are MCP tools
};

/** Look up the shape for a mcp. Always returns a shape — never null. */
export const deriveShape = (mcpId: string): ShapeSpec =>
  SHAPE_BY_KIND[inferKindFromId(mcpId)];
