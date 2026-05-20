// useWallClock — single source for wall-clock-based components.
//
// Three call sites previously hand-rolled the same setTimeout → setInterval
// pattern (ClockStrip, StatusBar, and pre-merge workspace HH:MM:SS variant
// that has different precision). Centralised here so the alignment math
// (round to the next interval boundary so multiple shell instances tick
// together) and the cleanup contract live in one place.

import { useEffect, useState } from 'react';

/**
 * Returns the current Date and re-renders the caller every `intervalMs`.
 * The first tick is aligned to the wall-clock boundary so independent
 * consumers (different routes / shell instances) update in lock-step.
 *
 * Default 60_000ms = 1 minute, matching HH:MM display granularity. Sub-
 * minute callers can pass a smaller interval, but be aware that the
 * formatted output may not change every tick — gate downstream renders
 * with `useMemo(() => formatX(now), [now])` if churn matters.
 */
export const useWallClock = (intervalMs = 60_000): Date => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const tick = (): void => setNow(new Date());
    const offset = intervalMs - (Date.now() % intervalMs);
    let intervalId: number | undefined;
    const initialId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, intervalMs);
    }, offset);
    return () => {
      window.clearTimeout(initialId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [intervalMs]);

  return now;
};

/** Two-digit zero-padded HH:MM. */
export const formatHHMM = (d: Date): string => {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};
