// Conditional formatting: the per-field colour rule (color_op / color_value /
// color_bg) must evaluate correctly and round-trip through the markdown
// frontmatter like the other flat-scalar field props.

import { describe, expect, it } from 'vitest';
import {
  matchesColorRule,
  parseSmartTable,
  serializeSmartTable,
  type ColumnSpec,
} from './smart-table';

const col = (patch: Partial<ColumnSpec>): ColumnSpec => ({
  key: 'amount',
  label: 'Amount',
  type: 'number',
  ...patch,
});

describe('matchesColorRule', () => {
  it('returns false when the column has no rule', () => {
    expect(matchesColorRule(col({}), '999')).toBe(false);
  });

  it('gt / lt coerce numbers', () => {
    expect(matchesColorRule(col({ colorOp: 'gt', colorValue: '1000' }), '1500')).toBe(true);
    expect(matchesColorRule(col({ colorOp: 'gt', colorValue: '1000' }), '500')).toBe(false);
    expect(matchesColorRule(col({ colorOp: 'lt', colorValue: '100' }), '50')).toBe(true);
  });

  it('eq / ne / contains compare case-insensitively', () => {
    expect(matchesColorRule(col({ colorOp: 'eq', colorValue: 'Won' }), 'won')).toBe(true);
    expect(matchesColorRule(col({ colorOp: 'ne', colorValue: 'won' }), 'lost')).toBe(true);
    expect(matchesColorRule(col({ colorOp: 'contains', colorValue: 'vip' }), 'crm, VIP')).toBe(true);
  });

  it('empty / not_empty test blankness', () => {
    expect(matchesColorRule(col({ colorOp: 'empty' }), '   ')).toBe(true);
    expect(matchesColorRule(col({ colorOp: 'not_empty' }), 'x')).toBe(true);
    expect(matchesColorRule(col({ colorOp: 'not_empty' }), '')).toBe(false);
  });
});

describe('colour-rule round-trip', () => {
  it('survives serialize → parse', () => {
    const src = `---
title: Deals
schema:
  - { key: stage, label: Stage, type: select, options: [won, lost], color_op: eq, color_value: won, color_bg: 140 }
---

| Stage |
|-------|
| won   |
`;
    const parsed = parseSmartTable(src);
    const stage = parsed.schema.find((c) => c.key === 'stage');
    expect(stage?.colorOp).toBe('eq');
    expect(stage?.colorValue).toBe('won');
    expect(stage?.colorBg).toBe(140);

    const round = parseSmartTable(serializeSmartTable(parsed)).schema.find((c) => c.key === 'stage');
    expect(round?.colorOp).toBe('eq');
    expect(round?.colorValue).toBe('won');
    expect(round?.colorBg).toBe(140);
  });

  it('the chart view kind round-trips (emit/parse symmetry)', () => {
    const src = `---
title: T
schema:
  - { key: a, label: A, type: text }
views:
  - { kind: chart }
---

| A |
|---|
|   |
`;
    const parsed = parseSmartTable(src);
    expect(parsed.views[0]?.kind).toBe('chart');
    const round = parseSmartTable(serializeSmartTable(parsed));
    expect(round.views[0]?.kind).toBe('chart');
  });
});
