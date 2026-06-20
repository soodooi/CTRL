// Default-workspace layout — the configurable action panel that greets a user
// on the home screen (the Quicker-style "what do you want to do" surface).
//
// Design law (CLAUDE.md plain-text philosophy): the layout is a small,
// serializable, user-owned plain object — groups of action ids. The UI only
// RENDERS it; pin / remove / add / reorder are edits to this object. The user
// configures freely, but the framework stays minimal. Actions are NOT a new
// capability system: every action id points back into the existing capability
// catalog SSOT (capability-catalog.ts), so there is one source of truth for
// "what CTRL can do" and this file is purely "how the user arranged it".
//
// Storage seam: v1 persists to localStorage (shippable now, no kernel wiring).
// The serialize/parse pair is deliberately isolated so a later cut can back it
// with a vault file (`vault/ctrl/workspace.toml`) — local-is-truth, vim-test —
// without touching the UI or the mutation helpers.

import { CAPABILITY_CATALOG, type Capability } from './capability-catalog';

export interface WorkspaceGroup {
  /** Stable id (used as drag/drop + persistence key). */
  id: string;
  /** User-facing group heading. Fixed set in v1 (not user-renamed yet). */
  title: string;
  /** Ordered capability ids placed in this group. */
  actionIds: string[];
}

export interface WorkspaceLayout {
  version: 1;
  groups: WorkspaceGroup[];
}

const STORAGE_KEY = 'ctrl.workspace.layout.v1';

/** The id of the group that pinning targets (the compact top row). */
export const PINNED_GROUP_ID = 'pinned';

// The first-run arrangement. Derived from the catalog so it stays in sync with
// what is actually shippable: lead with zero-install actions a fresh user can
// run with only a provider configured. Order = the curated default; the user
// reshapes it from here.
export function defaultWorkspaceLayout(): WorkspaceLayout {
  return {
    version: 1,
    groups: [
      {
        id: PINNED_GROUP_ID,
        title: 'Pinned',
        actionIds: ['ocr-extract', 'draft-polish', 'summarize', 'plan'],
      },
      {
        id: 'ai-actions',
        title: 'AI Actions',
        actionIds: ['tone-translate', 'extract-actions', 'how-to', 'tutor'],
      },
      {
        id: 'create',
        title: 'Create',
        actionIds: ['html-artifact', 'slides', 'analyze-table'],
      },
    ],
  };
}

// ── capability lookup (action id -> catalog capability) ───────────────────────

let CAP_INDEX: Map<string, Capability> | null = null;

function capIndex(): Map<string, Capability> {
  if (!CAP_INDEX) {
    CAP_INDEX = new Map();
    for (const cat of CAPABILITY_CATALOG) {
      for (const cap of cat.capabilities) CAP_INDEX.set(cap.id, cap);
    }
  }
  return CAP_INDEX;
}

export function resolveAction(actionId: string): Capability | undefined {
  return capIndex().get(actionId);
}

/** Catalog capabilities NOT already placed anywhere in the layout, grouped by
 *  their catalog category — the data behind the "+ Add" picker. */
export function availableActions(
  layout: WorkspaceLayout,
): { title: string; capabilities: Capability[] }[] {
  const placed = new Set(layout.groups.flatMap((g) => g.actionIds));
  return CAPABILITY_CATALOG.map((cat) => ({
    title: cat.title,
    capabilities: cat.capabilities.filter((c) => !placed.has(c.id)),
  })).filter((cat) => cat.capabilities.length > 0);
}

// ── mutations (pure: every helper returns a NEW layout) ───────────────────────

function withGroups(layout: WorkspaceLayout, groups: WorkspaceGroup[]): WorkspaceLayout {
  return { ...layout, groups };
}

/** Add an action to a group (no-op if the group already holds it). */
export function addAction(
  layout: WorkspaceLayout,
  groupId: string,
  actionId: string,
): WorkspaceLayout {
  return withGroups(
    layout,
    layout.groups.map((g) =>
      g.id === groupId && !g.actionIds.includes(actionId)
        ? { ...g, actionIds: [...g.actionIds, actionId] }
        : g,
    ),
  );
}

/** Remove an action from a specific group. */
export function removeAction(
  layout: WorkspaceLayout,
  groupId: string,
  actionId: string,
): WorkspaceLayout {
  return withGroups(
    layout,
    layout.groups.map((g) =>
      g.id === groupId ? { ...g, actionIds: g.actionIds.filter((id) => id !== actionId) } : g,
    ),
  );
}

/** Toggle pin: present in Pinned -> remove it; absent -> move it to the front
 *  of Pinned and drop it from any other group (an action lives in one place). */
export function togglePinned(layout: WorkspaceLayout, actionId: string): WorkspaceLayout {
  const pinned = layout.groups.find((g) => g.id === PINNED_GROUP_ID);
  const isPinned = pinned?.actionIds.includes(actionId) ?? false;
  if (isPinned) return removeAction(layout, PINNED_GROUP_ID, actionId);
  return withGroups(
    layout,
    layout.groups.map((g) => {
      if (g.id === PINNED_GROUP_ID) return { ...g, actionIds: [actionId, ...g.actionIds] };
      return { ...g, actionIds: g.actionIds.filter((id) => id !== actionId) };
    }),
  );
}

/** Move an action to a target group at a target index (drag-and-drop reorder,
 *  works within a group and across groups). Removes from wherever it was. */
export function moveAction(
  layout: WorkspaceLayout,
  actionId: string,
  toGroupId: string,
  toIndex: number,
): WorkspaceLayout {
  const stripped = layout.groups.map((g) => ({
    ...g,
    actionIds: g.actionIds.filter((id) => id !== actionId),
  }));
  return withGroups(
    layout,
    stripped.map((g) => {
      if (g.id !== toGroupId) return g;
      const next = [...g.actionIds];
      const idx = Math.max(0, Math.min(toIndex, next.length));
      next.splice(idx, 0, actionId);
      return { ...g, actionIds: next };
    }),
  );
}

// ── persistence (localStorage seam; vault-file-ready) ─────────────────────────

/** Serialize to the stored string form. Isolated so a vault-file backing can
 *  swap this without touching callers. */
export function serializeLayout(layout: WorkspaceLayout): string {
  return JSON.stringify(layout);
}

/** Parse stored form back to a layout, dropping any action ids that no longer
 *  exist in the catalog (a removed capability shouldn't render as a dead card).
 *  Returns null when the input is unusable so callers fall back to default. */
export function parseLayout(raw: string): WorkspaceLayout | null {
  try {
    const data = JSON.parse(raw) as Partial<WorkspaceLayout>;
    if (!data || data.version !== 1 || !Array.isArray(data.groups)) return null;
    const groups: WorkspaceGroup[] = data.groups
      .filter(
        (g): g is WorkspaceGroup =>
          !!g && typeof g.id === 'string' && Array.isArray(g.actionIds),
      )
      .map((g) => ({
        id: g.id,
        title: typeof g.title === 'string' ? g.title : g.id,
        actionIds: g.actionIds.filter((id) => typeof id === 'string' && resolveAction(id)),
      }));
    return groups.length > 0 ? { version: 1, groups } : null;
  } catch {
    return null;
  }
}

export function loadWorkspaceLayout(): WorkspaceLayout {
  if (typeof localStorage === 'undefined') return defaultWorkspaceLayout();
  const raw = localStorage.getItem(STORAGE_KEY);
  return (raw && parseLayout(raw)) || defaultWorkspaceLayout();
}

export function saveWorkspaceLayout(layout: WorkspaceLayout): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, serializeLayout(layout));
}
