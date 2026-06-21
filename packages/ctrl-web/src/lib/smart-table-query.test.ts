import { describe, expect, it } from 'vitest';
import { parseSmartTable, serializeSmartTable, type SmartTable } from './smart-table';
import { FieldNotFoundError, queryTable, type Filter } from './smart-table-query';

// Mirrors the kernel query tests (kernel/query.rs) so the client-side engine
// stays semantically identical to what Irisy gets through the :17873 gate.
const SOURCE = `---
title: Leads
schema:
  - { key: name, label: Name, type: text }
  - { key: amount, label: Amount, type: number }
  - { key: due, label: Due, type: date }
  - { key: done, label: Done, type: checkbox }
  - { key: tags, label: Tags, type: tags }
---

| Name   | Amount | Due        | Done | Tags      |
|--------|--------|------------|------|-----------|
| Acme   | 100    | 2026-06-20 | x    | crm, vip  |
| Beta   | 50     | 2026-07-01 |      | crm       |
| Cobalt | 250    | 2026-06-18 |      | lead      |
`;

const NOW = new Date('2026-06-19T12:00:00');

const table = (): SmartTable => parseSmartTable(SOURCE);

describe('queryTable', () => {
  it('parses the schema + rows from the real markdown path', () => {
    const t = table();
    // 5 user fields + the injected system record-id field (ensureRowIds).
    expect(t.schema.filter((c) => !c.system)).toHaveLength(5);
    expect(t.schema[0]?.key).toBe('id');
    expect(t.schema[0]?.system).toBe(true);
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]?.name).toBe('Acme');
    expect(t.rows[0]?.id).toMatch(/^r/);
  });

  it('filters numbers with gt', () => {
    const out = queryTable(table(), { filters: [{ field: 'amount', op: 'gt', value: '80' }] }, NOW);
    expect(out.matchCount).toBe(2);
    expect(out.rows.map((r) => r.name).sort()).toEqual(['Acme', 'Cobalt']);
  });

  it('filters text contains (case-insensitive)', () => {
    const out = queryTable(table(), { filters: [{ field: 'name', op: 'contains', value: 'co' }] }, NOW);
    expect(out.rows.map((r) => r.name)).toEqual(['Cobalt']);
  });

  it('filters checkbox is', () => {
    const out = queryTable(table(), { filters: [{ field: 'done', op: 'is', value: 'true' }] }, NOW);
    expect(out.rows.map((r) => r.name)).toEqual(['Acme']);
  });

  it('OR (any) vs AND (all) across filters', () => {
    const f: Filter[] = [
      { field: 'amount', op: 'gt', value: '80' },
      { field: 'name', op: 'contains', value: 'beta' },
    ];
    expect(queryTable(table(), { filters: f, conjunction: 'and' }, NOW).matchCount).toBe(0);
    expect(queryTable(table(), { filters: f, conjunction: 'or' }, NOW).matchCount).toBe(3);
  });

  it('multi-level group keeps every row', () => {
    const out = queryTable(table(), { groupBy: ['done', 'name'] }, NOW);
    expect(out.matchCount).toBe(3);
  });

  it('filters tags has_tag', () => {
    const out = queryTable(table(), { filters: [{ field: 'tags', op: 'has_tag', value: 'crm' }] }, NOW);
    expect(out.matchCount).toBe(2);
  });

  it('filters date within this_week (Mon 06-15..Sun 06-21)', () => {
    const out = queryTable(table(), { filters: [{ field: 'due', op: 'within', value: 'this_week' }] }, NOW);
    expect(out.matchCount).toBe(2); // 06-20 + 06-18, not 07-01
  });

  it('sorts number desc then limits (matchCount is pre-limit)', () => {
    const out = queryTable(table(), { sort: [{ field: 'amount', desc: true }], limit: 2 }, NOW);
    expect(out.matchCount).toBe(3);
    expect(out.rows.map((r) => r.name)).toEqual(['Cobalt', 'Acme']);
  });

  it('rejects an unknown field with the valid set', () => {
    expect(() => queryTable(table(), { filters: [{ field: 'nope', op: 'eq', value: 'x' }] }, NOW)).toThrow(
      FieldNotFoundError,
    );
  });
});

describe('views (frontmatter view-state, ADR-003 §6.2)', () => {
  it('parses kernel JSON-form views and round-trips them', () => {
    // What the kernel emitter writes (JSON Display, quoted keys).
    const src = `---
title: Leads
schema:
  - { key: stage, label: Stage, type: select, options: [new, won] }
views:
  - {"kind":"kanban","group_by":"stage"}
---

| Stage |
|-------|
| won   |
`;
    const t = parseSmartTable(src);
    expect(t.views).toHaveLength(1);
    expect(t.views[0]).toEqual({ kind: 'kanban', groupBy: 'stage' });
    // Round-trips (re-parse the serialized output yields the same view).
    const t2 = parseSmartTable(serializeSmartTable(t));
    expect(t2.views[0]).toEqual({ kind: 'kanban', groupBy: 'stage' });
  });

  it('parses hand-written flow-form views', () => {
    const src = `---
schema:
  - { key: name, label: Name, type: text }
views:
  - { kind: grid }
---

| Name |
|------|
| x    |
`;
    expect(parseSmartTable(src).views[0]).toEqual({ kind: 'grid', groupBy: null });
  });
});
