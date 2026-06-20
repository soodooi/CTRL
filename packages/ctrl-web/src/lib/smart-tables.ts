// smart-tables — discover + create the vault's smart tables (ADR-003 §6 /
// ADR-002 §14). A smart table is just a `.md` whose frontmatter declares a
// `schema:` block; this lists those files for the /tables browse page and seeds
// new ones.

import { vaultList, vaultRead, vaultWrite } from '@/lib/kernel';
import { columnKeyFromLabel } from '@/lib/smart-table';

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
    // Skip CTRL system dirs (.irisy-memory, .irisy-reflect, etc.).
    if (path.split('/').some((seg) => seg.startsWith('.'))) continue;
    try {
      const entry = await vaultRead(path);
      const fm = entry.frontmatter as { schema?: unknown; title?: unknown };
      if (Array.isArray(fm.schema) && fm.schema.length > 0) {
        const title = typeof fm.title === 'string' && fm.title.trim() ? fm.title : path.replace(/\.md$/i, '');
        entries.push({ path, title, fields: fm.schema.length });
      }
    } catch {
      // Unreadable file — skip, not fatal for a read-only scan.
    }
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title));
};

const STARTER_SCHEMA = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['todo', 'doing', 'done'] },
  { key: 'due', label: 'Due', type: 'date' },
];

/** Create a new smart table (frontmatter schema + an empty starter row) and
 *  return its vault path. */
export const createSmartTable = async (rawTitle: string): Promise<string> => {
  const title = rawTitle.trim() || 'New table';
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'table';
  const path = `tables/${slug}.md`;
  const content = '| Name | Status | Due |\n|---|---|---|\n|  | todo |  |\n';
  await vaultWrite({ path, content, frontmatter: { title, schema: STARTER_SCHEMA } });
  return path;
};

/** Minimal RFC4180-ish CSV parser: handles quoted fields, escaped quotes,
 *  and \r\n. Drops fully blank rows. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') {
      cur += c;
    }
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
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
  const path = `tables/${slug}.md`;
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
