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

// Render-level cell types. The viewer renders each distinctly ("render is the
// type" — Feishu/Teable), but query/sort/filter collapse to a small set of
// SEMANTIC base types (see baseCellType). This mirrors the kernel, whose
// CellType::parse aliases the number-/text-like variants onto its 5 core types.
export type CellType =
  | 'text'
  | 'multiline'
  | 'number'
  | 'integer'
  | 'currency'
  | 'rating'
  | 'progress'
  | 'date'
  | 'datetime'
  | 'checkbox'
  | 'tags'
  | 'select'
  | 'url'
  | 'email'
  | 'phone'
  | 'link'
  | 'lookup'
  | 'rollup'
  | 'formula'
  | 'attachment'
  | 'user'
  | 'percent'
  | 'duration'
  | 'auto_number'
  | 'created_at'
  | 'modified_at';

/** The 7 semantic base types query/sort/filter actually reason about. */
export type BaseCellType = 'text' | 'number' | 'date' | 'checkbox' | 'tags' | 'select' | 'url';

/** Collapse a render-level type to its semantic base. rating / progress /
 *  currency behave as numbers; multiline / email / phone as text. Kept in
 *  sync with the kernel's CellType::parse aliasing (query.rs). */
export const baseCellType = (t: CellType): BaseCellType => {
  switch (t) {
    case 'integer':
    case 'currency':
    case 'rating':
    case 'progress':
    case 'percent':
    case 'duration':
    case 'auto_number':
      return 'number';
    case 'datetime':
    case 'created_at':
    case 'modified_at':
      return 'date';
    case 'user':
      return 'tags';
    case 'multiline':
    case 'email':
    case 'phone':
    case 'link':
    case 'lookup':
    case 'rollup':
    case 'formula':
    case 'attachment':
      return 'text';
    case 'number':
    case 'date':
    case 'checkbox':
    case 'tags':
    case 'select':
    case 'url':
    case 'text':
      return t;
    default:
      return 'text';
  }
};

export interface ColumnSpec {
  key: string;
  label: string;
  type: CellType;
  /** For `select`: list of allowed options. */
  options?: ReadonlyArray<string>;
  /** For `number` / `rating` / `progress`: validation + scale hints
   *  (rating max = star count, progress max = 100% denominator). */
  min?: number;
  max?: number;
  /** For `currency`: a prefix symbol (default "$"). */
  symbol?: string;
  /** AI field shortcut (ADR-003 §6.5.4). When set, the column remembers its AI
   *  op + prompt; `aiAutoFill` re-runs it for newly added rows. Stored as flat
   *  scalars (ai_op / ai_prompt / ai_autofill) so the YAML round-trips. */
  aiOp?: string;
  aiPrompt?: string;
  aiAutoFill?: boolean;
  /** Relational config (Teable / NocoDB model). `link`: foreignTable = target
   *  table vault path; the cell stores target row id(s). `lookup` / `rollup`:
   *  linkField = which link column to follow, lookupField = the foreign field;
   *  `rollup` adds rollupFn (sum/count/avg/min/max). The relational soul of
   *  Bitable — route-C SQLite index lands later for scale; reads work now. */
  foreignTable?: string;
  linkField?: string;
  lookupField?: string;
  rollupFn?: string;
  /** For `formula`: the expression, e.g. `{price} * {qty}` or `ROUND({x}, 1)`.
   *  Evaluated client-side (lib/smart-table-formula); derived, not stored. */
  expression?: string;
  /** System field (record id, link back-refs, …) — present in the data + on
   *  disk but hidden from the grid / pickers. The relational foundation. */
  system?: boolean;
  /** Conditional formatting (Feishu Bitable parity): one rule per field, stored
   *  as flat scalars (color_op / color_value / color_bg) so the YAML round-trips
   *  like the AI fields. When the cell satisfies `colorOp colorValue`, the grid
   *  tints it `colorBg` (a hue 0..359). */
  colorOp?: ColorOp;
  colorValue?: string;
  colorBg?: number;
}

/** Conditional-format comparison operators (a subset that works typeless on the
 *  raw cell string + numbers). */
export type ColorOp = 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'empty' | 'not_empty';

