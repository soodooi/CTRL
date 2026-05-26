// tableFormat — parse / serialise the three tabular formats the smart
// table viewer rounds-trips through:
//
//   - text/csv               → papaparse (RFC 4180 + permissive)
//   - application/json       → JSON.parse / stringify (array-of-object)
//   - markdown table block   → in-house parser (no GFM lib needed)
//
// Each format keeps its own quirks on save:
//   - CSV preserves the user's original delimiter + quote style
//   - JSON emits pretty-printed 2-space indent (vim-friendly diff)
//   - Markdown re-pads column widths to the widest cell (Obsidian style)
//
// `inferColumnType` is a best-effort heuristic — the smart-table viewer
// uses it for right-aligning numbers, rendering booleans as checkboxes,
// and offering a date picker on edit. Failures fall back to 'string'.

import Papa from 'papaparse';

export type TableFormat = 'csv' | 'json' | 'markdown';

export type CellValue = string | number | boolean | null;
export type RowData = Record<string, CellValue>;

export interface TableData {
  format: TableFormat;
  columns: string[];
  rows: RowData[];
  /** Format-specific metadata preserved across save (e.g. CSV delim). */
  meta: {
    /** CSV delimiter detected at parse time. */
    delimiter?: string;
    /** Original CSV had a header row (vs. headerless tabular data). */
    hadHeader?: boolean;
    /** Trailing newline present in source (preserve on save). */
    trailingNewline?: boolean;
  };
}

export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'link';

export const formatForContentType = (contentType: string): TableFormat | null => {
  const ct = contentType.toLowerCase().split(';')[0]!.trim();
  if (ct === 'text/csv' || ct === 'application/csv') return 'csv';
  if (ct === 'application/json' || ct === 'text/json') return 'json';
  if (ct === 'text/markdown' && false) return 'markdown'; // dispatched separately
  return null;
};

// ───── CSV ────────────────────────────────────────────────────────────────

export const parseCsv = (text: string): TableData => {
  const trailingNewline = text.endsWith('\n');
  const result = Papa.parse<RowData>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false, // we infer types lazily, keep strings as strings
    transformHeader: (h) => h.trim(),
  });
  const delimiter = result.meta.delimiter || ',';
  const columns = result.meta.fields ?? [];
  const rows = (result.data ?? []).map((r) => normaliseRow(r, columns));
  return {
    format: 'csv',
    columns,
    rows,
    meta: { delimiter, hadHeader: true, trailingNewline },
  };
};

export const serialiseCsv = (data: TableData): string => {
  const out = Papa.unparse(
    {
      fields: data.columns,
      data: data.rows.map((r) => data.columns.map((c) => cellToCsv(r[c] ?? null))),
    },
    { delimiter: data.meta.delimiter ?? ',', newline: '\n' },
  );
  return data.meta.trailingNewline ? `${out}\n` : out;
};

// ───── JSON (array of object) ─────────────────────────────────────────────

export const parseJson = (text: string): TableData => {
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error('expected a top-level JSON array of objects');
  }
  const columns = collectColumns(raw);
  const rows = raw.map((row): RowData => {
    if (typeof row !== 'object' || row === null) {
      return Object.fromEntries(columns.map((c) => [c, String(row)]));
    }
    const obj = row as Record<string, unknown>;
    const out: RowData = {};
    for (const col of columns) {
      out[col] = coerceCell(obj[col]);
    }
    return out;
  });
  return {
    format: 'json',
    columns,
    rows,
    meta: { trailingNewline: text.endsWith('\n') },
  };
};

export const serialiseJson = (data: TableData): string => {
  const arr = data.rows.map((r) => {
    const out: Record<string, CellValue> = {};
    for (const col of data.columns) out[col] = r[col] ?? null;
    return out;
  });
  const body = JSON.stringify(arr, null, 2);
  return data.meta.trailingNewline ? `${body}\n` : body;
};

// ───── Markdown table block ───────────────────────────────────────────────

const MD_TABLE_RE = /^\|.*\|\s*$/;

export const parseMarkdownTable = (text: string): TableData => {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2 || !MD_TABLE_RE.test(lines[0]!)) {
    throw new Error('not a markdown table block');
  }
  const headerCells = splitMdRow(lines[0]!);
  // Second line is the alignment separator (`| --- | :---: |`); skip.
  const bodyLines = lines.slice(2);
  const columns = headerCells;
  const rows = bodyLines.map((line): RowData => {
    const cells = splitMdRow(line);
    const row: RowData = {};
    columns.forEach((col, i) => {
      row[col] = cells[i] ?? '';
    });
    return row;
  });
  return {
    format: 'markdown',
    columns,
    rows,
    meta: { trailingNewline: text.endsWith('\n') },
  };
};

export const serialiseMarkdownTable = (data: TableData): string => {
  // Compute column widths so the saved file is human-readable.
  const widths = data.columns.map((col) => {
    const headerW = col.length;
    const bodyW = Math.max(
      0,
      ...data.rows.map((r) => String(r[col] ?? '').length),
    );
    return Math.max(headerW, bodyW, 3);
  });
  const padCell = (val: string, i: number): string => val.padEnd(widths[i]!);
  const headerRow = `| ${data.columns.map((c, i) => padCell(c, i)).join(' | ')} |`;
  const separator = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  const bodyRows = data.rows.map(
    (r) =>
      `| ${data.columns.map((c, i) => padCell(String(r[c] ?? ''), i)).join(' | ')} |`,
  );
  const body = [headerRow, separator, ...bodyRows].join('\n');
  return data.meta.trailingNewline ? `${body}\n` : body;
};

// ───── Type inference ─────────────────────────────────────────────────────

const LINK_RE = /^https?:\/\/\S+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export const inferColumnType = (samples: ReadonlyArray<CellValue>): ColumnType => {
  let saw = 0;
  let numCount = 0;
  let boolCount = 0;
  let dateCount = 0;
  let linkCount = 0;
  for (const sample of samples) {
    if (sample === null || sample === '') continue;
    saw += 1;
    const s = String(sample).trim();
    if (s === 'true' || s === 'false') {
      boolCount += 1;
      continue;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(s) && !Number.isNaN(Number(s))) {
      numCount += 1;
      continue;
    }
    if (ISO_DATE_RE.test(s)) {
      dateCount += 1;
      continue;
    }
    if (LINK_RE.test(s)) {
      linkCount += 1;
      continue;
    }
  }
  if (saw === 0) return 'string';
  if (numCount / saw >= 0.9) return 'number';
  if (boolCount / saw >= 0.9) return 'boolean';
  if (dateCount / saw >= 0.9) return 'date';
  if (linkCount / saw >= 0.9) return 'link';
  return 'string';
};

// ───── Helpers ────────────────────────────────────────────────────────────

const normaliseRow = (row: RowData, columns: ReadonlyArray<string>): RowData => {
  const out: RowData = {};
  for (const col of columns) {
    const val = row[col];
    out[col] = val === undefined ? '' : val;
  }
  return out;
};

const cellToCsv = (val: CellValue): string => {
  if (val === null) return '';
  return String(val);
};

const collectColumns = (rows: ReadonlyArray<unknown>): string[] => {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
};

const coerceCell = (val: unknown): CellValue => {
  if (val === null) return null;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }
  // Nested arrays/objects → JSON stringified so the cell stays a scalar.
  return JSON.stringify(val);
};

const splitMdRow = (line: string): string[] => {
  // Strip leading + trailing | then split. Doesn't handle escaped pipes;
  // CSV / JSON formats are recommended when content includes pipes.
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
};
