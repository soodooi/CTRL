// LifeCalendar — the LifeOS-style periodic-notes date-picker that sits atop the
// Notes workspace's left column (the Notes workspace is modeled on LifeOS, bao
// 2026-07-01). Signature LifeOS element: a month grid with Day/Week/Month/
// Quarter/Year period tabs, today highlighted, and a dot under any date that
// already has a periodic note. Clicking a date opens/creates that daily note.
//
// Pure UI + callbacks — data (which dates have notes) is passed in via
// `datesWithNotes`, resolved by the parent through the :17873 gate. Renders
// cleanly with none (browser-dev), so it is visually verifiable headless.

import { useMemo, useState, type ReactElement } from 'react';
import styles from './LifeCalendar.module.css';

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';

interface LifeCalendarProps {
  /** ISO dates (YYYY-MM-DD) that already have a note — rendered with a dot. */
  datesWithNotes?: Set<string>;
  /** Fired when the user clicks a day cell (opens/creates the daily note). */
  onPickDate?: (isoDate: string) => void;
  /** Fired when the active period tab changes. */
  onPickPeriod?: (p: Period) => void;
}

const PERIODS: Period[] = ['day', 'week', 'month', 'quarter', 'year'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function iso(y: number, m: number, d: number): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${y}-${p(m + 1)}-${p(d)}`;
}

export function LifeCalendar({
  datesWithNotes,
  onPickDate,
  onPickPeriod,
}: LifeCalendarProps): ReactElement {
  const today = new Date();
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const [period, setPeriod] = useState<Period>('day');
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [notesMode, setNotesMode] = useState<'periodic' | 'theme'>('periodic');

  // Month grid: 6 weeks x 7 days, Monday-first, with leading/trailing days from
  // the neighbouring months faded.
  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1);
    const lead = (first.getDay() + 6) % 7; // days before the 1st (Mon-first)
    const start = new Date(view.year, view.month, 1 - lead);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return {
        day: d.getDate(),
        iso: iso(d.getFullYear(), d.getMonth(), d.getDate()),
        outside: d.getMonth() !== view.month,
      };
    });
  }, [view]);

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });

  const shift = (months: number): void =>
    setView((v) => {
      const d = new Date(v.year, v.month + months, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const pickPeriod = (p: Period): void => {
    setPeriod(p);
    onPickPeriod?.(p);
  };

  return (
    <div className={styles.cal}>
      <div className={styles.modeRow}>
        <button
          type="button"
          className={`${styles.mode} ${notesMode === 'periodic' ? styles.modeOn : ''}`}
          onClick={() => setNotesMode('periodic')}
        >
          Periodic Notes
        </button>
        <button
          type="button"
          className={`${styles.mode} ${notesMode === 'theme' ? styles.modeOn : ''}`}
          onClick={() => setNotesMode('theme')}
        >
          Theme Notes
        </button>
      </div>

      <div className={styles.periods}>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.period} ${period === p ? styles.periodOn : ''}`}
            onClick={() => pickPeriod(p)}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.monthHead}>
        <button type="button" className={styles.nav} onClick={() => shift(-12)} aria-label="Prev year">«</button>
        <button type="button" className={styles.nav} onClick={() => shift(-1)} aria-label="Prev month">‹</button>
        <span className={styles.monthLabel}>{monthLabel}</span>
        <button type="button" className={styles.nav} onClick={() => shift(1)} aria-label="Next month">›</button>
        <button type="button" className={styles.nav} onClick={() => shift(12)} aria-label="Next year">»</button>
      </div>

      <div className={styles.grid}>
        {WEEKDAYS.map((w) => (
          <span key={w} className={styles.weekday}>
            {w}
          </span>
        ))}
        {cells.map((c) => {
          const isToday = c.iso === todayIso;
          const has = datesWithNotes?.has(c.iso);
          return (
            <button
              key={c.iso}
              type="button"
              className={`${styles.cell} ${c.outside ? styles.outside : ''} ${isToday ? styles.today : ''}`}
              onClick={() => onPickDate?.(c.iso)}
            >
              {c.day}
              {has && <span className={styles.dot} />}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.todayBtn}
        onClick={() => {
          setView({ year: today.getFullYear(), month: today.getMonth() });
          onPickDate?.(todayIso);
        }}
      >
        Today
      </button>
    </div>
  );
}
