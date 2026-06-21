// SmartTableChart — the Chart view (Feishu Bitable dashboard parity). A
// read-only, derived view: group rows by a field, reduce a metric, draw bar /
// pie / line as hand-rolled SVG (no charting dependency). Self-contained local
// state for the chart kind, group field, and metric; nothing is persisted
// (plain-text stays truth — a chart is just a lens over the rows).

import { useMemo, useState, type ReactElement } from 'react';
import { baseCellType, type ColumnSpec } from '@/lib/smart-table';
import {
  aggregate,
  arcPath,
  sliceHue,
  type ChartKind,
  type Metric,
} from '@/lib/smart-table-chart';
import styles from './Viewer.module.css';

type Row = Record<string, string>;

const KINDS: ChartKind[] = ['bar', 'pie', 'line'];
const AGGS: Array<Metric['kind']> = ['count', 'sum', 'avg', 'min', 'max'];

export const ChartView = ({
  rows,
  schema,
}: {
  rows: Row[];
  schema: ColumnSpec[];
}): ReactElement => {
  const groupable = schema.filter(
    (c) => c.type === 'select' || c.type === 'checkbox' || baseCellType(c.type) === 'text',
  );
  const numberCols = schema.filter((c) => baseCellType(c.type) === 'number');

  // Prefer a categorical field (select / checkbox) as the default group — a
  // text field like "Name" gives one bar per row, which is rarely what you want.
  const defaultGroup =
    groupable.find((c) => c.type === 'select' || c.type === 'checkbox')?.key ??
    groupable[0]?.key ??
    '';

  const [kind, setKind] = useState<ChartKind>('bar');
  const [groupField, setGroupField] = useState<string>(defaultGroup);
  const [agg, setAgg] = useState<Metric['kind']>('count');
  const [metricField, setMetricField] = useState<string>(numberCols[0]?.key ?? '');

  const metric: Metric = agg === 'count' ? { kind: 'count' } : { kind: agg, field: metricField };
  const slices = useMemo(
    () => (groupField ? aggregate(rows, groupField, metric) : []),
    [rows, groupField, agg, metricField],
  );
  const max = slices.reduce((m, s) => Math.max(m, s.value), 0) || 1;
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  if (!groupField) {
    return <div className={styles.kanbanEmpty}>Add a select / text field to chart by.</div>;
  }

  return (
    <div className={styles.chartView} data-testid="smart-table-chart">
      <div className={styles.chartBar}>
        <div className={styles.chartKinds}>
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={styles.chartKindBtn}
              data-on={kind === k}
              onClick={() => setKind(k)}
            >
              {k === 'bar' ? '▮' : k === 'pie' ? '◔' : '╱'} {k}
            </button>
          ))}
        </div>
        <label className={styles.chartCtl}>
          by
          <select value={groupField} onChange={(e) => setGroupField(e.target.value)}>
            {groupable.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.chartCtl}>
          <select value={agg} onChange={(e) => setAgg(e.target.value as Metric['kind'])}>
            {AGGS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {agg !== 'count' && (
            <select value={metricField} onChange={(e) => setMetricField(e.target.value)}>
              {numberCols.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>

      {slices.length === 0 ? (
        <div className={styles.kanbanEmpty}>No data to chart.</div>
      ) : kind === 'bar' ? (
        <div className={styles.chartBars}>
          {slices.map((s) => (
            <div key={s.label} className={styles.chartRow}>
              <span className={styles.chartLabel} title={s.label}>
                {s.label}
              </span>
              <span className={styles.chartTrack}>
                <span
                  className={styles.chartFill}
                  style={{
                    width: `${(s.value / max) * 100}%`,
                    background: `hsl(${sliceHue(s.label)} 65% 55%)`,
                  }}
                />
              </span>
              <span className={styles.chartValue}>{fmt(s.value)}</span>
            </div>
          ))}
        </div>
      ) : kind === 'pie' ? (
        <div className={styles.chartPieWrap}>
          <svg viewBox="0 0 120 120" className={styles.chartPie} role="img" aria-label="pie chart">
            {(() => {
              let acc = 0;
              return slices.map((s) => {
                const start = acc / total;
                acc += s.value;
                const end = acc / total;
                return (
                  <path
                    key={s.label}
                    d={arcPath(60, 60, 56, start, end)}
                    fill={`hsl(${sliceHue(s.label)} 65% 60%)`}
                    stroke="var(--color-surface, #fff)"
                    strokeWidth="1"
                  />
                );
              });
            })()}
          </svg>
          <ul className={styles.chartLegend}>
            {slices.map((s) => (
              <li key={s.label}>
                <span className={styles.chartSwatch} style={{ background: `hsl(${sliceHue(s.label)} 65% 60%)` }} />
                {s.label}
                <span className={styles.chartValue}>
                  {fmt(s.value)} ({Math.round((s.value / total) * 100)}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <svg viewBox="0 0 320 160" className={styles.chartLine} role="img" aria-label="line chart">
          <polyline
            fill="none"
            stroke="var(--color-accent, #6aa3ff)"
            strokeWidth="2"
            points={slices
              .map((s, i) => {
                const x = slices.length === 1 ? 160 : 12 + (i * 296) / (slices.length - 1);
                const y = 148 - (s.value / max) * 132;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ')}
          />
          {slices.map((s, i) => {
            const x = slices.length === 1 ? 160 : 12 + (i * 296) / (slices.length - 1);
            const y = 148 - (s.value / max) * 132;
            return (
              <g key={s.label}>
                <circle cx={x} cy={y} r="3" fill="var(--color-accent, #6aa3ff)" />
                <text x={x} y={158} textAnchor="middle" className={styles.chartTick}>
                  {s.label.length > 6 ? `${s.label.slice(0, 6)}…` : s.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};
