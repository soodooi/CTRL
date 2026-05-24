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

  // Two readers:
  //   • readCached — mount + auto-poll. Reads the Rust-side cache that
  //     ShellLifecycle::boot prewarms at app start. Instant (no network).
  //   • forceRecheck — user-clicked "↑ Check" / "↑ Retry" / "↑ Up to date"
  //     buttons. Bypasses cache, hits the network, updates the cache.
  // Per bao 2026-05-23 — first PWA mount renders the right pill without
  // a 1-3s "checking…" gap.
  const applyResult = useCallback((r: UpdateCheckResult) => {
    if (r.kind === 'available' && r.available_version) {
      setUpgrade({ kind: 'available', version: r.available_version });
    } else if (r.kind === 'up_to_date') {
      setUpgrade({ kind: 'up_to_date' });
    } else {
      setUpgrade({ kind: 'unknown' });
    }
  }, []);

  const readCached = useCallback(() => {
    invoke<UpdateCheckResult>('check_for_updates')
      .then(applyResult)
      .catch(() => setUpgrade({ kind: 'unknown' }));
  }, [applyResult]);

  const forceRecheck = useCallback(() => {
    invoke<UpdateCheckResult>('force_check_for_updates')
      .then(applyResult)
      .catch(() => setUpgrade({ kind: 'unknown' }));
  }, [applyResult]);

  useEffect(() => {
    readCached();
    const timer = window.setInterval(readCached, UPDATE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [readCached]);

  const handleHide = useCallback(() => {
    invoke<void>('hide_window').catch(() => {
      // PWA-only mode (no Tauri bridge): silent no-op.
    });
  }, []);

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
        {/* Upgrade button — always visible to the RIGHT of the version
            pill per bao 2026-05-23 ('升级按钮放在版本号右侧').
            State drives label + tone:
              - available: green pulsing — one-click install
              - installing: blue, disabled, shows progress
              - up_to_date: muted — click force-rechecks
              - unknown: muted, hidden until first check completes
              - error: red, click retries */}
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
          <span
            className={styles.upgradeInstalling}
            aria-live="polite"
            title="Installing the new build, CTRL will restart automatically"
          >
            Installing…
          </span>
        )}
        {upgrade.kind === 'up_to_date' && (
          <button
            type="button"
            className={styles.upgradeIdle}
            onClick={forceRecheck}
            title="You're on the latest build · click to re-check"
            aria-label="Re-check for updates"
          >
            ↑ Up to date
          </button>
        )}
        {upgrade.kind === 'unknown' && (
          <button
            type="button"
            className={styles.upgradeIdle}
            onClick={forceRecheck}
            title="Check for a newer build"
            aria-label="Check for updates"
          >
            ↑ Check
          </button>
        )}
        {upgrade.kind === 'error' && (
          <button
            type="button"
            className={styles.upgradeError}
            onClick={forceRecheck}
            title={`${upgrade.message} · click to retry`}
            aria-label="Update failed, click to retry"
          >
            ↑ Retry
          </button>
        )}
        <time className={styles.time} dateTime={now.toISOString()}>
          {formatHHMM(now)}
        </time>
        <span className={styles.uptime}>
          UPTIME {showUptime ? formatUptime(uptimeMs) : '—'}
        </span>
        {/* Hide button — click-fallback for Ctrl hotkey per bao 2026-05-23
            ('为了不至于隐藏不了 你在右上角先放一个hide按钮吧'). */}
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
