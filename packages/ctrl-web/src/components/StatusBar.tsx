// StatusBar — top instrument cluster of the cockpit shell.
//
// Layout left → right:
//   [logo · CTRL]   [KRN ● MESH ○ LLM ●]   [session count]   [clock · UPTIME]
//
// The middle "tape" is a tabular-monospace instrument readout in the
// spirit of an aviation PFD: green dot = nominal, amber = caution,
// red = error, gray = offline. Wired to real kernel state in Phase 1D;
// today the three LEDs render in their default ("unknown") state so
// the chrome doesn't lie about connectivity.

import { useState, type ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { Led, Logo, type LedTone } from './primitives';
import { useWallClock, formatHHMM } from '../hooks/useWallClock';
import { useRail } from './RightRail';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  /** Kernel WS bridge health. Falls back to "unknown" if omitted. */
  kernel?: LedTone;
  /** Mesh peer health (offline = 0 peers, nominal ≥ 1). */
  mesh?: LedTone;
  /** Default LLM provider availability. */
  llm?: LedTone;
  /** Active session count (Code Space envs + open chats). */
  sessions?: number;
}

interface InstrumentProps {
  label: string;
  tone: LedTone;
}
const Instrument = ({ label, tone }: InstrumentProps): ReactElement => (
  <span className={styles.instrument} title={`${label}: ${tone}`}>
    <Led tone={tone} size="sm" />
    <span className={styles.instrumentLabel}>{label}</span>
  </span>
);

const formatUptime = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}H ${String(m).padStart(2, '0')}M`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const StatusBar = ({
  kernel = 'unknown',
  mesh = 'unknown',
  llm = 'unknown',
  sessions,
}: StatusBarProps = {}): ReactElement => {
  const now = useWallClock();
  const [bootAt] = useState<number>(() => Date.now());
  const uptime = now.getTime() - bootAt;

  // Surface the Irisy state in a quiet badge so the chrome always shows
  // what the companion is doing, even when the workspace is on a route
  // that doesn't otherwise expose it.
  const { irisyState } = useRail();

  return (
    <header className={styles.bar} aria-label="Cockpit status bar">
      <Link to="/" className={styles.brand} aria-label="CTRL home">
        <Logo size="sm" ariaLabel="" />
        <span className={styles.wordmark}>CTRL</span>
      </Link>

      <div className={styles.instruments} aria-label="System instruments">
        <Instrument label="KRN" tone={kernel} />
        <Instrument label="MESH" tone={mesh} />
        <Instrument label="LLM" tone={llm} />
      </div>

      <div className={styles.tape}>
        <span className={styles.tapeMeta}>SESSIONS</span>
        <span className={styles.tapeValue}>
          {sessions === undefined ? '—' : String(sessions).padStart(2, '0')}
        </span>
        <span className={styles.tapeSep}>·</span>
        <span className={styles.tapeMeta}>IRISY</span>
        <span className={styles.tapeValue}>{irisyState}</span>
      </div>

      <div className={styles.right}>
        <time className={styles.time} dateTime={now.toISOString()}>
          {formatHHMM(now)}
        </time>
        <span className={styles.uptime}>UPTIME {formatUptime(uptime)}</span>
      </div>
    </header>
  );
};

