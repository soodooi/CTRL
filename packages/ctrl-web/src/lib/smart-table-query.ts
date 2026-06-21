// smart-table-query — the client-side mirror of the kernel query engine
// (ADR-002 substrate §14 / kernel `query.rs`). Same describe/query contract,
// run in the browser so the SmartTableViewer can filter/sort/group instantly
// without a round-trip, with identical semantics to what Irisy gets through the
// :17873 gate. Type-aware operators; an unknown field is rejected (the kernel
// returns `field_not_found` — here we throw the same shape) so the UI never
// silently drops a bad filter.

import { baseCellType, type CellType, type ColumnSpec, type SmartTable } from './smart-table';

export type Operator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'before'
  | 'after'
  | 'within'
  | 'is'
  | 'has_tag';

export interface Filter {
  field: string;
  op: Operator;
  value: string;
}

export interface SortKey {
  field: string;
  desc?: boolean;
}

export interface QueryRequest {
  filters?: Filter[];
  /** How to combine filters: 'and' (all) or 'or' (any). Default 'and'. */
  conjunction?: 'and' | 'or';
  sort?: SortKey[];
  /** One field (single-level) or several (multi-level group). */
  groupBy?: string | string[] | null;
  limit?: number | null;
}

export type Row = Record<string, string>;

export interface QueryResult {
  rows: Row[];
  matchCount: number;
}

export class FieldNotFoundError extends Error {
  constructor(
    public field: string,
    public valid: string[],
  ) {
    super(`field_not_found: '${field}' (valid: ${valid.join(', ')})`);
    this.name = 'FieldNotFoundError';
  }
}

/** Filter → sort → group → limit over a smart table's rows, mirroring the
 *  kernel's `run_query`. `now` is injectable for deterministic relative-date
 *  tests. */
