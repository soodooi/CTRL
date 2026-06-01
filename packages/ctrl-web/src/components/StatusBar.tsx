// StatusBar — top status zone.
//
// Layout (bao 2026-05-30 校正: 顶部只 CTRL logo + KRN; ENGINE/MCP/VAULT
// chips 挪到对话框底部的 InfraBar — 见 components/InfraBar.tsx):
//   [LOGO] [KRN ●]                                       [v0.1.x ●] [×]
//
// The previous "everything goes top" layout cluttered the status bar and
// mixed system health (KRN) with substrate info (ENGINE/MCP/VAULT). The
// new split puts identity + kernel-reachability up top, substrate state
// at the bottom near where the user reads/types.

import { useCallback, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Led, Logo, type LedTone } from './primitives';
import { useKernelStatus } from '../hooks/useKernelStatus';
import { APP_VERSION, useUpdateStatus } from '../lib/app-meta';
import { invoke } from '../lib/bridge';
import styles from './StatusBar.module.css';

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
      {/* Guaranteed-drag strip at the very top — the chips below
          intercept clicks so the user has nothing else to drag from. */}
      <div className={styles.dragStrip} data-tauri-drag-region aria-hidden="true" />
      {/* Cockpit zone — pinned to grid cols 3-4 (L1 + Irisy) so the
          logo, KRN, version pill and × stay still when ▾ expands the
          window leftward into the Tab + L2 columns. */}
      <div className={styles.cockpitZone}>
        <div className={styles.statusZone} aria-label="System status">
          <span className={styles.logoSlot} aria-hidden="true">
            <Logo size="sm" />
          </span>
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
      </div>
    </header>
  );
};
