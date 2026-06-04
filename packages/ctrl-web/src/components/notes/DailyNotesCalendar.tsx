// DailyNotesCalendar — monthly calendar grid showing which days have
// a daily note.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-02 — kairo feature
// parity batch.)
//
// Resolves the daily-note path template from `vault/.ctrl/daily-notes.yaml`
// (loadDailyNotesConfig). For each visible day, checks whether the
// rendered path exists in the current `vault_list` snapshot. Click
// a populated day → opens the note. Click an empty day → creates the
// daily note (with the template substitution NotesApp already uses).

import {
  useCallback,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultList, vaultRead, vaultWrite } from '@/lib/kernel';
import {
  loadDailyNotesConfig,
  renderDailyNotePath,
} from '@/lib/vault-conventions';
import styles from './Notes.module.css';

interface DailyNotesCalendarProps {
  onSelect: (path: string) => void;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const renderTemplate = (raw: string, date: Date): string => {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return raw.replace(/\{\{date\}\}/g, `${yyyy}-${mm}-${dd}`);
};

export const DailyNotesCalendar = ({
  onSelect,
}: DailyNotesCalendarProps): ReactElement => {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const { data: cfg } = useQuery({
    queryKey: ['vault-conventions-daily'],
    queryFn: loadDailyNotesConfig,
    staleTime: 60_000,
  });

  const { data: allPaths = [], refetch } = useQuery({
    queryKey: ['vault-list'],
    queryFn: () => vaultList(),
    staleTime: 5_000,
  });

  const pathSet = useMemo(() => new Set(allPaths), [allPaths]);

  const monthLabel = useMemo(
    () =>
      cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    [cursor],
  );

  // Build a 6-row grid (42 cells) starting on Monday of the first
  // week that contains the 1st of the month.
  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const firstDay = (first.getDay() + 6) % 7; // 0 = Monday
    const start = new Date(year, month, 1 - firstDay);
    const out: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return out;
  }, [cursor]);

  const pathFor = useCallback(
    (date: Date): string | null => {
      if (!cfg) return null;
      return renderDailyNotePath(cfg.pathTemplate, date);
    },
    [cfg],
  );

  const handleClick = useCallback(
    async (date: Date) => {
      if (!cfg) return;
      const path = pathFor(date);
      if (!path) return;
      const exists = pathSet.has(path);
      if (exists) {
        onSelect(path);
        return;
      }
      try {
        let body = '';
        try {
          const tpl = await vaultRead(cfg.template);
          const tplBody = typeof tpl.body === 'string' ? tpl.body : '';
          body = renderTemplate(tplBody, date);
        } catch {
          body = '';
        }
        await vaultWrite({
          path,
          content: body,
          frontmatter: cfg.frontmatterDefault,
        });
        await refetch();
        onSelect(path);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('daily note create failed', err);
      }
    },
    [cfg, pathFor, pathSet, refetch, onSelect],
  );

  const today = new Date();
  const isSameMonth = (d: Date): boolean =>
    d.getMonth() === cursor.getMonth() && d.getFullYear() === cursor.getFullYear();
  const isToday = (d: Date): boolean =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  return (
    <section className={styles.calendarView} aria-label="Daily notes calendar">
      <header className={styles.calendarHeader}>
        <button
          type="button"
          className={styles.calendarNav}
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <h2 className={styles.calendarTitle}>{monthLabel}</h2>
        <button
          type="button"
          className={styles.calendarNav}
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          aria-label="Next month"
        >
          ›
        </button>
        <button
          type="button"
          className={styles.calendarToday}
          onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
          title="Jump to current month"
        >
          Today
        </button>
      </header>
      <div className={styles.calendarGrid}>
        {DAYS.map((d) => (
          <div key={d} className={styles.calendarDayLabel}>
            {d}
          </div>
        ))}
        {cells.map((date) => {
          const path = pathFor(date);
          const hasNote = path ? pathSet.has(path) : false;
          return (
            <button
              type="button"
              key={date.toISOString()}
              className={styles.calendarCell}
              data-other-month={!isSameMonth(date) || undefined}
              data-today={isToday(date) || undefined}
              data-has-note={hasNote || undefined}
              onClick={() => void handleClick(date)}
              title={path ?? undefined}
            >
              <span className={styles.calendarDayNum}>{date.getDate()}</span>
              {hasNote ? <span className={styles.calendarDot} aria-hidden /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
};