/** Does `value` satisfy the column's conditional-format rule? False when the
 *  column has no rule. Number ops coerce; text ops compare case-insensitively. */
export const matchesColorRule = (col: ColumnSpec, value: string): boolean => {
  if (!col.colorOp) return false;
  const v = value.trim();
  const target = (col.colorValue ?? '').trim();
  switch (col.colorOp) {
    case 'empty':
      return v === '';
    case 'not_empty':
      return v !== '';
    case 'eq':
      return v.toLowerCase() === target.toLowerCase();
    case 'ne':
      return v.toLowerCase() !== target.toLowerCase();
    case 'contains':
      return v.toLowerCase().includes(target.toLowerCase());
    case 'gt':
      return Number(v) > Number(target);
    case 'lt':
      return Number(v) < Number(target);
    default:
      return false;
  }
};

/** The stable per-row record id field (Airtable/Teable/undb best practice:
 *  every row has an id, used by link / Lookup / Rollup to point at a row). It
 *  lives as a hidden system column so relations are stable across edits, and
 *  it round-trips in the markdown (vim-visible, plain-text). */
export const ROW_ID_KEY = 'id';

/** A short, stable, URL-safe row id. */
export const newRowId = (): string => {
  const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '';
  return `r${uuid.replace(/-/g, '').slice(0, 10) || Date.now().toString(36)}`;
};

/** Ensure the table carries the system id column + every row has an id. Idempotent;
 *  back-fills legacy tables (no id column) on first load. */
export const ensureRowIds = (table: SmartTable): SmartTable => {
  const hasId = table.schema.some((c) => c.key === ROW_ID_KEY);
  const schema = hasId
    ? table.schema.map((c) => (c.key === ROW_ID_KEY ? { ...c, system: true } : c))
    : [{ key: ROW_ID_KEY, label: 'ID', type: 'text' as CellType, system: true }, ...table.schema];
  const rows = table.rows.map((r) =>
    r[ROW_ID_KEY] ? r : { ...r, [ROW_ID_KEY]: newRowId() },
  );
  return { ...table, schema, rows };
};

/** The view kinds a smart table can render (ADR-003 §6.2). */
export type ViewKind =
  | 'grid'
  | 'kanban'
  | 'gallery'
  | 'calendar'
  | 'form'
  | 'summary'
  | 'chart'
  | 'timeline';

const VIEW_KINDS: ReadonlyArray<ViewKind> = [
  'grid',
  'kanban',
  'gallery',
  'calendar',
  'form',
  'summary',
  'chart',
  'timeline',
];

/** Coerce an unknown frontmatter `kind` into a valid ViewKind (default grid).
 *  Shared by both view parsers so the on-disk emit/parse pair stays symmetric. */
const viewKind = (k: unknown): ViewKind =>
  typeof k === 'string' && (VIEW_KINDS as ReadonlyArray<string>).includes(k) ? (k as ViewKind) : 'grid';

/** A saved view (ADR-003 §6.2) — view state lives in frontmatter, not the
 *  table body. `kanban`/`gallery`/`calendar` columnize/lay-out by `groupBy`.
 *  Sort is persisted as flat scalars (sort_field / sort_desc) on disk so the
 *  YAML round-trips without nested structures. */
export interface ViewSpec {
  kind: ViewKind;
  groupBy?: string | null;
  sort?: { field: string; desc: boolean } | null;
  name?: string;
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
    if (ch === '[' || ch === '{' || ch === '(') depth += 1;
    else if (ch === ']' || ch === '}' || ch === ')') depth -= 1;
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
      // Delegate to columnFromObj so the text path parses every extended field
      // (AI / relational / formula / conditional-format), same as the kernel
      // frontmatter path — otherwise those props silently drop on this route.
      const col = columnFromObj(parseInlineObject(item[1]!));
      if (col) out.push(col);
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
      const groupBy = typeof obj.group_by === 'string' && obj.group_by ? (obj.group_by as string) : null;
      out.push({ kind: viewKind(obj.kind), groupBy });
    }
  }
  return out;
};

