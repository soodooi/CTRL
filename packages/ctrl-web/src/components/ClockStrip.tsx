// ClockStrip — persistent time chrome at the top of the Pool page.
// Per H-2026-05-13-001 Step 11 (bao request 2026-05-13).
//
// Visual: large mono HH:MM + small day-of-week + date below.
// Rerender granularity: 30s. User can't perceive sub-30s drift on a clock display.

import { useEffect, useState } from 'react';
import styles from './ClockStrip.module.css';

const fmtTime = (d: Date): string => {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

const fmtDate = (d: Date): string => {
  const weekday = d.toLocaleDateString('zh-CN', { weekday: 'long' });
  const md = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  return `${weekday} · ${md}`;
};

export const ClockStrip = (): React.ReactElement => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const tick = (): void => setNow(new Date());
    // Round next interval to the 30s boundary so all clients tick together.
    const ms = 30_000 - (Date.now() % 30_000);
    const initial = window.setTimeout(() => {
      tick();
      const id = window.setInterval(tick, 30_000);
      return id;
    }, ms);
    return () => {
      window.clearTimeout(initial);
    };
  }, []);

  return (
    <header className={styles.strip} aria-label="Current time">
      <time className={styles.time} dateTime={now.toISOString()}>
        {fmtTime(now)}
      </time>
      <span className={styles.date}>{fmtDate(now)}</span>
    </header>
  );
};
