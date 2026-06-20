// smart-table — parse / serialize a markdown table augmented with a
// frontmatter schema. The on-disk file is plain markdown (vim test
// passes); the schema declares column types so the viewer can pick the
// right cell editor (text / number / date / select / checkbox).
//
// File shape on disk:
//
//   ---
//   title: Reading list
//   schema:
//     - { key: title, label: Title, type: text }
//     - { key: rating, label: ★, type: number, min: 0, max: 5 }
//     - { key: done, label: Done, type: checkbox }
//     - { key: tags, label: Tags, type: tags }
//   ---
//
//   | Title          | ★ | Done | Tags        |
//   |----------------|---|------|-------------|
//   | The Pragmatic… | 4 | x    | tech, craft |
//   | Anathem        | 5 |      | scifi       |
//
// Round-trip rule: parse → render → edit → serialize must preserve the
// markdown table structure (column order, header row, separator row).
// Any frontmatter the file carries beyond `schema` + `title` is kept
// verbatim (we touch only what we own).

export type CellType =
  | 'text'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'tags'
  | 'select'
  | 'url';

export interface ColumnSpec {
  key: string;
  label: string;
  type: CellType;
  /** For `select`: list of allowed options. */
  options?: ReadonlyArray<string>;
  /** For `number`: validation hints. */
  min?: number;
  max?: number;
}

/** A saved view (ADR-003 §6.2) — view state lives in frontmatter, not the
 *  table body. `kanban` columnizes by `groupBy`. */
export interface ViewSpec {
  kind: 'grid' | 'kanban';
  groupBy?: string | null;
}

export interface SmartTable {
  title?: string;
  schema: ColumnSpec[];
  rows: Array<Record<string, string>>;
  /** Saved views from frontmatter `views:` (ADR-003 §6.2). Kernel `add_view`
   *  writes these; the viewer reads them so the two paths stay in sync. */
  views: ViewSpec[];
  /** Frontmatter fields outside `title` / `schema` — preserved on save. */
  extraFrontmatter: Record<string, unknown>;
}

const FRONTMATTER_DELIM = /^---\s*$/;

/** Split a markdown document into { frontmatter, body }. Returns
 *  frontmatter as the raw YAML text (parsed lazily by caller). */
const splitFrontmatter = (
  source: string,
): { yaml: string; body: string } => {
  const lines = source.split(/\r?\n/);
  if (lines.length === 0 || !FRONTMATTER_DELIM.test(lines[0] ?? '')) {
    return { yaml: '', body: source };
  }
  const end = lines.slice(1).findIndex((l) => FRONTMATTER_DELIM.test(l));
  if (end < 0) return { yaml: '', body: source };
  const yaml = lines.slice(1, 1 + end).join('\n');
  const body = lines.slice(2 + end).join('\n');
  return { yaml, body };
};

/** Crude YAML parser — sufficient for our schema shape (scalar + flow
 *  objects). Bails on anything fancier. The file contract documents
 *  the supported shape; power users with complex YAML edit the file
 *  by hand and the table viewer falls through to the markdown viewer. */
const parseScalar = (raw: string): string | number | boolean => {
  const v = raw.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  // Strip surrounding quotes if present.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
};

