// smart-table-gate-bridge — glue between the viewer's query-bar state and the
// §14 kernel gate (smart_table.query). The client Filter / Operator / SortKey /
// conjunction vocabulary was authored to mirror the kernel exactly, so building
// a gate request is a straight pass-through; the only real work is re-attaching
// the canonical row index after the kernel returns rows (the kernel is
// position-agnostic — it keys on the stable record id).

import type { SmartTableQueryRequest } from './kernel';
import { ROW_ID_KEY, type SmartTable } from './smart-table';
import type { Filter, SortKey } from './smart-table-query';

/** Build a kernel gate request from the viewer's query-bar state. group keys are
 *  the non-null levels (primary first); the kernel groups them in order. */
export const buildGateRequest = (
  filters: Filter[],
  conjunction: 'and' | 'or',
  sort: SortKey | null,
  groupLevels: Array<string | null>,
): SmartTableQueryRequest => ({
  filters,
  conjunction,
  sort: sort ? [sort] : [],
  group_by: groupLevels.filter((g): g is string => Boolean(g)),
});

/** Re-attach `__idx` (canonical row index) to kernel-returned rows by matching
 *  the stable record id, so the editable grid's index-based edit / expand /
 *  reorder paths keep working when rows are sourced from the kernel query.
 *  A row whose id is unknown to the current table maps to -1 (won't misroute). */
export const attachCanonicalIdx = (
  rows: Array<Record<string, string>>,
  table: SmartTable,
): Array<Record<string, string>> => {
  const idToIdx = new Map<string, number>();
  table.rows.forEach((r, i) => idToIdx.set(r[ROW_ID_KEY] ?? '', i));
  return rows.map((r) => ({
    ...r,
    __idx: String(idToIdx.get(r[ROW_ID_KEY] ?? '') ?? -1),
  }));
};
