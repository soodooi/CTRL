// smart-tables — discover + create the vault's smart tables (ADR-003 §6 /
// ADR-002 §14). A smart table is just a `.md` whose frontmatter declares a
// `schema:` block; this lists those files for the /tables browse page and seeds
// new ones.

import { vaultList, vaultRead, vaultWrite } from '@/lib/kernel';

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
