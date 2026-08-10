// Product-facing FCT adapter. Package, Skill, manifest, and MCP details remain
// behind the canonical system catalog Resource.
// (ADR-002 substrate §15.4/§16 v84; ADR-003 frontend §8.5 v41)

import { invoke } from './bridge';
import { produceResource, queryResource } from './kernel';
import { interpretNoteWrite, type NoteWriteOutcome } from './note-write';

const FCT_CATALOG_REF = 'ctrl://local/system/catalog';

export interface FctItem {
  ref: string;
  name: string;
  summary: string;
  source_kind: 'package' | 'skill' | string;
  install_state: 'installed' | 'available' | string;
  selection_kind: 'selectable' | 'unavailable' | 'disabled' | string;
  /** User-owned enable state. Optional so an older kernel that does not send it
   *  reads as enabled rather than as disabled.
   *  (ADR-002 substrate §15.4.1 v88) */
  enabled?: boolean;
}

export interface FctSelectionProjection {
  ref: string;
  resources: string[];
  skill_id?: string;
  capability_scope: string[];
  policy: string;
  install_state: string;
  install_ref: string;
}

export function listFcts(): Promise<FctItem[]> {
  return queryResource<FctItem[]>(FCT_CATALOG_REF, { operation: 'list' });
}

/** Turn an installed capability on or off WITHOUT deleting it. Goes through the
 *  catalogue owner's governed produce verb, which persists the state as plain
 *  text and verifies it by rereading. Install and uninstall keep their existing
 *  surface; this is the state that was previously unreachable.
 *  (ADR-002 substrate §15.4.1 v88; ADR-005 irisy §12 v42 U15/U18) */
export async function setFctEnabled(ref: string, enabled: boolean): Promise<void> {
  const outcome = await produceResource<NoteWriteOutcome>(FCT_CATALOG_REF, {
    kind: enabled ? 'enable' : 'disable',
    ref,
  });
  const result = interpretNoteWrite(outcome);
  if (result.status !== 'verified') {
    // Report the kernel's own reason; never claim a state change it did not verify.
    throw new Error(
      result.status === 'conflict'
        ? `the capability state changed elsewhere (expected ${result.expected}, found ${result.actual})`
        : `${result.code}: ${result.message}`,
    );
  }
}

/** Show a capability's own files in the OS file manager. Ref-addressed: the
 *  kernel resolves the path, so the frontend cannot ask for an arbitrary one.
 *  (ADR-002 substrate §15.4.1 v88; ADR-005 irisy §12 v42 U18) */
export const revealFct = (ref: string): Promise<string> =>
  invoke<string>('reveal_capability', { capabilityRef: ref });

/** Whether a capability has files to reveal at all. */
export const fctHasFiles = (item: FctItem): boolean =>
  item.ref.startsWith('pack:') || item.ref.startsWith('skill:');

/** Human-readable ownership, so the user can tell what a Remove would delete. */
export function fctOwnership(item: FctItem): string {
  switch (item.source_kind) {
    case 'package':
      return 'Installed package';
    case 'skill':
      return 'Local Skill';
    default:
      return item.source_kind;
  }
}

export function resolveFctSelection(ref: string): Promise<FctSelectionProjection> {
  return queryResource<FctSelectionProjection>(FCT_CATALOG_REF, {
    operation: 'selection-projection',
    ref,
  });
}

export function mergeFctResources(workResources: string[], dependencies: string[]): string[] {
  const merged = [...workResources];
  const seen = new Set(workResources);
  for (const resource of [...dependencies].sort()) {
    if (seen.has(resource)) continue;
    seen.add(resource);
    merged.push(resource);
  }
  return merged;
}

// ── Auto-first selection surface ────────────────────────────────────────────
// The composer control is an OVERRIDE, not a browser. A native select listing
// the whole catalogue made the installed inventory the primary affordance, which
// ADR-003 §8.5 v42 forbids: Auto is the default, the compact control is the
// override, and complete catalogue browsing belongs to Library. So the panel is
// opened explicitly, shows a bounded shortlist, and always offers Library for
// the rest instead of silently hiding it.
// (ADR-003 frontend §8.5 v42; ADR-005 irisy §12 v42 U17)

import type { DecisionFact, DecisionOption } from './decision-registry';

/** How many FCTs the override panel offers before deferring to Library. */
export const FCT_SHORTLIST_LIMIT = 5;

export const FCT_AUTO_OPTION = 'fct:auto';
export const FCT_KEEP_OPTION = 'fct:keep';
export const FCT_LIBRARY_OPTION = 'fct:library';
const FCT_USE_PREFIX = 'fct:use:';

/** Option id -> the ref it selects, or null for Auto. Returns undefined for the
 *  non-selecting options so a caller cannot mistake "browse" for a selection. */
export function fctOptionSelection(optionId: string): string | null | undefined {
  if (optionId === FCT_AUTO_OPTION) return null;
  if (optionId.startsWith(FCT_USE_PREFIX)) return optionId.slice(FCT_USE_PREFIX.length);
  return undefined;
}

/** Build the `choice` decision for the composer override.
 *  Only `selectable` items are offered; an installed-but-unusable FCT would
 *  resolve to a failure the user could not act on. */
export function fctChoiceFact(
  items: readonly FctItem[],
  selectedRef: string,
  limit: number = FCT_SHORTLIST_LIMIT,
): DecisionFact {
  const selectable = items
    .filter((item) => item.selection_kind === 'selectable')
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const selected = selectable.find((item) => item.ref === selectedRef) ?? null;
  const shortlist = selectable.slice(0, Math.max(0, limit));
  const remaining = selectable.length - shortlist.length;

  const options: DecisionOption[] = [
    // The safe default: opening the panel and pressing Enter must not change
    // which capability the next turn uses.
    { id: FCT_KEEP_OPTION, label: 'Keep current', consequence: 'discards' },
  ];
  if (selectedRef) {
    options.push({ id: FCT_AUTO_OPTION, label: 'Auto', consequence: 'commits', primary: true });
  }
  for (const item of shortlist) {
    if (item.ref === selectedRef) continue;
    options.push({
      id: `${FCT_USE_PREFIX}${item.ref}`,
      label: item.name,
      consequence: 'commits',
    });
  }
  options.push({
    id: FCT_LIBRARY_OPTION,
    label: remaining > 0 ? `Browse all ${selectable.length} in Library` : 'Browse in Library',
    consequence: 'navigates',
  });

  return {
    id: 'fct-choice',
    kind: 'choice',
    subject: selected
      ? `Irisy is using ${selected.name} for this session.`
      : 'Irisy picks the capability for each turn.',
    facts: [
      { label: 'Current', value: selected ? selected.name : 'Auto' },
      ...(selected?.summary ? [{ label: 'What it does', value: selected.summary }] : []),
    ],
    options,
    intent: 'U17',
  };
}
