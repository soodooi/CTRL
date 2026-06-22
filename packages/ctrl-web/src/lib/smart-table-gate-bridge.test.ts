import { describe, expect, it } from 'vitest';
import { attachCanonicalIdx, buildGateRequest } from './smart-table-gate-bridge';
import type { SmartTable } from './smart-table';

describe('buildGateRequest', () => {
  it('passes filters + conjunction + ordered sort keys through', () => {
    const req = buildGateRequest(
      [{ field: 'stage', op: 'eq', value: 'won' }],
      'or',
      [
        { field: 'amount', desc: true },
        { field: 'name', desc: false },
      ],
      ['stage', null, 'owner'],
    );
    expect(req).toEqual({
      filters: [{ field: 'stage', op: 'eq', value: 'won' }],
      conjunction: 'or',
      sort: [
        { field: 'amount', desc: true },
        { field: 'name', desc: false },
      ],
      group_by: ['stage', 'owner'],
    });
  });

  it('emits empty sort + group when none set', () => {
    const req = buildGateRequest([], 'and', [], [null, null]);
    expect(req.sort).toEqual([]);
    expect(req.group_by).toEqual([]);
  });
});

describe('attachCanonicalIdx', () => {
  const table: SmartTable = {
    schema: [
      { key: 'id', label: 'ID', type: 'text', system: true },
      { key: 'name', label: 'Name', type: 'text' },
    ],
    rows: [
      { id: 'r1', name: 'Acme' },
      { id: 'r2', name: 'Beta' },
      { id: 'r3', name: 'Cobalt' },
    ],
    views: [],
    extraFrontmatter: {},
  };

  it('maps kernel rows back to their canonical index via id', () => {
    // Kernel returned them filtered + reordered (Cobalt, Acme).
    const out = attachCanonicalIdx([{ id: 'r3', name: 'Cobalt' }, { id: 'r1', name: 'Acme' }], table);
    expect(out[0]?.__idx).toBe('2');
    expect(out[1]?.__idx).toBe('0');
  });

  it('maps an unknown id to -1 (never misroutes an edit)', () => {
    const out = attachCanonicalIdx([{ id: 'rX', name: 'Ghost' }], table);
    expect(out[0]?.__idx).toBe('-1');
  });
});