export const queryTable = (
  table: SmartTable,
  req: QueryRequest,
  now: Date = new Date(),
): QueryResult => {
  const valid = table.schema.map((c) => c.key);
  const typeOf = (key: string): CellType | undefined =>
    table.schema.find((c) => c.key === key)?.type;
  const requireField = (field: string): void => {
    if (!typeOf(field)) throw new FieldNotFoundError(field, valid);
  };

  (req.filters ?? []).forEach((f) => requireField(f.field));
  (req.sort ?? []).forEach((s) => requireField(s.field));
  (Array.isArray(req.groupBy) ? req.groupBy : req.groupBy ? [req.groupBy] : []).forEach(requireField);

  // Filter — AND (all) or OR (any) across all filters.
  const conj = req.conjunction ?? 'and';
  let out = table.rows.filter((row) => {
    const fs = req.filters ?? [];
    if (fs.length === 0) return true;
    const test = (f: Filter): boolean =>
      applyFilter(row[f.field] ?? '', baseCellType(typeOf(f.field) ?? 'text'), f.op, f.value, now);
    return conj === 'or' ? fs.some(test) : fs.every(test);
  });

  // Sort — stable, multi-key; apply in reverse so the first key wins.
  for (const key of [...(req.sort ?? [])].reverse()) {
    const ct = baseCellType(typeOf(key.field) ?? 'text');
    out = stableSort(out, (a, b) => {
      const ord = compareCells(a[key.field] ?? '', b[key.field] ?? '', ct);
      return key.desc ? -ord : ord;
    });
  }

  // Group — stable multi-level partition (reverse so the first level is primary).
  // Ordinal compare (not localeCompare) to match the kernel's str::cmp grouping
  // exactly, so a client-fallback and a kernel result order groups identically.
  const groups = Array.isArray(req.groupBy) ? req.groupBy : req.groupBy ? [req.groupBy] : [];
  for (const g of [...groups].reverse()) {
    out = stableSort(out, (a, b) => {
      const av = a[g] ?? '';
      const bv = b[g] ?? '';
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
  }

  const matchCount = out.length;
  if (req.limit != null) out = out.slice(0, req.limit);
  return { rows: out, matchCount };
};

const applyFilter = (
  cell: string,
  ct: CellType,
  op: Operator,
  value: string,
  now: Date,
): boolean => {
  switch (ct) {
    case 'number': {
      const c = parseNum(cell);
      const v = parseNum(value);
      if (c == null || v == null) return false;
      switch (op) {
        case 'eq':
          return c === v;
        case 'neq':
          return c !== v;
        case 'gt':
          return c > v;
        case 'lt':
          return c < v;
        case 'gte':
          return c >= v;
        case 'lte':
          return c <= v;
        default:
          return false;
      }
    }
    case 'date': {
      const c = parseDate(cell);
      if (!c) return false;
      if (op === 'within') return within(c, value, now);
      const v = parseDate(value);
      if (!v) return false;
      switch (op) {
        case 'eq':
          return c.getTime() === v.getTime();
        case 'before':
        case 'lt':
          return c < v;
        case 'after':
        case 'gt':
          return c > v;
        case 'lte':
          return c <= v;
        case 'gte':
          return c >= v;
        default:
          return false;
      }
    }
    case 'checkbox': {
      const truthy = isTruthy(cell);
      const want = isTruthy(value);
      return (op === 'is' || op === 'eq') && truthy === want;
    }
    case 'tags': {
      const want = value.trim().toLowerCase();
      const hit = cell
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .includes(want);
      if (op === 'has_tag' || op === 'contains' || op === 'eq') return hit;
      if (op === 'neq') return !hit;
      return false;
    }
    default: {
      // text / select / url
      const c = cell.trim().toLowerCase();
      const v = value.trim().toLowerCase();
      switch (op) {
        case 'eq':
          return c === v;
        case 'neq':
          return c !== v;
        case 'contains':
          return c.includes(v);
        default:
          return false;
      }
    }
  }
};

const compareCells = (a: string, b: string, ct: CellType): number => {
  if (ct === 'number') {
    const av = parseNum(a) ?? -Infinity;
    const bv = parseNum(b) ?? -Infinity;
    return av === bv ? 0 : av < bv ? -1 : 1;
  }
  if (ct === 'date') {
    const av = parseDate(a)?.getTime() ?? -Infinity;
    const bv = parseDate(b)?.getTime() ?? -Infinity;
    return av === bv ? 0 : av < bv ? -1 : 1;
  }
  return a.toLowerCase().localeCompare(b.toLowerCase());
};

const parseNum = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const parseDate = (s: string): Date | null => {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const isTruthy = (s: string): boolean =>
  ['x', 'X', 'true', 'yes', '1', '✓'].includes(s.trim());

/** Relative-date ranges for the `within` operator (mirrors the kernel). */
const within = (d: Date, range: string, now: Date): boolean => {
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dd = day(d);
  const nn = day(now);
  const addDays = (date: Date, n: number) => new Date(day(date).getTime() + n * 86400000);
  switch (range) {
    case 'today':
      return dd.getTime() === nn.getTime();
    case 'this_week': {
      // Monday-based week.
      const dow = (nn.getDay() + 6) % 7;
      const start = addDays(nn, -dow);
      const end = addDays(start, 6);
      return dd >= start && dd <= end;
    }
    case 'this_month':
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    case 'past_7_days':
      return dd <= nn && dd >= addDays(nn, -7);
    case 'past_30_days':
      return dd <= nn && dd >= addDays(nn, -30);
    case 'future':
      return dd > nn;
    case 'past':
      return dd < nn;
    default:
      return false;
  }
};

/** Array.prototype.sort is not guaranteed stable on every engine for large
 *  inputs; do an explicit stable sort (decorate-sort-undecorate). */
const stableSort = <T>(arr: T[], cmp: (a: T, b: T) => number): T[] =>
  arr
    .map((v, i) => [v, i] as const)
    .sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1])
    .map(([v]) => v);

/** Convenience: the describe() shape for a smart table — fields + supported
 *  operators, mirroring the kernel's describe verb so the UI can build filter
 *  controls from the schema. */
export const describeTable = (
  table: SmartTable,
): { fields: ColumnSpec[]; operators: Operator[] } => ({
  fields: table.schema,
  operators: ['eq', 'neq', 'contains', 'gt', 'lt', 'gte', 'lte', 'before', 'after', 'within', 'is', 'has_tag'],
});
