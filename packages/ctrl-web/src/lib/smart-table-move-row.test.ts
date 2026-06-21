// Manual row reordering: row order IS the data order in the plain-text markdown,
// so moveRow just permutes the rows array. These lock the boundary behaviour.

import { describe, expect, it } from 'vitest';
import { moveRow, type SmartTable } from './smart-table';

const table = (...names: string[]): SmartTable => ({
  schema: [{ key: 'name', label: 'Name', type: 'text' }],
  rows: names.map((name) => ({ name })),
  views: [],
  extraFrontmatter: {},
});
const names = (t: SmartTable): string[] => t.rows.map((r) => r.name ?? '');

describe('moveRow', () => {
  it('moves a row down', () => {
    expect(names(moveRow(table('a', 'b', 'c', 'd'), 0, 2))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a row up', () => {
    expect(names(moveRow(table('a', 'b', 'c', 'd'), 3, 1))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is a no-op when from === to', () => {
    expect(names(moveRow(table('a', 'b', 'c'), 1, 1))).toEqual(['a', 'b', 'c']);
  });

  it('ignores out-of-range indices', () => {
    expect(names(moveRow(table('a', 'b'), 5, 0))).toEqual(['a', 'b']);
    expect(names(moveRow(table('a', 'b'), 0, -1))).toEqual(['a', 'b']);
  });

  it('does not mutate the input table', () => {
    const t = table('a', 'b', 'c');
    moveRow(t, 0, 2);
    expect(names(t)).toEqual(['a', 'b', 'c']);
  });
});
