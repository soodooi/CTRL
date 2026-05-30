// StatusBar — top status zone.
//
// Layout (bao 2026-05-30 companion mode):
//   [KRN ●] [ENGINE: <brain>] [MCP: N] [VAULT: N] ... [v0.1.x ●] [×]
//
// The clock got replaced by a clickable version pill — in companion mode
// the previous bottom-left VersionPill is hidden by the @media collapse,
// so users need a visible upgrade affordance somewhere always-on. The
// status bar's right cluster carries it now.

import { useCallback, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Led, type LedTone } from './primitives';
import { useKernelStatus } from '../hooks/useKernelStatus';
import { APP_VERSION, useUpdateStatus } from '../lib/app-meta';
import { invoke } from '../lib/bridge';
import styles from './StatusBar.module.css';

interface StatusChipProps {
  label: string;
  value: string | number;
  title?: string;
  onClick?: () => void;
}
const StatusChip = ({ label, value, title, onClick }: StatusChipProps): ReactElement => {
  const body = (
    <>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipValue}>{value}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`${styles.chip} ${styles.chipButton}`}
        title={title}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }
  return (
    <span className={styles.chip} title={title}>
      {body}
    </span>
  );
};

export const StatusBar = (): ReactElement => {
  const navigate = useNavigate();
  const status = useKernelStatus();
  const update = useUpdateStatus();

  const kernelReachable = status !== null;
  const krnTone: LedTone = !kernelReachable
    ? 'offline'
    : status.overall === 'ok'
      ? 'nominal'
      : 'caution';

  const warning = status?.warnings[0] ?? null;
  const onKrnClick = warning ? (): void => void navigate({ to: '/settings' }) : undefined;
  const krnTitle = warning ? `${warning} · click to open Settings` : `KRN: ${krnTone}`;

  const engine = status?.active_brain ?? '—';
  const mcpCount = status?.mcp_servers_installed ?? null;
  const vaultCount = status?.vault_files ?? null;

  const handleHide = useCallback((): void => {
    void invoke<void>('hide_window').catch(() => {
      /* browser PWA: nothing to hide */
    });
  }, []);

  const versionLabel = update.installing
    ? 'Updating…'
    : update.checking
      ? 'Checking…'
      : `v${APP_VERSION}`;
  const versionTitle = update.installing
    ? 'Installing…'
    : update.checking
      ? 'Checking…'
      : update.available
        ? `Click to install v${update.latestVersion ?? ''} & restart`
        : `CTRL v${APP_VERSION} · click to check`;

  return (
    <header
      className={styles.bar}
      aria-label="Cockpit status bar"
      data-tauri-drag-region="deep"
    >
      <div className={styles.statusZone} aria-label="System status">
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
        <StatusChip
          label="ENGINE"
          value={engine}
          title={`Active brain: ${engine}`}
          onClick={() => void navigate({ to: '/settings/brain' })}
        />
        <StatusChip
          label="MCP"
          value={mcpCount ?? '—'}
          title="MCP servers installed"
        />
        <StatusChip
          label="VAULT"
          value={vaultCount ?? '—'}
          title="Vault markdown files"
        />
      </div>

      <div className={styles.spacer} aria-hidden="true" />

      <div className={styles.right}>
        <button
          type="button"
          className={`${styles.versionChip} ${styles.chipButton}`}
          title={versionTitle}
          onClick={() => void update.checkAndInstall()}
          disabled={update.checking || update.installing}
        >
          <span className={styles.chipValue}>{versionLabel}</span>
          {update.available && (
            <span className={styles.updateDot} aria-label="Update available" role="status" />
          )}
        </button>
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
