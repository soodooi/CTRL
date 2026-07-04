// loadPackRecords — the §14 product-grade data path (ADR-002 §14.12): describe
// (fields) + query (rows) through the gate, combined into the SourceData the
// scene's records table renders. Locks the mapping (node env — no DOM; the table
// rendering itself is verified visually at /pack-lab).

import { describe, it, expect, vi } from 'vitest';

const describeSourceMock = vi.fn();
const querySourceMock = vi.fn();

vi.mock('./kernel', () => ({
  describeSource: (...a: unknown[]) => describeSourceMock(...a),
  querySource: (...a: unknown[]) => querySourceMock(...a),
  listMcps: vi.fn(),
  gateInvoke: vi.fn(),
}));
vi.mock('./bridge', () => ({ invoke: vi.fn() }));

import { loadPackRecords } from './feature-pack';

describe('loadPackRecords', () => {
  it('combines describe fields + query rows into SourceData for the same source_id', async () => {
    describeSourceMock.mockResolvedValue({
      source_kind: 'record',
      fields: [
        { key: 'symbol', label: 'Symbol', type: 'text' },
        { key: 'value', label: 'Value', type: 'currency' },
      ],
      operators: [],
    });
    querySourceMock.mockResolvedValue({
      rows: [{ symbol: 'AAPL', value: '1900.5' }],
      match_count: 1,
    });

    const data = await loadPackRecords('ctrl-ghostfolio');

    // Both verbs addressed the same connector.
    expect(describeSourceMock).toHaveBeenCalledWith('ctrl-ghostfolio');
    expect(querySourceMock).toHaveBeenCalledWith('ctrl-ghostfolio', {});
    // describe drives the columns; query drives the rows; match_count carried.
    expect(data.fields.map((f) => f.key)).toEqual(['symbol', 'value']);
    expect(data.rows).toEqual([{ symbol: 'AAPL', value: '1900.5' }]);
    expect(data.matchCount).toBe(1);
  });
});
