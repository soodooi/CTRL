// Auto / metadata fields (auto_number / created_at / modified_at): every kind
// of table needs system fields that fill themselves — a sequential number, a
// creation date, and a last-modified date. These verify the row mutations
// (appendRow / appendRowWithValues / updateCell) populate them correctly.

import { describe, expect, it } from 'vitest';
import {
  appendRow,
  appendRowWithValues,
  updateCell,
  baseCellType,
  type SmartTable,
} from './smart-table';

const todayISO = (): string => new Date().toISOString().slice(0, 10);

const table = (): SmartTable => ({
  schema: [
    { key: 'id', label: 'ID', type: 'text', system: true },
    { key: 'seq', label: 'No.', type: 'auto_number' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'created', label: 'Created', type: 'created_at' },
    { key: 'modified', label: 'Modified', type: 'modified_at' },
  ],
  rows: [],
  views: [],
  extraFrontmatter: {},
});

describe('auto / metadata fields', () => {
  it('maps auto_number to number and the timestamps to date', () => {
    expect(baseCellType('auto_number')).toBe('number');
    expect(baseCellType('created_at')).toBe('date');
    expect(baseCellType('modified_at')).toBe('date');
  });

  it('appendRow stamps created_at + modified_at and a fresh record id', () => {
    const t = appendRow(table());
    const row = t.rows[0];
    expect(row?.id).toMatch(/^r/);
    expect(row?.created).toBe(todayISO());
    expect(row?.modified).toBe(todayISO());
    // auto_number is derived at render time, not stored.
    expect(row?.seq).toBe('');
  });

  it('appendRowWithValues fills auto fields but lets values win', () => {
    const t = appendRowWithValues(table(), { name: 'Acme' });
    const row = t.rows[0];
    expect(row?.name).toBe('Acme');
    expect(row?.created).toBe(todayISO());
    expect(row?.id).toMatch(/^r/);
  });

  it('updateCell bumps every modified_at field on edit', () => {
    const seeded: SmartTable = {
      ...table(),
      rows: [{ id: 'r1', seq: '', name: 'old', created: '2020-01-01', modified: '2020-01-01' }],
    };
    const t = updateCell(seeded, 0, 'name', 'new');
    expect(t.rows[0]?.name).toBe('new');
    expect(t.rows[0]?.modified).toBe(todayISO());
    // created_at is untouched by edits.
    expect(t.rows[0]?.created).toBe('2020-01-01');
  });
});
