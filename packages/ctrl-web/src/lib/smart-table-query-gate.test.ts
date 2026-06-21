// §14 read-half bindings (describeSmartTable / querySmartTable) — assert they
// call the right kernel command with the right arg shape, and normalize an
// empty request to explicit defaults the Rust side deserializes cleanly.

import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('./bridge', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { describeSmartTable, querySmartTable } from './kernel';

afterEach(() => invoke.mockReset());

describe('describeSmartTable', () => {
  it('calls smart_table_describe with the path', async () => {
    invoke.mockResolvedValue({ source_kind: 'smart_table', fields: [], operators: [] });
    const out = await describeSmartTable('tables/leads.md');
    expect(invoke).toHaveBeenCalledWith('smart_table_describe', { args: { path: 'tables/leads.md' } });
    expect(out.source_kind).toBe('smart_table');
  });
});

describe('querySmartTable', () => {
  it('fills explicit defaults for an empty request', async () => {
    invoke.mockResolvedValue({ rows: [], match_count: 0 });
    await querySmartTable('tables/leads.md');
    expect(invoke).toHaveBeenCalledWith('smart_table_query', {
      args: { path: 'tables/leads.md', filters: [], sort: [], group_by: null, limit: null },
    });
  });

  it('passes a structured filter/sort/group request through verbatim', async () => {
    invoke.mockResolvedValue({ rows: [{ name: 'Acme' }], match_count: 1 });
    const res = await querySmartTable('tables/leads.md', {
      filters: [{ field: 'stage', op: 'eq', value: 'won' }],
      sort: [{ field: 'amount', desc: true }],
      group_by: 'stage',
      limit: 50,
    });
    expect(invoke).toHaveBeenCalledWith('smart_table_query', {
      args: {
        path: 'tables/leads.md',
        filters: [{ field: 'stage', op: 'eq', value: 'won' }],
        sort: [{ field: 'amount', desc: true }],
        group_by: 'stage',
        limit: 50,
      },
    });
    expect(res.match_count).toBe(1);
  });
});
