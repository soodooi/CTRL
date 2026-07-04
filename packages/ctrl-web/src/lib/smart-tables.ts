// smart-tables — discover + create the vault's smart tables (ADR-003 §6 /
// ADR-002 §14). A smart table is just a `.md` whose frontmatter declares a
// `schema:` block; this lists those files for the /tables browse page and seeds
// new ones.

import {
  vaultList,
  vaultRead,
  vaultWrite,
  describeSmartTable,
  querySmartTable,
} from '@/lib/kernel';
import { columnKeyFromLabel } from '@/lib/smart-table';
import { isSmartTableFrontmatter } from '@/modules/smart-table';
import { parseCsv, toCsv } from './smart-table-csv';

// Re-export the pure CSV codec so existing `import { parseCsv } from smart-tables`
// call sites keep working (the codec moved to smart-table-csv.ts to unit-test it
// without pulling the kernel/alias graph).
export { parseCsv, toCsv } from './smart-table-csv';

export interface SmartTableEntry {
  path: string;
  title: string;
  fields: number;
}

/** Scan the vault for markdown files carrying a `schema:` frontmatter block. */
export const listSmartTables = async (): Promise<SmartTableEntry[]> => {
  const paths = await vaultList();
  const entries: SmartTableEntry[] = [];
  for (const path of paths) {
    if (!path.toLowerCase().endsWith('.md')) continue;
    // Smart tables live in their OWN folder (`tables/`), separate from the
    // user's Obsidian notes elsewhere in the vault, so the two never collide
    // (bao 2026-06-21). The table workspace only ever lists `tables/`.
    if (!path.startsWith('tables/')) continue;
    try {
      const entry = await vaultRead(path);
      const fm = entry.frontmatter as { schema?: unknown[]; title?: unknown };
      if (isSmartTableFrontmatter(fm)) {
        const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title : path.replace(/\.md$/i, '');
        entries.push({ path, title, fields: fm.schema?.length ?? 0 });
      }
    } catch {
      // Unreadable file — skip, not fatal for a read-only scan.
    }
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title));
};

type TplField = { key: string; label: string; type: string; options?: string[]; symbol?: string };
export interface TableTemplate {
  name: string;
  icon: string;
  schema: TplField[];
}

// Built-in templates — pick a scenario, get a ready-made table (the smart table
// adapts to any need: CRM / tasks / inventory / project / blank).
export const TEMPLATES: Record<string, TableTemplate> = {
  blank: {
    name: 'Blank',
    icon: '▦',
    schema: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['todo', 'doing', 'done'] },
      { key: 'due', label: 'Due', type: 'date' },
    ],
  },
  crm: {
    name: 'CRM',
    icon: '◑',
    schema: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'stage', label: 'Stage', type: 'select', options: ['lead', 'proposal', 'won', 'lost'] },
      { key: 'amount', label: 'Amount', type: 'currency', symbol: '$' },
      { key: 'owner', label: 'Owner', type: 'user' },
      { key: 'due', label: 'Due', type: 'date' },
    ],
  },
  tasks: {
    name: 'Tasks',
    icon: '✓',
    schema: [
      { key: 'task', label: 'Task', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['todo', 'doing', 'done'] },
      { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'med', 'high'] },
      { key: 'assignee', label: 'Assignee', type: 'user' },
      { key: 'due', label: 'Due', type: 'date' },
      { key: 'progress', label: 'Progress', type: 'percent' },
    ],
  },
  inventory: {
    name: 'Inventory',
    icon: '▤',
    schema: [
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'qty', label: 'Qty', type: 'number' },
      { key: 'price', label: 'Price', type: 'currency', symbol: '$' },
      { key: 'category', label: 'Category', type: 'select', options: ['A', 'B', 'C'] },
      { key: 'rating', label: 'Rating', type: 'rating' },
    ],
  },
  project: {
    name: 'Project',
    icon: '◇',
    schema: [
      { key: 'milestone', label: 'Milestone', type: 'text' },
      { key: 'owner', label: 'Owner', type: 'user' },
      { key: 'status', label: 'Status', type: 'select', options: ['planned', 'active', 'done'] },
      { key: 'start', label: 'Start', type: 'date' },
      { key: 'end', label: 'End', type: 'date' },
      { key: 'progress', label: 'Progress', type: 'percent' },
    ],
  },
};

/** Slugify a title into a filename stem (shared by create + import). */
const slugify = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'table';

/** Pick a `tables/<slug>.md` path that doesn't collide with an existing file
 *  (so two tables from the same template don't silently overwrite). */
const uniqueTablePath = async (baseSlug: string): Promise<string> => {
  let existing: Set<string>;
  try {
    existing = new Set(await vaultList());
  } catch {
    existing = new Set();
  }
  if (!existing.has(`tables/${baseSlug}.md`)) return `tables/${baseSlug}.md`;
  for (let n = 2; ; n += 1) {
    const candidate = `tables/${baseSlug}-${n}.md`;
    if (!existing.has(candidate)) return candidate;
  }
};