/** Build a ColumnSpec from a parsed object (frontmatter or inline). */
const columnFromObj = (o: Record<string, unknown>): ColumnSpec | null => {
  if (typeof o.key !== 'string') return null;
  return {
    key: o.key,
    label: typeof o.label === 'string' ? o.label : o.key,
    type: (typeof o.type === 'string' ? o.type : 'text') as CellType,
    options: Array.isArray(o.options) ? (o.options as string[]) : undefined,
    min: typeof o.min === 'number' ? o.min : undefined,
    max: typeof o.max === 'number' ? o.max : undefined,
    symbol: typeof o.symbol === 'string' ? o.symbol : undefined,
    aiOp: typeof o.ai_op === 'string' && o.ai_op ? o.ai_op : undefined,
    aiPrompt: typeof o.ai_prompt === 'string' && o.ai_prompt ? o.ai_prompt : undefined,
    aiAutoFill: o.ai_autofill === true || o.ai_autofill === 'true' ? true : undefined,
    foreignTable: typeof o.foreign_table === 'string' && o.foreign_table ? o.foreign_table : undefined,
    linkField: typeof o.link_field === 'string' && o.link_field ? o.link_field : undefined,
    lookupField: typeof o.lookup_field === 'string' && o.lookup_field ? o.lookup_field : undefined,
    rollupFn: typeof o.rollup_fn === 'string' && o.rollup_fn ? o.rollup_fn : undefined,
    expression: typeof o.expression === 'string' && o.expression ? o.expression : undefined,
    system: o.system === true || o.system === 'true' || o.key === ROW_ID_KEY ? true : undefined,
    colorOp: typeof o.color_op === 'string' && o.color_op ? (o.color_op as ColorOp) : undefined,
    colorValue: typeof o.color_value === 'string' && o.color_value ? o.color_value : undefined,
    colorBg:
      typeof o.color_bg === 'number'
        ? o.color_bg
        : typeof o.color_bg === 'string' && o.color_bg.trim() !== ''
        ? Number(o.color_bg)
        : undefined,
  };
};

/** Parse a frontmatter `schema` value (array of objects OR flow-mapping
 *  strings — the kernel's YAML parser yields strings) into ColumnSpecs. */
const parseSchemaValue = (v: unknown): ColumnSpec[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) =>
      typeof item === 'string'
        ? columnFromObj(parseInlineObject(item))
        : item && typeof item === 'object'
        ? columnFromObj(item as Record<string, unknown>)
        : null,
    )
    .filter((c): c is ColumnSpec => c != null);
};

/** Parse a frontmatter `views` value (array of objects OR flow strings). */
const parseViewsValue = (v: unknown): ViewSpec[] => {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      const o = typeof item === 'string' ? parseInlineObject(item) : (item as Record<string, unknown>);
      if (!o || typeof o !== 'object') return null;
      const kind = viewKind(o.kind);
      const groupBy = typeof o.group_by === 'string' && o.group_by ? (o.group_by as string) : null;
      const sortField = typeof o.sort_field === 'string' && o.sort_field ? o.sort_field : null;
      const sort = sortField ? { field: sortField, desc: o.sort_desc === true || o.sort_desc === 'true' } : null;
      const name = typeof o.name === 'string' && o.name ? o.name : undefined;
      return { kind, groupBy, sort, name } as ViewSpec;
    })
    .filter((x): x is ViewSpec => x != null);
};

/** Build a SmartTable from a vault entry's already-parsed `frontmatter`
 *  (schema / title / views) + the markdown `body`. This is the path the viewer
 *  must use, because `vault_read` strips the frontmatter from `content` — so
 *  `parseSmartTable(content)` alone can never see the schema. */
