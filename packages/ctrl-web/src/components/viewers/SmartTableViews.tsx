// SmartTableViews — the read-only derived views (gallery / calendar / summary)
// extracted from SmartTableView for clarity. Each takes the already-queried
// rows + the visible schema and renders; no state, no callbacks.

import { type ReactElement } from 'react';
import { baseCellType, type ColumnSpec } from '@/lib/smart-table';
import styles from './Viewer.module.css';

type Row = Record<string, string>;

/** Card-wall gallery: one card per row, all visible fields. */
export const GalleryView = ({ rows, schema }: { rows: Row[]; schema: ColumnSpec[] }): ReactElement => (
  <div className={styles.gallery} data-testid="smart-table-gallery">
    {rows.map((row, i) => (
      <div key={i} className={styles.kanbanCard}>
        {schema.map((c) => (
          <div key={c.key} className={styles.kanbanCardRow}>
            <span className={styles.kanbanCardLabel}>{c.label}</span>
            <span className={styles.kanbanCardValue}>{row[c.key] || '—'}</span>
          </div>
        ))}
      </div>
    ))}
  </div>
);

/** Agenda calendar grouped by the first date field. `allSchema` includes system
 *  columns so the date field can be found even if hidden. */
export const CalendarView = ({
  rows,
  schema,
  allSchema,
}: {
  rows: Row[];
  schema: ColumnSpec[];
  allSchema: ColumnSpec[];
}): ReactElement => {
  const dateField = allSchema.find((c) => baseCellType(c.type) === 'date')?.key;
  if (!dateField) {
    return <div className={styles.kanbanEmpty}>Add a date field to use the calendar.</div>;
  }
  const titleKey = schema.find((c) => c.key !== dateField)?.key;
  const groups = new Map<string, Row[]>();
  for (const row of [...rows].sort((a, b) => (a[dateField] ?? '').localeCompare(b[dateField] ?? ''))) {
    const d = row[dateField] || '(no date)';
    const bucket = groups.get(d);
    if (bucket) bucket.push(row);
    else groups.set(d, [row]);
  }
  return (
    <div className={styles.scroll} data-testid="smart-table-calendar">
      {[...groups.entries()].map(([d, rs]) => (
        <div key={d} className={styles.calGroup}>
          <div className={styles.calDate}>{d}</div>
          {rs.map((row, i) => (
            <div key={i} className={styles.calItem}>
              {titleKey ? row[titleKey] || '—' : '—'}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

/** Pivot-style summary: group field → Count + Σ per number column. */
export const SummaryView = ({
  rows,
  schema,
  allSchema,
  groupBy,
}: {
  rows: Row[];
  schema: ColumnSpec[];
  allSchema: ColumnSpec[];
  groupBy: string | null;
}): ReactElement => {
  const groupField = groupBy ?? schema.find((c) => c.type === 'select' || c.type === 'checkbox')?.key;
  if (!groupField) {
    return <div className={styles.kanbanEmpty}>Group by a field (or add a select column) to summarize.</div>;
  }
  const numCols = schema.filter((c) => baseCellType(c.type) === 'number');
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const g = row[groupField] ?? '';
    const bucket = groups.get(g);
    if (bucket) bucket.push(row);
    else groups.set(g, [row]);
  }
  const sumCol = (rs: Row[], key: string): number => rs.reduce((a, r) => a + (Number(r[key]) || 0), 0);
  const groupLabel = allSchema.find((c) => c.key === groupField)?.label ?? groupField;
  return (
    <div className={styles.scroll} data-testid="smart-table-summary">
      <table className={styles.summaryTable}>
        <thead>
          <tr>
            <th>{groupLabel}</th>
            <th>Count</th>
            {numCols.map((c) => (
              <th key={c.key}>{c.label} Σ</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([g, rs]) => (
            <tr key={g}>
              <td>{g || '—'}</td>
              <td>{rs.length}</td>
              {numCols.map((c) => (
                <td key={c.key}>{sumCol(rs, c.key).toLocaleString()}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
