// SmartTableTimeline — the Timeline / Gantt view (Feishu Bitable timeline
// parity). Read-only and fully derived: lay rows out on a shared date axis from
// a start field (+ optional end field). Self-contained local state for the
// label / start / end field pickers; nothing is persisted (plain-text is truth).

import { useMemo, useState, type ReactElement } from 'react';
import { baseCellType, type ColumnSpec } from '@/lib/smart-table';
import { sliceHue } from '@/lib/smart-table-chart';
import { timelineLayout } from '@/lib/smart-table-timeline';
import styles from './Viewer.module.css';

type Row = Record<string, string>;

export const TimelineView = ({
  rows,
  schema,
  onExpandRow,
}: {
  rows: Row[];
  schema: ColumnSpec[];
  onExpandRow?: (canonicalIdx: number) => void;
}): ReactElement => {
  const dateFields = schema.filter((c) => baseCellType(c.type) === 'date');
  const labelFields = schema.filter((c) => baseCellType(c.type) === 'text' || c.type === 'select');

  const [labelField, setLabelField] = useState(labelFields[0]?.key ?? schema[0]?.key ?? '');
  const [startField, setStartField] = useState(dateFields[0]?.key ?? '');
  const [endField, setEndField] = useState(dateFields[1]?.key ?? '');

  const layout = useMemo(
    () => (startField ? timelineLayout(rows, labelField, startField, endField || undefined) : null),
    [rows, labelField, startField, endField],
  );

  if (!startField) {
    return <div className={styles.kanbanEmpty}>Add a date field to use the timeline.</div>;
  }

  return (
    <div className={styles.timelineView} data-testid="smart-table-timeline">
      <div className={styles.chartBar}>
        <label className={styles.chartCtl}>
          label
          <select value={labelField} onChange={(e) => setLabelField(e.target.value)}>
            {labelFields.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.chartCtl}>
          start
          <select value={startField} onChange={(e) => setStartField(e.target.value)}>
            {dateFields.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.chartCtl}>
          end
          <select value={endField} onChange={(e) => setEndField(e.target.value)}>
            <option value="">(none)</option>
            {dateFields.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!layout || layout.bars.length === 0 ? (
        <div className={styles.kanbanEmpty}>No dated rows to place on the timeline.</div>
      ) : (
        <div className={styles.timelineWrap}>
          <div className={styles.timelineAxis}>
            <span>{layout.minDate}</span>
            <span>{layout.maxDate}</span>
          </div>
          {layout.bars.map((bar) => (
            <div key={bar.index} className={styles.timelineRow}>
              <span className={styles.timelineLabel} title={bar.label}>
                {bar.label || '—'}
              </span>
              <span className={styles.timelineTrack}>
                <button
                  type="button"
                  className={styles.timelineBar}
                  style={{
                    left: `${bar.leftPct}%`,
                    width: `${bar.widthPct}%`,
                    background: `hsl(${sliceHue(bar.label)} 60% 55%)`,
                  }}
                  title={`${bar.start} → ${bar.end}`}
                  onClick={() => onExpandRow?.(bar.index)}
                >
                  <span className={styles.timelineBarText}>
                    {bar.start}
                    {bar.end !== bar.start ? ` → ${bar.end}` : ''}
                  </span>
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