export const smartTableFromParts = (
  frontmatter: Record<string, unknown>,
  body: string,
): SmartTable => {
  const schema = parseSchemaValue(frontmatter.schema);
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : undefined;
  const views = parseViewsValue(frontmatter.views);
  const rows = parseTable(body, schema);
  return ensureRowIds({ title, schema, rows, views, extraFrontmatter: {} });
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
  return ensureRowIds({ title, schema, rows, views, extraFrontmatter: {} });
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
      if (col.symbol !== undefined) parts.push(`symbol: ${col.symbol}`);
      if (col.aiOp) parts.push(`ai_op: ${col.aiOp}`);
      if (col.aiPrompt) parts.push(`ai_prompt: ${col.aiPrompt}`);
      if (col.aiAutoFill) parts.push(`ai_autofill: true`);
      if (col.foreignTable) parts.push(`foreign_table: ${col.foreignTable}`);
      if (col.linkField) parts.push(`link_field: ${col.linkField}`);
      if (col.lookupField) parts.push(`lookup_field: ${col.lookupField}`);
      if (col.rollupFn) parts.push(`rollup_fn: ${col.rollupFn}`);
      if (col.expression) parts.push(`expression: ${col.expression}`);
      if (col.system) parts.push(`system: true`);
      if (col.colorOp) parts.push(`color_op: ${col.colorOp}`);
      if (col.colorValue !== undefined) parts.push(`color_value: ${col.colorValue}`);
      if (col.colorBg !== undefined) parts.push(`color_bg: ${col.colorBg}`);
      lines.push(`  - { ${parts.join(', ')} }`);
    }
  }
  if (table.views.length > 0) {
    lines.push('views:');
    for (const v of table.views) {
      const parts = [`kind: ${v.kind}`];
      if (v.name) parts.push(`name: ${v.name}`);
      if (v.groupBy) parts.push(`group_by: ${v.groupBy}`);
      if (v.sort) parts.push(`sort_field: ${v.sort.field}`, `sort_desc: ${v.sort.desc}`);
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

/** Serialize ONLY the markdown table body (no frontmatter) — for `vault_write`,
 *  which takes body + frontmatter separately and re-emits the YAML itself. */
export const smartTableBody = (table: SmartTable): string => {
  if (table.schema.length === 0) return '';
  const lines: string[] = [];
  lines.push(`| ${table.schema.map((c) => c.label).join(' | ')} |`);
  lines.push(`|${table.schema.map(() => '---').join('|')}|`);
  for (const row of table.rows) {
    lines.push(
      `| ${table.schema.map((c) => (row[c.key] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`,
    );
  }
  return lines.join('\n') + '\n';
};

/** The frontmatter object (title / schema / views) to hand to `vault_write`. */
export const smartTableFrontmatter = (table: SmartTable): Record<string, unknown> => {
  const fm: Record<string, unknown> = {};
  if (table.title) fm.title = table.title;
  fm.schema = table.schema.map((c) => ({
    key: c.key,
    label: c.label,
    type: c.type,
    ...(c.options ? { options: c.options } : {}),
    ...(c.min !== undefined ? { min: c.min } : {}),
    ...(c.max !== undefined ? { max: c.max } : {}),
    ...(c.symbol !== undefined ? { symbol: c.symbol } : {}),
    ...(c.aiOp ? { ai_op: c.aiOp } : {}),
    ...(c.aiPrompt ? { ai_prompt: c.aiPrompt } : {}),
    ...(c.aiAutoFill ? { ai_autofill: true } : {}),
    ...(c.foreignTable ? { foreign_table: c.foreignTable } : {}),
    ...(c.linkField ? { link_field: c.linkField } : {}),
    ...(c.lookupField ? { lookup_field: c.lookupField } : {}),
    ...(c.rollupFn ? { rollup_fn: c.rollupFn } : {}),
    ...(c.expression ? { expression: c.expression } : {}),
    ...(c.system ? { system: true } : {}),
    ...(c.colorOp ? { color_op: c.colorOp } : {}),
    ...(c.colorValue !== undefined ? { color_value: c.colorValue } : {}),
    ...(c.colorBg !== undefined ? { color_bg: c.colorBg } : {}),
  }));
  if (table.views.length > 0) {
    fm.views = table.views.map((v) => ({
      kind: v.kind,
      ...(v.name ? { name: v.name } : {}),
      ...(v.groupBy ? { group_by: v.groupBy } : {}),
      ...(v.sort ? { sort_field: v.sort.field, sort_desc: v.sort.desc } : {}),
    }));
  }
  return fm;
};

/** Today as YYYY-MM-DD, for created_at / modified_at auto fields. */
const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** Auto-filled value for a system/auto field on a new row (record id, created/
 *  modified timestamps); undefined for normal fields. */
const autoValue = (c: ColumnSpec, now: string): string | undefined => {
  if (c.key === ROW_ID_KEY) return newRowId();
  if (c.type === 'created_at' || c.type === 'modified_at') return now;
  return undefined;
};

/** A fresh row map with auto fields filled. */
const freshRow = (table: SmartTable, now: string): Record<string, string> =>
  Object.fromEntries(table.schema.map((c) => [c.key, autoValue(c, now) ?? '']));

/** Insert a new empty row at the end (record id + created/modified set). */
export const appendRow = (table: SmartTable): SmartTable => ({
  ...table,
  rows: [...table.rows, freshRow(table, todayISO())],
});

/** Update a single cell; also bumps any modified_at field. Returns a new table. */
export const updateCell = (
  table: SmartTable,
  rowIndex: number,
  key: string,
  value: string,
): SmartTable => {
  const now = todayISO();
  return {
    ...table,
    rows: table.rows.map((row, i) => {
      if (i !== rowIndex) return row;
      const next = { ...row, [key]: value };
      for (const c of table.schema) if (c.type === 'modified_at') next[c.key] = now;
      return next;
    }),
  };
};

/** Delete a row. Returns a new table. */
export const deleteRow = (table: SmartTable, rowIndex: number): SmartTable => ({
  ...table,
  rows: table.rows.filter((_, i) => i !== rowIndex),
});

/** Append a row pre-filled with `values` (Form view submit). New record id. */
export const appendRowWithValues = (
  table: SmartTable,
  values: Record<string, string>,
): SmartTable => ({
  ...table,
  rows: [...table.rows, { ...freshRow(table, todayISO()), ...values }],
});

/** Delete several rows by canonical index (batch). Returns a new table. */
export const deleteRows = (table: SmartTable, rowIndexes: number[]): SmartTable => {
  const drop = new Set(rowIndexes);
  return { ...table, rows: table.rows.filter((_, i) => !drop.has(i)) };
};

/** Duplicate a row, inserting the copy right after the original with a fresh
 *  record id (and refreshed created/modified stamps). Out-of-range → unchanged. */
export const duplicateRow = (table: SmartTable, rowIndex: number): SmartTable => {
  const src = table.rows[rowIndex];
  if (!src) return table;
  const now = todayISO();
  const copy: Record<string, string> = { ...src };
  for (const c of table.schema) {
    if (c.key === ROW_ID_KEY) copy[c.key] = newRowId();
    else if (c.type === 'created_at' || c.type === 'modified_at') copy[c.key] = now;
  }
  const rows = [...table.rows];
  rows.splice(rowIndex + 1, 0, copy);
  return { ...table, rows };
};

/** Move a row from one index to another (manual drag-reorder). Row order is the
 *  data order in plain-text markdown, so this just permutes the rows array.
 *  Out-of-range / no-op moves return the table unchanged. */
export const moveRow = (table: SmartTable, from: number, to: number): SmartTable => {
  const n = table.rows.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return table;
  const rows = [...table.rows];
  const [moved] = rows.splice(from, 1);
  if (moved === undefined) return table;
  rows.splice(to, 0, moved);
  return { ...table, rows };
};

// --- Schema (field) operations (ADR-003 §6.5 A3) — immutable, keep rows in
// sync so the markdown body round-trips. ---

/** Turn a label into a unique, table-safe column key. */
export const columnKeyFromLabel = (label: string, taken: ReadonlyArray<string>): string => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
};

/** Append a new column; back-fills an empty cell for every row. */
export const addColumn = (table: SmartTable, col: ColumnSpec): SmartTable => ({
  ...table,
  schema: [...table.schema, col],
  rows: table.rows.map((r) => ({ ...r, [col.key]: r[col.key] ?? '' })),
});

/** Patch a column's spec in place (label / type / options / symbol / min / max).
 *  The key is immutable here (renaming a key would orphan row data). */
export const updateColumn = (
  table: SmartTable,
  key: string,
  patch: Partial<Omit<ColumnSpec, 'key'>>,
): SmartTable => ({
  ...table,
  schema: table.schema.map((c) => (c.key === key ? { ...c, ...patch } : c)),
});

/** Remove a column and drop its cell from every row. */
export const deleteColumn = (table: SmartTable, key: string): SmartTable => ({
  ...table,
  schema: table.schema.filter((c) => c.key !== key),
  rows: table.rows.map((r) => {
    const { [key]: _drop, ...rest } = r;
    return rest;
  }),
});
