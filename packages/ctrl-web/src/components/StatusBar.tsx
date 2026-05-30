// StatusBar — slim top cluster of the cockpit shell.
//
// 2026-05-30 revision (bao): ENGINE / MCP / VAULT chips removed — they
// duplicated Irisy's own status header (which already shows Engine / Pi /
// MCP bridge). Single source of truth: Irisy chat header owns runtime
// state; this bar is just kernel-health LED + clock + hide.

import { useCallback, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Led, type LedTone } from './primitives';
import { useWallClock, formatHHMM } from '../hooks/useWallClock';
import { useKernelStatus } from '../hooks/useKernelStatus';
import { invoke } from '../lib/bridge';
import styles from './StatusBar.module.css';

export const StatusBar = (): ReactElement => {
  const now = useWallClock();
  const navigate = useNavigate();
  const status = useKernelStatus();

  const kernelReachable = status !== null;
  const krnTone: LedTone = !kernelReachable
    ? 'offline'
    : status.overall === 'ok'
      ? 'nominal'
      : 'caution';

  const warning = status?.warnings[0] ?? null;
  const onKrnClick = warning ? (): void => void navigate({ to: '/settings' }) : undefined;
  const krnTitle = warning ? `${warning} · click to open Settings` : `KRN: ${krnTone}`;

  const handleHide = useCallback((): void => {
    void invoke<void>('hide_window').catch(() => {
      /* browser PWA: nothing to hide */
    });
  }, []);

  return (
    <header
      className={styles.bar}
      aria-label="Cockpit status bar"
      data-tauri-drag-region="deep"
    >
      {onKrnClick ? (
        <button
          type="button"
          className={`${styles.krn} ${styles.chipButton}`}
          title={krnTitle}
          onClick={onKrnClick}
        >
          <Led tone={krnTone} size="sm" />
          <span className={styles.chipLabel}>KRN</span>
        </button>
      ) : (
        <span className={styles.krn} title={krnTitle}>
          <Led tone={krnTone} size="sm" />
          <span className={styles.chipLabel}>KRN</span>
        </span>
      )}

      <div className={styles.spacer} aria-hidden="true" />

      <div className={styles.right}>
        <time className={styles.time} dateTime={now.toISOString()}>
          {formatHHMM(now)}
        </time>
        <button
          type="button"
          className={styles.hideBtn}
          onClick={handleHide}
          title="Hide window (Ctrl tap also toggles)"
          aria-label="Hide window"
        >
          ×
        </button>
      </div>
    </header>
  );
};
