// StatusBar — mobile status-bar borrowed for the PWA shell chrome.
//
// Layout left → right:
//   [Logo mark + "CTRL" wordmark · tap → /] [time HH:MM] [connection LED]
//
// Per H-2026-05-20-001 mobile UX learning checklist: this surface is
// inert by design (no actionable controls except the logo / home tap).
// Real status — keycap activity, network state — flows in via the
// `connection` prop when the kernel exposes a hook. Until then the prop
// is omitted by callers and the LED dot is not rendered (honest default
// vs. claiming 'connected' without evidence).

import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { Logo } from './primitives/Logo';
import { cx } from './primitives/cx';
import { useWallClock, formatHHMM } from '../hooks/useWallClock';
import styles from './StatusBar.module.css';

export type ConnectionState = 'connected' | 'connecting' | 'offline';

interface StatusBarProps {
  /** When omitted the LED is hidden. Set by the wiring layer that knows
      the real kernel WS health (TODO: align with useCellStream's
      StreamStatus enum when that hook is generalized). */
  connection?: ConnectionState;
}

// Exhaustive lookup — if ConnectionState gains a variant the literal
// must add the key or typecheck breaks. Cheaper than a switch + still
// the loud-fail safety the themis Record pattern wants.
const LED_CLASS: Record<ConnectionState, string> = {
  connected: styles.led_connected ?? '',
  connecting: styles.led_connecting ?? '',
  offline: styles.led_offline ?? '',
};

export const StatusBar = ({ connection }: StatusBarProps): ReactElement => {
  const now = useWallClock();
  return (
    <header className={styles.bar} aria-label="Status bar">
      {/* Logo is decorative inside this Link — the surrounding
          aria-label="CTRL home" already announces the destination.
          ariaLabel="" suppresses the second img alt announce. */}
      <Link to="/" className={styles.brand} aria-label="CTRL home">
        <Logo size="sm" ariaLabel="" />
        <span className={styles.wordmark}>CTRL</span>
      </Link>
      <time className={styles.time} dateTime={now.toISOString()}>
        {formatHHMM(now)}
      </time>
      {connection && (
        <span
          className={cx(styles.led, LED_CLASS[connection])}
          role="img"
          aria-label={`Kernel ${connection}`}
          title={`Kernel ${connection}`}
        />
      )}
    </header>
  );
};
