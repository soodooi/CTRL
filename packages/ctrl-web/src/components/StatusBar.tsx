// StatusBar — top instrument cluster of the cockpit shell.
//
// Layout left → right:
//   [logo · CTRL]   [KRN ● MESH ○ LLM ●]   [adapter · MCP · vault · IRISY]   [clock · UPTIME]
//
// Wired to kernel_status (Zeus PR #42) via useKernelStatus, polled every
// ~3s. PFD vocabulary: green=nominal, amber=caution, red=warning,
// gray=offline, dim-ring=unknown. The kernel is the source of truth —
// no mocks, no defaults. When the bridge isn't reachable we show
// "offline" / "unknown" honestly.
//
// MERGE NOTE for zeus (2026-05-24): bao 2026-05-24 explicitly removed
// the StatusBar version pill + "Up to date" pill added by Athena
// (release commit c09518f). The canonical version display lives in the
// right-rail footer (RightRail.tsx `.versionRow` + green update dot).
// When merging pwa-dev into the release branch, drop the version-pill
// JSX from this file — pwa-dev's StatusBar shape is the chosen one.

import { useCallback, type ReactElement } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Led, Logo, type LedTone } from './primitives';
import { useWallClock, formatHHMM } from '../hooks/useWallClock';
import { useKernelStatus } from '../hooks/useKernelStatus';
import { invoke } from '../lib/bridge';
import styles from './StatusBar.module.css';

interface InstrumentProps {
  label: string;
  tone: LedTone;
  title?: string;
  onClick?: () => void;
}
const Instrument = ({ label, tone, title, onClick }: InstrumentProps): ReactElement => {
  const content = (
    <>
      <Led tone={tone} size="sm" />
      <span className={styles.instrumentLabel}>{label}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`${styles.instrument} ${styles.instrumentButton}`}
        title={title ?? `${label}: ${tone}`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={styles.instrument} title={title ?? `${label}: ${tone}`}>
      {content}
    </span>
  );
};

const formatUptime = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h >= 1) return `${h}H ${String(m).padStart(2, '0')}M`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export const StatusBar = (): ReactElement => {
  const now = useWallClock();
  const navigate = useNavigate();
  const status = useKernelStatus();

  // Derive tones from the kernel envelope. The kernel itself is healthy
  // by definition when the IPC round-trips (we got an answer back), so
  // KRN tracks the envelope's `overall` field. LLM tracks adapter
  // presence. MESH stays "unknown" until the mesh primitives ship.
  const kernelReachable = status !== null;
  const krnTone: LedTone = !kernelReachable
    ? 'offline'
    : status.overall === 'ok'
      ? 'nominal'
      : 'caution';
  const llmTone: LedTone = !kernelReachable
    ? 'unknown'
    : status.primary_adapter
      ? 'nominal'
      : 'caution';
  const meshTone: LedTone = 'unknown';

  const warning = status?.warnings[0] ?? null;
  const uptimeMs = status?.uptime_ms ?? 0;
  const showUptime = kernelReachable && uptimeMs > 0;
  const adapter = status?.primary_adapter ?? null;

  // Degraded overall → clicking the KRN LED jumps to Settings so the
  // user can fix the configuration (typically "no LLM adapter").
  const onLedClick = warning ? (): void => void navigate({ to: '/settings' }) : undefined;
  const krnTitle = warning ? `${warning} · click to open Settings` : `KRN: ${krnTone}`;

  // Click fallback for when the Ctrl hotkey desyncs (AX revoked after
  // an upgrade that changed the bundle hash, CGEventTap permission
  // dropped, etc.). bao 2026-05-23: "so we don't end up unable to hide,
  // put a hide button in the top-right corner for now". PWA-only browser mode (no Tauri bridge) silently
  // no-ops since there's no native window to hide.
  const handleHide = useCallback((): void => {
    void invoke<void>('hide_window').catch(() => {
      /* browser PWA: nothing to hide */
    });
  }, []);

  return (
    <header
      className={styles.bar}
      aria-label="Cockpit status bar"
      // "deep" = the whole bar subtree is a drag handle, not just bare clicks
      // directly on the <header>. With the bare attribute Tauri only drags when
      // the click target IS the header element (drag.js: `el === composedPath[0]`),
      // but the bar is fully covered by child clusters, leaving almost no
      // draggable surface. Clickable children (brand link, LED/hide buttons)
      // still block drag and handle their own clicks.
      data-tauri-drag-region="deep"
    >
      <Link to="/" className={styles.brand} aria-label="CTRL home">
        <Logo size="sm" ariaLabel="" />
        <span className={styles.wordmark}>CTRL</span>
      </Link>

      <div className={styles.instruments} aria-label="System instruments">
        <Instrument label="KRN" tone={krnTone} title={krnTitle} onClick={onLedClick} />
        <Instrument label="MESH" tone={meshTone} />
        <Instrument
          label="LLM"
          tone={llmTone}
          title={adapter ? `LLM adapter: ${adapter}` : 'no LLM adapter'}
        />
      </div>

      <div className={styles.spacer} aria-hidden="true" />

      <div className={styles.right}>
        <time className={styles.time} dateTime={now.toISOString()}>
          {formatHHMM(now)}
        </time>
        <span className={styles.uptime}>
          UPTIME {showUptime ? formatUptime(uptimeMs) : '—'}
        </span>
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
