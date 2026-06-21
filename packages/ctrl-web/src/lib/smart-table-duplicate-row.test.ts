// Duplicate row: the copy lands right after the original, gets a fresh record id
// and refreshed created/modified stamps, but carries every other value over.

import { describe, expect, it } from 'vitest';
import { duplicateRow, type SmartTable } from './smart-table';

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const table = (): SmartTable => ({
  schema: [
    { key: 'id', label: 'ID', type: 'text', system: true },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'created', label: 'Created', type: 'created_at' },
    { key: 'modified', label: 'Modified', type: 'modified_at' },
  ],
  rows: [
    { id: 'r1', name: 'Acme', created: '2020-01-01', modified: '2020-01-01' },
    { id: 'r2', name: 'Beta', created: '2020-01-02', modified: '2020-01-02' },
  ],
  views: [],
  extraFrontmatter: {},
});

describe('duplicateRow', () => {
  it('inserts the copy right after the original', () => {
    const t = duplicateRow(table(), 0);
    expect(t.rows.map((r) => r.name)).toEqual(['Acme', 'Acme', 'Beta']);
  });

  it('gives the copy a fresh id and refreshed timestamps', () => {
    const t = duplicateRow(table(), 0);
    const copy = t.rows[1];
    expect(copy?.id).not.toBe('r1');
    expect(copy?.id).toMatch(/^r/);
    expect(copy?.created).toBe(todayISO());
    expect(copy?.modified).toBe(todayISO());
    expect(copy?.name).toBe('Acme');
  });

  it('leaves the original row untouched', () => {
    const t = duplicateRow(table(), 0);
    expect(t.rows[0]).toEqual({ id: 'r1', name: 'Acme', created: '2020-01-01', modified: '2020-01-01' });
  });

  it('ignores an out-of-range index', () => {
    const t = table();
    expect(duplicateRow(t, 9).rows).toHaveLength(2);
  });

  it('does not mutate the input', () => {
    const t = table();
    duplicateRow(t, 0);
    expect(t.rows).toHaveLength(2);
  });
});
