// smart-table-relations — the relational soul of Bitable (link / Lookup /
// Rollup), modelled on Teable's LinkField / LookupField / RollupField but over
// CTRL's plain-text tables (each row has a stable record id, see ensureRowIds).
//
// link cell value  = comma-separated target row ids (the truth, on disk).
// link DISPLAY      = the target rows' primary field (derived, not stored).
// lookup            = follow a link column, pull a foreign field's value(s).
// rollup            = aggregate a foreign field over the linked rows.
//
// Reads run in the front end now (small fan-out); route-C SQLite derived index
// (ADR-002 §14 v30) lands later only when scale needs it — semantics identical.

import { ROW_ID_KEY, type ColumnSpec, type SmartTable } from './smart-table';

/** A table's primary (display) field — the first non-system user column. */
export const primaryField = (table: SmartTable): string =>
  table.schema.find((c) => !c.system)?.key ?? ROW_ID_KEY;

const rowById = (table: SmartTable, id: string): Record<string, string> | undefined =>
  table.rows.find((r) => r[ROW_ID_KEY] === id.trim());

const idsOf = (raw: string): string[] =>
  (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Distinct target-table paths a table's link columns reference. */
export const linkTargets = (schema: ColumnSpec[]): string[] => {
  const set = new Set<string>();
  for (const c of schema) if (c.type === 'link' && c.foreignTable) set.add(c.foreignTable);
  return [...set];
};

/** Display a link cell (target ids) as the target rows' primary field. */
export const resolveLinkDisplay = (value: string, target: SmartTable | undefined): string => {
  if (!target || !value) return '';
  const pf = primaryField(target);
  return idsOf(value)
    .map((id) => rowById(target, id)?.[pf] ?? '(missing)')
    .join(', ');
};

/** Foreign field values reached by following `linkCol` on `row`. */
const followLink = (
  row: Record<string, string>,
  linkCol: ColumnSpec | undefined,
  lookupField: string,
  target: SmartTable | undefined,
): string[] => {
  if (!linkCol || !target || !lookupField) return [];
  return idsOf(row[linkCol.key] ?? '').map((id) => rowById(target, id)?.[lookupField] ?? '');
};

/** Lookup: the foreign field values, joined for display. */
export const computeLookup = (
  row: Record<string, string>,
  spec: ColumnSpec,
  linkCol: ColumnSpec | undefined,
  target: SmartTable | undefined,
): string => followLink(row, linkCol, spec.lookupField ?? '', target).filter(Boolean).join(', ');

/** Rollup: aggregate the foreign field over the linked rows. */
export const computeRollup = (
  row: Record<string, string>,
  spec: ColumnSpec,
  linkCol: ColumnSpec | undefined,
  target: SmartTable | undefined,
): string => {
  const vals = followLink(row, linkCol, spec.lookupField ?? '', target);
  const nums = vals.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
  switch (spec.rollupFn) {
    case 'count':
      return String(idsOf(row[linkCol?.key ?? ''] ?? '').length);
    case 'sum':
      return String(nums.reduce((a, n) => a + n, 0));
    case 'avg':
      return nums.length ? String(Math.round((nums.reduce((a, n) => a + n, 0) / nums.length) * 100) / 100) : '';
    case 'min':
      return nums.length ? String(Math.min(...nums)) : '';
    case 'max':
      return nums.length ? String(Math.max(...nums)) : '';
    default:
      return vals.filter(Boolean).join(', ');
  }
};

/** Compute the DISPLAY value for any relational field (link/lookup/rollup);
 *  returns null for non-relational fields (use the raw cell). `tables` maps a
 *  target path → its loaded SmartTable. */
export const relationalDisplay = (
  row: Record<string, string>,
  spec: ColumnSpec,
  schema: ColumnSpec[],
  tables: Record<string, SmartTable>,
): string | null => {
  if (spec.type === 'link') return resolveLinkDisplay(row[spec.key] ?? '', spec.foreignTable ? tables[spec.foreignTable] : undefined);
  if (spec.type === 'lookup' || spec.type === 'rollup') {
    const linkCol = schema.find((c) => c.key === spec.linkField && c.type === 'link');
    const target = linkCol?.foreignTable ? tables[linkCol.foreignTable] : undefined;
    return spec.type === 'lookup' ? computeLookup(row, spec, linkCol, target) : computeRollup(row, spec, linkCol, target);
  }
  return null;
};
