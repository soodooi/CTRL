// Default-workspace layout — the number-row action panel that greets a user on
// the home screen (the Quicker-style "what do you want to do" surface).
//
// Design law (`.kiro/steering/development-philosophy.md` plain-text
// philosophy + bao 2026-06-19): the layout is
// a small, serializable, user-owned plain object — one ordered list of action
// ids that maps onto the keyboard's number row (slot 0 → key "1" … slot 9 →
// key "0"). The UI only RENDERS it; add / remove / reorder are edits to this
// list. Actions are NOT a new capability system: every id points back into the
// existing capability catalog SSOT (capability-catalog.ts).
//
// Storage seam: v2 persists to localStorage. The serialize/parse pair is
// isolated so a later cut can back it with a vault file (workspace.toml) —
// local-is-truth, vim-test — without touching the UI or the helpers.

import { CAPABILITY_CATALOG, type Capability } from './capability-catalog';

export interface WorkspaceLayout {
  version: 2;
  /** Ordered action ids — the number row. Capped at MAX_SLOTS (keys 1..9, 0). */
  slots: string[];
}

const STORAGE_KEY = 'ctrl.workspace.layout.v2';

/** The keyboard number row holds ten keys (1-9 then 0). */
export const MAX_SLOTS = 10;

// The first-run row. Derived from the catalog so it stays in sync with what is
// shippable: the screenshot grab leads, then the highest-usage zero-install
// actions a fresh user can run with only a provider configured.
export function defaultWorkspaceLayout(): WorkspaceLayout {
  return {
    version: 2,
    slots: [
      'screenshot-ocr',
      'draft-polish',
      'summarize',
      'plan',
      'tone-translate',
      'extract-actions',
      'how-to',
      'html-artifact',
      'analyze-table',
      'tutor',
    ],
  };
}

/** Display number for a slot index: 1-9 then 0 (the tenth key). */
export function slotKey(index: number): string | null {
  if (index < 0 || index >= MAX_SLOTS) return null;
  return index === 9 ? '0' : String(index + 1);
}

/** Slot index a pressed digit maps to: "1"->0 … "9"->8, "0"->9. */
export function indexForKey(key: string): number | null {
  if (key === '0') return 9;
  if (key >= '1' && key <= '9') return Number(key) - 1;
  return null;
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

/** Catalog capabilities NOT already on the row, grouped by their catalog
 *  category — the data behind the "+ Add" picker. */
export function availableActions(
  layout: WorkspaceLayout,
): { title: string; capabilities: Capability[] }[] {
  const placed = new Set(layout.slots);
  return CAPABILITY_CATALOG.map((cat) => ({
    title: cat.title,
    capabilities: cat.capabilities.filter((c) => !placed.has(c.id)),
  })).filter((cat) => cat.capabilities.length > 0);
}

// ── mutations (pure: every helper returns a NEW layout) ───────────────────────

/** Append an action to the row (no-op if present or the row is full). */
export function addAction(layout: WorkspaceLayout, actionId: string): WorkspaceLayout {
  if (layout.slots.includes(actionId) || layout.slots.length >= MAX_SLOTS) return layout;
  return { ...layout, slots: [...layout.slots, actionId] };
}

/** Remove an action from the row. */
export function removeAction(layout: WorkspaceLayout, actionId: string): WorkspaceLayout {
  return { ...layout, slots: layout.slots.filter((id) => id !== actionId) };
}

/** Move an action to a target index (drag-and-drop reorder within the row). */
export function moveAction(
  layout: WorkspaceLayout,
  actionId: string,
  toIndex: number,
): WorkspaceLayout {
  const without = layout.slots.filter((id) => id !== actionId);
  const idx = Math.max(0, Math.min(toIndex, without.length));
  without.splice(idx, 0, actionId);
  return { ...layout, slots: without };
}

// ── persistence (localStorage seam; vault-file-ready) ─────────────────────────

export function serializeLayout(layout: WorkspaceLayout): string {
  return JSON.stringify(layout);
}

/** Parse stored form back to a layout, dropping action ids that no longer exist
 *  in the catalog and capping the row. Returns null when unusable so callers
 *  fall back to default. */
export function parseLayout(raw: string): WorkspaceLayout | null {
  try {
    const data = JSON.parse(raw) as Partial<WorkspaceLayout>;
    if (!data || data.version !== 2 || !Array.isArray(data.slots)) return null;
    const slots = data.slots
      .filter((id): id is string => typeof id === 'string' && !!resolveAction(id))
      .slice(0, MAX_SLOTS);
    return slots.length > 0 ? { version: 2, slots } : null;
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
