// smart-table-chart — the read-only aggregation behind the Chart view (Feishu
// Bitable dashboard parity). Pure + derived: group rows by a field, reduce a
// metric per group, hand the series to the SVG renderer. No charting dependency,
// no stored state (plain-text stays truth; a chart is just a view over the rows).

export type ChartKind = 'bar' | 'pie' | 'line';

/** What to plot per group: a row count, or an aggregate of a number field. */
export type Metric =
  | { kind: 'count' }
  | { kind: 'sum' | 'avg' | 'min' | 'max'; field: string };

export interface Slice {
  label: string;
  value: number;
}

/** Aggregate rows into one slice per distinct value of `groupField`. Groups keep
 *  first-seen order; blank group values bucket under "(empty)". Non-numeric /
 *  blank cells are ignored by the number metrics (an all-blank group → 0). */
export const aggregate = (
  rows: Array<Record<string, string>>,
  groupField: string,
  metric: Metric,
): Slice[] => {
  const order: string[] = [];
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const g = (row[groupField] ?? '').trim() || '(empty)';
    let bucket = buckets.get(g);
    if (!bucket) {
      bucket = [];
      buckets.set(g, bucket);
      order.push(g);
    }
    if (metric.kind === 'count') {
      bucket.push(1);
    } else {
      const raw = row[metric.field] ?? '';
      const n = Number(raw);
      if (raw.trim() !== '' && !Number.isNaN(n)) bucket.push(n);
    }
  }
  return order.map((label) => {
    const xs = buckets.get(label) ?? [];
    let value = 0;
    if (metric.kind === 'count') value = xs.length;
    else if (xs.length === 0) value = 0;
    else if (metric.kind === 'sum') value = xs.reduce((a, b) => a + b, 0);
    else if (metric.kind === 'avg') value = xs.reduce((a, b) => a + b, 0) / xs.length;
    else if (metric.kind === 'min') value = Math.min(...xs);
    else value = Math.max(...xs);
    return { label, value };
  });
};

/** Deterministic colour for a slice (matches the pill hue scheme). */
export const sliceHue = (label: string): number => {
  let h = 0;
  for (let i = 0; i < label.length; i += 1) h = (h * 31 + label.charCodeAt(i)) % 360;
  return h;
};

/** SVG arc path for one pie slice spanning [startFrac, endFrac) of the circle,
 *  centred at (cx, cy) with radius r. Fractions are 0..1 clockwise from 12 o'clock. */
export const arcPath = (
  cx: number,
  cy: number,
  r: number,
  startFrac: number,
  endFrac: number,
): string => {
  const a0 = startFrac * 2 * Math.PI - Math.PI / 2;
  const a1 = endFrac * 2 * Math.PI - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  // A near-full single slice would degenerate; draw it as a full circle.
  if (endFrac - startFrac >= 0.999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  return `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
};
