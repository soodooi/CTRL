// SourceDataView — the product-grade data face of a feature pack whose manifest
// declares a §14 `record_source` (ADR-002 §14.12). Presentational only: it takes
// already-fetched fields + rows (the QueryResult the gate's source_query returns)
// and renders them as a clean records table — the pack's records ARE the view,
// not a wall of action buttons. Number-typed columns right-align + tabular-nums
// so a portfolio/ledger reads like one. Pure, so it unit-tests + visually
// verifies with mock data (the live fetch needs the real kernel + instance).

import { type ReactElement } from 'react';
import type { QueryFieldSpec } from '@/lib/kernel';
import styles from './SourceDataView.module.css';

export interface SourceData {
  fields: QueryFieldSpec[];
  rows: Array<Record<string, string>>;
  /** Pre-limit match count (rows may be capped by a limit). */
  matchCount?: number;
}

/** Types that read as numbers → right-aligned, tabular figures. Mirrors the
 *  kernel's CellType number family (currency/percent/rating all compare as
 *  numbers), so a value/allocation column lines up on the decimal. */
const NUMERIC = new Set(['number', 'currency', 'percent', 'rating', 'progress', 'duration']);

function isNumeric(type: string): boolean {
  return NUMERIC.has(type);
}

interface SourceDataViewProps {
  data: SourceData;
  /** Optional label above the table (e.g. the pack name). */
  title?: string;
}

export function SourceDataView({ data, title }: SourceDataViewProps): ReactElement {
  const { fields, rows } = data;

  if (rows.length === 0) {
    return (
      <div className={styles.wrap}>
        {title != null && <div className={styles.caption}>{title}</div>}
        <div className={styles.empty}>No records yet.</div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      {(title != null || data.matchCount != null) && (
        <div className={styles.caption}>
          {title}
          {data.matchCount != null && (
            <span className={styles.count}>
              {data.matchCount} {data.matchCount === 1 ? 'record' : 'records'}
            </span>
          )}
        </div>
      )}
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {fields.map((f) => (
                <th
                  key={f.key}
                  className={isNumeric(f.type) ? styles.num : undefined}
                  scope="col"
                >
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              // Row order is stable from the query; index is a safe key here.
              <tr key={i}>
                {fields.map((f) => {
                  const cell = row[f.key] ?? '';
                  return (
                    <td key={f.key} className={isNumeric(f.type) ? styles.num : undefined}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
