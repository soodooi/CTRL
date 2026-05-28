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

import type { ReactElement } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Led, Logo, StatusPill, type LedTone } from './primitives';
import { useWallClock, formatHHMM } from '../hooks/useWallClock';
import { useKernelStatus } from '../hooks/useKernelStatus';
import { useRail } from './RightRail';
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
  const { irisyState } = useRail();
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

  const adapter = status?.primary_adapter ?? null;
  const mcpCount = status?.mcp_servers_installed ?? null;
  const vaultCount = status?.vault_files ?? null;
  const warning = status?.warnings[0] ?? null;
  const uptimeMs = status?.uptime_ms ?? 0;
  const showUptime = kernelReachable && uptimeMs > 0;

  // Degraded overall → clicking the KRN LED jumps to Settings so the
  // user can fix the configuration (typically "no LLM adapter").
  const onLedClick = warning ? (): void => void navigate({ to: '/settings' }) : undefined;
  const krnTitle = warning ? `${warning} · click to open Settings` : `KRN: ${krnTone}`;

  return (
    <header
      className={styles.bar}
      aria-label="Cockpit status bar"
      data-tauri-drag-region
    >
      <Link to="/" className={styles.brand} aria-label="CTRL home">
        <Logo size="sm" ariaLabel="" />
        <span className={styles.wordmark}>CTRL</span>
      </Link>

      <div className={styles.instruments} aria-label="System instruments">
        <Instrument label="KRN" tone={krnTone} title={krnTitle} onClick={onLedClick} />
        <Instrument label="MESH" tone={meshTone} />
        <Instrument label="LLM" tone={llmTone} title={adapter ? `LLM: ${adapter}` : 'no LLM adapter'} />
      </div>

      <div className={styles.tape}>
        <span className={styles.tapeMeta}>ADAPTER</span>
        <span className={styles.tapeSlot}>
          {adapter ? (
            <StatusPill tone="info">{adapter}</StatusPill>
          ) : (
            <StatusPill tone="caution">none</StatusPill>
          )}
        </span>
        <span className={styles.tapeSep}>·</span>
        <span className={styles.tapeMeta}>MCP</span>
        <span className={styles.tapeValue}>{mcpCount ?? '—'}</span>
        <span className={styles.tapeSep}>·</span>
        <span className={styles.tapeMeta}>VAULT</span>
        <span className={styles.tapeValue}>{vaultCount ?? '—'}</span>
        <span className={styles.tapeSep}>·</span>
        <span className={styles.tapeMeta}>IRISY</span>
        <span className={styles.tapeValue}>{irisyState}</span>
      </div>

      <div className={styles.right}>
        <time className={styles.time} dateTime={now.toISOString()}>
          {formatHHMM(now)}
        </time>
        <span className={styles.uptime}>
          UPTIME {showUptime ? formatUptime(uptimeMs) : '—'}
        </span>
      </div>
    </header>
  );
};
