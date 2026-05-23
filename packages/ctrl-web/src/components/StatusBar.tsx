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

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Led, Logo, StatusPill, type LedTone } from './primitives';
import { useWallClock, formatHHMM } from '../hooks/useWallClock';
import { useKernelStatus } from '../hooks/useKernelStatus';
import { useRail } from './RightRail';
import { invoke } from '../lib/bridge';
import styles from './StatusBar.module.css';

interface AppMeta {
  version: string;
  sha: string;
  built_at: string;
}

interface UpdateCheckResult {
  kind: 'available' | 'up_to_date' | 'no_endpoint' | 'error';
  available_version: string | null;
  message: string;
}

interface InstallOutcome {
  kind: 'installed' | 'no_update' | 'error';
  message: string;
}

type UpgradeState =
  | { kind: 'unknown' }
  | { kind: 'up_to_date' }
  | { kind: 'available'; version: string }
  | { kind: 'installing' }
  | { kind: 'error'; message: string };

// Re-poll the update endpoint every 15 minutes so bao doesn't have to
// quit & relaunch to see a new release. Cheap — single HTTP request.
const UPDATE_POLL_MS = 15 * 60 * 1000;

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

  // Build version pill. Per bao 2026-05-23 — "你没有版本号 不知道是新的
  // 还是旧的". Reads compile-time metadata injected by build.rs so the
  // user can tell at a glance which build they're staring at.
  const [meta, setMeta] = useState<AppMeta | null>(null);
  useEffect(() => {
    let cancelled = false;
    invoke<AppMeta>('app_meta')
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch(() => {
        // PWA-only mode (no Tauri bridge): leave meta null; pill hides.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-poll for updates and surface an inline Upgrade button next to
  // the version pill when one's available. Per bao 2026-05-23 — "升级
  // 按钮应该放在首页版本旁边". One-click upgrade — no Settings detour.
  const [upgrade, setUpgrade] = useState<UpgradeState>({ kind: 'unknown' });

  const runCheck = useCallback(() => {
    invoke<UpdateCheckResult>('check_for_updates')
      .then((r) => {
        if (r.kind === 'available' && r.available_version) {
          setUpgrade({ kind: 'available', version: r.available_version });
        } else if (r.kind === 'up_to_date') {
          setUpgrade({ kind: 'up_to_date' });
        } else {
          // 'no_endpoint' / 'error' — leave 'unknown' so the button hides.
          setUpgrade({ kind: 'unknown' });
        }
      })
      .catch(() => setUpgrade({ kind: 'unknown' }));
  }, []);

  useEffect(() => {
    runCheck();
    const timer = window.setInterval(runCheck, UPDATE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [runCheck]);

  const handleUpgrade = useCallback(() => {
    if (upgrade.kind !== 'available') return;
    setUpgrade({ kind: 'installing' });
    invoke<InstallOutcome>('install_update')
      .then((outcome) => {
        if (outcome.kind === 'installed') {
          // Kernel will restart in ~500ms; UI hold prevents flicker.
          setUpgrade({ kind: 'installing' });
        } else if (outcome.kind === 'no_update') {
          setUpgrade({ kind: 'up_to_date' });
        } else {
          setUpgrade({ kind: 'error', message: outcome.message });
        }
      })
      .catch((e) =>
        setUpgrade({
          kind: 'error',
          message: e instanceof Error ? e.message : String(e),
        }),
      );
  }, [upgrade]);

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
    <header className={styles.bar} aria-label="Cockpit status bar">
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
        {meta && (
          <span
            className={styles.version}
            title={`Build ${meta.sha} · ${meta.built_at}`}
          >
            v{meta.version}
          </span>
        )}
        {upgrade.kind === 'available' && (
          <button
            type="button"
            className={styles.upgradeBtn}
            onClick={handleUpgrade}
            title={`Install v${upgrade.version}`}
            aria-label={`Upgrade to v${upgrade.version}`}
          >
            <span className={styles.upgradeDot} aria-hidden="true" />
            Upgrade
          </button>
        )}
        {upgrade.kind === 'installing' && (
          <span className={styles.upgradeInstalling} aria-live="polite">
            Installing…
          </span>
        )}
        {upgrade.kind === 'error' && (
          <span
            className={styles.upgradeError}
            title={upgrade.message}
            aria-live="polite"
          >
            Update failed
          </span>
        )}
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