/** Create a new smart table from a template (default blank) and return its path. */
export const createSmartTable = async (rawTitle: string, templateKey = 'blank'): Promise<string> => {
  const tpl = (TEMPLATES[templateKey] ?? TEMPLATES.blank) as TableTemplate;
  const title = rawTitle.trim() || tpl.name;
  const path = await uniqueTablePath(slugify(title));
  const headers = tpl.schema.map((c) => c.label);
  const content = `| ${headers.join(' | ')} |\n|${tpl.schema.map(() => '---').join('|')}|\n| ${tpl.schema.map(() => ' ').join(' | ')} |\n`;
  await vaultWrite({ path, content, frontmatter: { title, schema: tpl.schema } });
  return path;
};

// ── Univer spreadsheets (`tables/*.sheet.md`) — the Excel-style sibling of the
// smart-table (plan-univer-formula-augment.md). Same tables/ home so the panel
// is one tabular-data workspace; a .sheet.md carries no `schema:` block so
// listSmartTables skips it and the two lists never overlap.
export interface SheetEntry {
  path: string;
  title: string;
}

/** Scan the vault for Univer spreadsheets (`tables/<name>.sheet.md`). */
export const listSheets = async (): Promise<SheetEntry[]> => {
  let paths: string[];
  try {
    paths = await vaultList();
  } catch {
    return [];
  }
  return paths
    .filter((p) => p.startsWith('tables/') && p.toLowerCase().endsWith('.sheet.md'))
    .map((path) => ({ path, title: path.replace(/^tables\//, '').replace(/\.sheet\.md$/i, '') }))
    .sort((a, b) => a.title.localeCompare(b.title));
};

/** Pick a free `tables/<slug>.sheet.md` path (no silent overwrite). */
const uniqueSheetPath = async (baseSlug: string): Promise<string> => {
  let existing: Set<string>;
  try {
    existing = new Set(await vaultList());
  } catch {
    existing = new Set();
  }
  const slug = baseSlug || 'spreadsheet';
  if (!existing.has(`tables/${slug}.sheet.md`)) return `tables/${slug}.sheet.md`;
  for (let n = 2; ; n += 1) {
    const candidate = `tables/${slug}-${n}.sheet.md`;
    if (!existing.has(candidate)) return candidate;
  }
};

/** Create a blank Univer spreadsheet and return its path (one-shot; no prompt,
 *  rename via the title afterwards — mirrors createSmartTable). */
export const createSheet = async (rawTitle = 'Spreadsheet'): Promise<string> => {
  const title = rawTitle.trim() || 'Spreadsheet';
  const slug = slugify(title);
  const path = await uniqueSheetPath(slug);
  const snapshot = {
    id: slug || 'sheet',
    name: title,
    sheetOrder: ['sheet-01'],
    sheets: { 'sheet-01': { id: 'sheet-01', name: 'Sheet1', cellData: {} } },
  };
  await vaultWrite({
    path,
    content: JSON.stringify(snapshot, null, 2),
    frontmatter: { kind: 'univer-sheet' },
  });
  return path;
};

/** Trigger a browser download of a text blob — the local-first "export" (mirrors
 *  AmbientHome's artifact download). */
const downloadTextFile = (filename: string, text: string, mime: string): void => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/** Export a smart table as a downloaded CSV (Grist/Bitable export parity): describe
 *  (labels + field order) + query (all rows, incl. computed relational columns)
 *  through the :17873 gate, serialize, download. The plain-text `.md` stays the
 *  real truth (vim test) — this is a convenience snapshot. */
export const exportTableCsv = async (path: string, title: string): Promise<void> => {
  const [describe, result] = await Promise.all([
    describeSmartTable(path),
    querySmartTable(path, {}),
  ]);
  const headers = describe.fields.map((f) => f.label || f.key);
  const rows = result.rows.map((r) => describe.fields.map((f) => r[f.key] ?? ''));
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'table';
  downloadTextFile(`${slug}.csv`, toCsv(headers, rows), 'text/csv;charset=utf-8');
};

/** Import a CSV string as a new smart table (header row -> text schema). */
export const importCsv = async (rawName: string, csv: string): Promise<string> => {
  const rows = parseCsv(csv);
  const headers = rows[0];
  if (!headers) throw new Error('empty CSV');
  const keys: string[] = [];
  const schema = headers.map((h) => {
    const key = columnKeyFromLabel(h || 'field', keys);
    keys.push(key);
    return { key, label: h.trim() || key, type: 'text' as const };
  });
  const title = rawName.trim() || 'Imported table';
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imported';
  // Avoid silently overwriting an existing table of the same name — pick a
  // free `tables/<slug>.md` path just like createSmartTable does.
  const path = await uniqueTablePath(slug);
  const lines = [
    `| ${headers.map((h) => h.trim() || ' ').join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.slice(1).map(
      (r) => `| ${headers.map((_, i) => (r[i] ?? '').replace(/\|/g, '\\|').trim()).join(' | ')} |`,
    ),
  ];
  await vaultWrite({ path, content: `${lines.join('\n')}\n`, frontmatter: { title, schema } });
  return path;
};
