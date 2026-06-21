// smart-table-timeline — the read-only layout behind the Timeline / Gantt view
// (Feishu Bitable timeline parity). Pure + derived: place each row on a shared
// date axis from a start field (+ optional end field). No dependency, no stored
// state — plain-text stays truth; the timeline is just a lens over the rows.

export interface Bar {
  /** Index back into the input rows (for keys / click-through). */
  index: number;
  label: string;
  start: string;
  end: string;
  /** Position along the axis, 0..100 (% of the [min,max] domain). */
  leftPct: number;
  widthPct: number;
}

export interface TimelineLayout {
  bars: Bar[];
  minDate: string;
  maxDate: string;
}

const MS_PER_DAY = 86_400_000;
const dayOf = (s: string): number | null => {
  const t = Date.parse(s.trim());
  return Number.isNaN(t) ? null : Math.floor(t / MS_PER_DAY);
};
const iso = (day: number): string => new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

/** Lay rows out on a date axis. A row needs a parseable `startField`; `endField`
 *  (when given + valid + not before start) sets the bar length, else the bar is
 *  a single day. Rows without a valid start are dropped. The domain spans the
 *  earliest start to the latest end; a zero-width domain (all one day) renders
 *  full-width bars. */
export const timelineLayout = (
  rows: Array<Record<string, string>>,
  labelField: string,
  startField: string,
  endField?: string,
): TimelineLayout => {
  const raw = rows
    .map((row, index) => {
      const s = dayOf(row[startField] ?? '');
      if (s === null) return null;
      const e0 = endField ? dayOf(row[endField] ?? '') : null;
      const e = e0 !== null && e0 >= s ? e0 : s;
      return { index, label: row[labelField] ?? '', s, e };
    })
    .filter((b): b is { index: number; label: string; s: number; e: number } => b != null);

  if (raw.length === 0) return { bars: [], minDate: '', maxDate: '' };

  const min = Math.min(...raw.map((b) => b.s));
  const max = Math.max(...raw.map((b) => b.e));
  const span = max - min;

  const bars: Bar[] = raw.map((b) => ({
    index: b.index,
    label: b.label,
    start: iso(b.s),
    end: iso(b.e),
    leftPct: span === 0 ? 0 : ((b.s - min) / span) * 100,
    // +1 day so a single-day bar is visible; floor at 2% so it never vanishes.
    widthPct: span === 0 ? 100 : Math.max(2, ((b.e - b.s + 1) / span) * 100),
  }));

  return { bars, minDate: iso(min), maxDate: iso(max) };
};
