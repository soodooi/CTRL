import { describe, expect, it } from 'vitest';
import { timelineLayout } from './smart-table-timeline';

const rows = [
  { task: 'A', start: '2026-01-01', end: '2026-01-10' },
  { task: 'B', start: '2026-01-11', end: '2026-01-20' },
  { task: 'C', start: '2026-01-06', end: '' },
  { task: 'D', start: '', end: '2026-01-09' },
];

describe('timelineLayout', () => {
  it('drops rows without a valid start date', () => {
    const { bars } = timelineLayout(rows, 'task', 'start', 'end');
    expect(bars.map((b) => b.label)).toEqual(['A', 'B', 'C']);
  });

  it('spans the domain from earliest start to latest end', () => {
    const { minDate, maxDate } = timelineLayout(rows, 'task', 'start', 'end');
    expect(minDate).toBe('2026-01-01');
    expect(maxDate).toBe('2026-01-20');
  });

  it('positions bars proportionally on the axis', () => {
    const { bars } = timelineLayout(rows, 'task', 'start', 'end');
    const a = bars.find((b) => b.label === 'A');
    expect(a?.leftPct).toBe(0);
    const b = bars.find((b) => b.label === 'B');
    // B starts day 10 of a 19-day span (Jan 1..Jan 20).
    expect(Math.round(b?.leftPct ?? -1)).toBe(53);
  });

  it('a row with no end date is a single-day bar', () => {
    const { bars } = timelineLayout(rows, 'task', 'start', 'end');
    const c = bars.find((b) => b.label === 'C');
    expect(c?.start).toBe('2026-01-06');
    expect(c?.end).toBe('2026-01-06');
  });

  it('ignores an end before the start (treats as single day)', () => {
    const out = timelineLayout([{ task: 'X', start: '2026-02-10', end: '2026-02-01' }], 'task', 'start', 'end');
    expect(out.bars[0]?.end).toBe('2026-02-10');
  });

  it('a single-day domain renders full-width bars', () => {
    const out = timelineLayout([{ task: 'X', start: '2026-03-01', end: '2026-03-01' }], 'task', 'start', 'end');
    expect(out.bars[0]?.leftPct).toBe(0);
    expect(out.bars[0]?.widthPct).toBe(100);
  });

  it('returns empty when no row has a start', () => {
    expect(timelineLayout([{ task: 'X', start: '' }], 'task', 'start').bars).toEqual([]);
  });
});
