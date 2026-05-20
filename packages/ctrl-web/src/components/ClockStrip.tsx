// ClockStrip — persistent time chrome at the top of the Pool page.
// Per H-2026-05-13-001 Step 11 (bao request 2026-05-13).
//
// Visual: large mono HH:MM + small day-of-week + date below.
// Shares the wall-clock tick with StatusBar via useWallClock so multiple
// instances stay in lock-step.

import type { ReactElement } from 'react';
import { useWallClock, formatHHMM } from '../hooks/useWallClock';
import styles from './ClockStrip.module.css';

const fmtDate = (d: Date): string => {
  const weekday = d.toLocaleDateString('zh-CN', { weekday: 'long' });
  const md = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  return `${weekday} · ${md}`;
};

export const ClockStrip = (): ReactElement => {
  const now = useWallClock();
  return (
    <header className={styles.strip} aria-label="Current time">
      <time className={styles.time} dateTime={now.toISOString()}>
        {formatHHMM(now)}
      </time>
      <span className={styles.date}>{fmtDate(now)}</span>
    </header>
  );
};
