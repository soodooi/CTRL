import { describe, expect, it } from 'vitest';
import { aggregate, arcPath, sliceHue } from './smart-table-chart';

const rows = [
  { stage: 'lead', amount: '100' },
  { stage: 'lead', amount: '200' },
  { stage: 'won', amount: '500' },
  { stage: 'won', amount: '' },
  { stage: '', amount: '50' },
];

describe('aggregate', () => {
  it('counts rows per group, keeping first-seen order', () => {
    expect(aggregate(rows, 'stage', { kind: 'count' })).toEqual([
      { label: 'lead', value: 2 },
      { label: 'won', value: 2 },
      { label: '(empty)', value: 1 },
    ]);
  });

  it('sums a number field, ignoring blank / non-numeric cells', () => {
    expect(aggregate(rows, 'stage', { kind: 'sum', field: 'amount' })).toEqual([
      { label: 'lead', value: 300 },
      { label: 'won', value: 500 },
      { label: '(empty)', value: 50 },
    ]);
  });

  it('averages over only the numeric cells in a group', () => {
    const out = aggregate(rows, 'stage', { kind: 'avg', field: 'amount' });
    expect(out[0]).toEqual({ label: 'lead', value: 150 });
    // won has one numeric cell (500) + one blank → avg over the single value.
    expect(out[1]).toEqual({ label: 'won', value: 500 });
  });

  it('min / max over a group', () => {
    expect(aggregate(rows, 'stage', { kind: 'min', field: 'amount' })[0]?.value).toBe(100);
    expect(aggregate(rows, 'stage', { kind: 'max', field: 'amount' })[0]?.value).toBe(200);
  });

  it('a group with no numeric values reduces to 0', () => {
    const out = aggregate([{ stage: 'x', amount: '' }], 'stage', { kind: 'sum', field: 'amount' });
    expect(out).toEqual([{ label: 'x', value: 0 }]);
  });
});

describe('sliceHue', () => {
  it('is deterministic and in range', () => {
    expect(sliceHue('lead')).toBe(sliceHue('lead'));
    expect(sliceHue('won')).toBeGreaterThanOrEqual(0);
    expect(sliceHue('won')).toBeLessThan(360);
  });
});

describe('arcPath', () => {
  it('produces a closed path for a partial slice', () => {
    const d = arcPath(50, 50, 40, 0, 0.25);
    expect(d.startsWith('M 50 50')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('draws a full circle for a whole slice', () => {
    const d = arcPath(50, 50, 40, 0, 1);
    expect(d).toContain('A 40 40 0 1 1');
    expect(d.endsWith('Z')).toBe(true);
  });
});