const parseInlineObject = (raw: string): Record<string, unknown> => {
  const inner = raw.trim().replace(/^\{|\}$/g, '');
  const out: Record<string, unknown> = {};
  for (const pair of splitTopLevel(inner, ',')) {
    const colon = pair.indexOf(':');
    if (colon < 0) continue;
    // Keys may be bare (`kind: …` flow form) or quoted (`"kind": …` from the
    // kernel emitter's JSON Display of an object) — unquote both.
    const key = pair.slice(0, colon).trim().replace(/^["']|["']$/g, '');
    const value = pair.slice(colon + 1);
    if (key === 'options' && /^\s*\[/.test(value)) {
      const arr = value.trim().replace(/^\[|\]$/g, '');
      out.options = splitTopLevel(arr, ',').map((s) => parseScalar(s));
    } else {
      out[key] = parseScalar(value);
    }
  }
  return out;
};

/** Split a string at the top-level commas only (ignores commas inside
 *  brackets / braces / quotes). Used to handle `[a, b, c]` inside
 *  inline objects without a real YAML parser. */
const splitTopLevel = (s: string, sep: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  let inQuote: string | null = null;
  for (const ch of s) {
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      buf += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    if (ch === sep && depth === 0) {
      if (buf.trim()) out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
};

/** Parse the schema block from the frontmatter YAML text. Looks for a
 *  `schema:` key followed by inline-object list items. */
const parseSchema = (yamlText: string): ColumnSpec[] => {
  const lines = yamlText.split(/\r?\n/);
  const out: ColumnSpec[] = [];
  let inSchema = false;
  for (const line of lines) {
    if (/^schema\s*:/.test(line)) {
      inSchema = true;
      continue;
    }
    if (inSchema) {
      if (/^\S/.test(line)) {
        inSchema = false;
        continue;
      }
      const item = /^\s*-\s*(.+)$/.exec(line);
      if (!item) continue;
      const obj = parseInlineObject(item[1]!);
      if (typeof obj.key === 'string' && typeof obj.label === 'string') {
        out.push({
          key: obj.key,
          label: obj.label,
          type: ((obj.type as string) ?? 'text') as CellType,
          options: Array.isArray(obj.options) ? (obj.options as string[]) : undefined,
          min: typeof obj.min === 'number' ? obj.min : undefined,
          max: typeof obj.max === 'number' ? obj.max : undefined,
        });
      }
    }
  }
  return out;
};

const parseTitle = (yamlText: string): string | undefined => {
  const m = /^title\s*:\s*(.+)$/m.exec(yamlText);
  if (!m) return undefined;
  const value = parseScalar(m[1]!);
  return typeof value === 'string' ? value : String(value);
};

/** Parse the body's first markdown table into rows keyed by the schema. */
const parseTable = (
  body: string,
  schema: ColumnSpec[],
): Array<Record<string, string>> => {
  const rows: Array<Record<string, string>> = [];
  if (schema.length === 0) return rows;
  const lines = body.split(/\r?\n/);
  // Find header — first line starting with `|`. Separator is the next line.
  const headerIdx = lines.findIndex((l) => l.trim().startsWith('|'));
  if (headerIdx < 0) return rows;
  const headerCells = splitTableRow(lines[headerIdx] ?? '');
  // Map column index → schema key by matching the header label.
  const idxToKey = headerCells.map((label) => {
    const spec = schema.find((s) => s.label === label) ?? schema.find((s) => s.key === label);
    return spec?.key ?? null;
  });
  // Skip header + separator.
  for (let i = headerIdx + 2; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!line.trim().startsWith('|')) break;
    const cells = splitTableRow(line);
    const row: Record<string, string> = {};
    cells.forEach((cell, ci) => {
      const key = idxToKey[ci];
      if (key) row[key] = cell;
    });
    rows.push(row);
  }
  return rows;
};

const splitTableRow = (line: string): string[] => {
  const trimmed = line.trim().replace(/^\||\|$/g, '');
  return trimmed.split('|').map((c) => c.trim());
};

/** Parse the `views:` block from frontmatter into ViewSpecs. Handles both the
 *  hand-written flow form (`- { kind: kanban, group_by: stage }`) and the
 *  kernel emitter's JSON form (`- {"kind":"kanban","group_by":"stage"}`). */
const parseViews = (yamlText: string): ViewSpec[] => {
  const lines = yamlText.split(/\r?\n/);
  const out: ViewSpec[] = [];
  let inViews = false;
  for (const line of lines) {
    if (/^views\s*:/.test(line)) {
      inViews = true;
      continue;
    }
    if (inViews) {
      if (/^\S/.test(line)) {
        inViews = false;
        continue;
      }
      const item = /^\s*-\s*(.+)$/.exec(line);
      if (!item) continue;
      const obj = parseInlineObject(item[1]!);
      const kind = obj.kind === 'kanban' ? 'kanban' : 'grid';
      const groupBy = typeof obj.group_by === 'string' && obj.group_by ? (obj.group_by as string) : null;
      out.push({ kind, groupBy });
    }
  }
  return out;
};

/** Public: parse a smart-table file into structured data. */
export const parseSmartTable = (source: string): SmartTable => {
  const { yaml, body } = splitFrontmatter(source);
  const schema = parseSchema(yaml);
  const title = parseTitle(yaml);
  const views = parseViews(yaml);
  const rows = parseTable(body, schema);
  // We don't round-trip arbitrary frontmatter today (that's a YAML library
  // job); title / schema / views are the keys we own + re-emit.
  return { title, schema, rows, views, extraFrontmatter: {} };
};

/** Serialize back to markdown. Re-emits the frontmatter (title + schema)
 *  + the markdown table; preserves nothing fancier. */
export const serializeSmartTable = (table: SmartTable): string => {
  const lines: string[] = ['---'];
  if (table.title) lines.push(`title: ${table.title}`);
  if (table.schema.length > 0) {
    lines.push('schema:');
    for (const col of table.schema) {
      const parts = [
        `key: ${col.key}`,
        `label: ${col.label}`,
        `type: ${col.type}`,
      ];
      if (col.options) parts.push(`options: [${col.options.join(', ')}]`);
      if (col.min !== undefined) parts.push(`min: ${col.min}`);
      if (col.max !== undefined) parts.push(`max: ${col.max}`);
      lines.push(`  - { ${parts.join(', ')} }`);
    }
  }
  if (table.views.length > 0) {
    lines.push('views:');
    for (const v of table.views) {
      const parts = [`kind: ${v.kind}`];
      if (v.groupBy) parts.push(`group_by: ${v.groupBy}`);
      lines.push(`  - { ${parts.join(', ')} }`);
    }
  }
  lines.push('---', '');

  if (table.schema.length > 0) {
    lines.push(`| ${table.schema.map((c) => c.label).join(' | ')} |`);
    lines.push(`|${table.schema.map(() => '---').join('|')}|`);
    for (const row of table.rows) {
      lines.push(
        `| ${table.schema
          .map((c) => (row[c.key] ?? '').replace(/\|/g, '\\|'))
          .join(' | ')} |`,
      );
    }
  }
  return lines.join('\n') + '\n';
};

/** Insert a new empty row at the end. Returns a new table (immutable). */
export const appendRow = (table: SmartTable): SmartTable => ({
  ...table,
  rows: [...table.rows, Object.fromEntries(table.schema.map((c) => [c.key, '']))],
});

/** Update a single cell. Returns a new table. */
export const updateCell = (
  table: SmartTable,
  rowIndex: number,
  key: string,
  value: string,
): SmartTable => ({
  ...table,
  rows: table.rows.map((row, i) =>
    i === rowIndex ? { ...row, [key]: value } : row,
  ),
});

/** Delete a row. Returns a new table. */
export const deleteRow = (table: SmartTable, rowIndex: number): SmartTable => ({
  ...table,
  rows: table.rows.filter((_, i) => i !== rowIndex),
});
