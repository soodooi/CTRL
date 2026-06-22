// smart-tables — discover + create the vault's smart tables (ADR-003 §6 /
// ADR-002 §14). A smart table is just a `.md` whose frontmatter declares a
// `schema:` block; this lists those files for the /tables browse page and seeds
// new ones.

import { vaultList, vaultRead, vaultWrite } from '@/lib/kernel';
import { columnKeyFromLabel } from '@/lib/smart-table';
import { isSmartTableFrontmatter } from '@/modules/smart-table';

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

/** Create a new smart table from a template (default blank) and return its path. */
export const createSmartTable = async (rawTitle: string, templateKey = 'blank'): Promise<string> => {
  const tpl = (TEMPLATES[templateKey] ?? TEMPLATES.blank) as TableTemplate;
  const title = rawTitle.trim() || tpl.name;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'table';
  const path = `tables/${slug}.md`;
  const headers = tpl.schema.map((c) => c.label);
  const content = `| ${headers.join(' | ')} |\n|${tpl.schema.map(() => '---').join('|')}|\n| ${tpl.schema.map(() => ' ').join(' | ')} |\n`;
  await vaultWrite({ path, content, frontmatter: { title, schema: tpl.schema } });
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
