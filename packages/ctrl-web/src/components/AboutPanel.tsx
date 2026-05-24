// AboutPanel — version + changelog + "Check for Updates" surface for
// the cockpit Settings page. Per bao 2026-05-23: "你有版本号还不够，要规范
// 要有升级按钮 + 升级记录".
//
// Registered in MANIFEST_REGISTRY as `AboutPanel`. Settings JSON layout
// drops it in like any other manifest node — no React import in the
// settings layout, just `{ component: 'AboutPanel' }`.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { invoke } from '@/lib/bridge';
import { Button } from './primitives';
import styles from './AboutPanel.module.css';

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

interface InstallProgressEvent {
  downloaded: number;
  total: number;
  version: string;
}

type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; result: UpdateCheckResult }
  | { kind: 'installing'; version: string; downloaded: number; total: number }
  | { kind: 'installed'; version: string }
  | { kind: 'install_error'; message: string };

const formatBuildTime = (iso: string): string => {
  if (iso === 'unknown') return 'unknown';
  // RFC-3339 → "2026-05-23 10:06 UTC". Trims the seconds + Z, keeps it
  // legible without a date-fns dep.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d} ${h}:${mi} UTC`;
};

export const AboutPanel = (): ReactElement => {
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [changelog, setChangelog] = useState<string | null>(null);
  const [changelogErr, setChangelogErr] = useState<string | null>(null);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    invoke<AppMeta>('app_meta')
      .then((m) => {
        if (!cancelled) setMeta(m);
      })
      .catch((e: unknown) => {
        if (!cancelled) setMetaErr(messageOf(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckUpdates = useCallback(() => {
    setUpdatePhase({ kind: 'checking' });
    void (async () => {
      try {
        const result = await invoke<UpdateCheckResult>('check_for_updates');
        setUpdatePhase({ kind: 'result', result });
      } catch (e) {
        setUpdatePhase({
          kind: 'result',
          result: {
            kind: 'error',
            available_version: null,
            message: messageOf(e),
          },
        });
      }
    })();
  }, []);

  // Auto-check on mount. Surfaces "Update available" without the user
  // having to click — the cockpit shows it immediately.
  useEffect(() => {
    if (updatePhase.kind !== 'idle') return;
    void (async () => {
      try {
        const result = await invoke<UpdateCheckResult>('check_for_updates');
        setUpdatePhase({ kind: 'result', result });
      } catch {
        /* silent — manual button still works */
      }
    })();
    // intentionally one-shot; subsequent checks are explicit via handleCheckUpdates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInstallUpdate = useCallback(() => {
    if (updatePhase.kind !== 'result' || updatePhase.result.kind !== 'available') return;
    const version = updatePhase.result.available_version ?? 'next';
    setUpdatePhase({ kind: 'installing', version, downloaded: 0, total: 0 });

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const off = await listen<InstallProgressEvent>('update-install-progress', (event) => {
          setUpdatePhase((prev) =>
            prev.kind === 'installing'
              ? {
                  kind: 'installing',
                  version: event.payload.version,
                  downloaded: event.payload.downloaded,
                  total: event.payload.total,
                }
              : prev,
          );
        });
        try {
          const outcome = await invoke<InstallOutcome>('install_update');
          if (outcome.kind === 'installed') {
            setUpdatePhase({ kind: 'installed', version });
            // The kernel will restart the process; this branch is mostly a
            // visual hold for the half-second between download-complete
            // and the WebView being yanked.
          } else if (outcome.kind === 'no_update') {
            setUpdatePhase({
              kind: 'result',
              result: {
                kind: 'up_to_date',
                available_version: null,
                message: outcome.message,
              },
            });
          } else {
            setUpdatePhase({ kind: 'install_error', message: outcome.message });
          }
        } finally {
          off();
        }
      } catch (e) {
        setUpdatePhase({ kind: 'install_error', message: messageOf(e) });
      }
    })();
  }, [updatePhase]);

  const handleOpenChangelog = useCallback(() => {
    setChangelogOpen(true);
    if (changelog !== null) return; // already loaded
    void (async () => {
      try {
        const md = await invoke<string>('app_changelog');
        setChangelog(md);
      } catch (e) {
        setChangelogErr(messageOf(e));
      }
    })();
  }, [changelog]);

  return (
    <div className={styles.card}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>About</h2>
        {meta && (
          <span className={styles.versionBadge} title={`Built ${formatBuildTime(meta.built_at)} from ${meta.sha}`}>
            v{meta.version}
            <span className={styles.versionSha}>+{meta.sha}</span>
          </span>
        )}
      </div>

      {metaErr && <p className={styles.errorLine}>Build metadata unavailable: {metaErr}</p>}

      {meta && (
        <dl className={styles.metaList}>
          <dt>Version</dt>
          <dd>{meta.version}</dd>
          <dt>Build SHA</dt>
          <dd className={styles.mono}>{meta.sha}</dd>
          <dt>Built at</dt>
          <dd className={styles.mono}>{formatBuildTime(meta.built_at)}</dd>
        </dl>
      )}

      <div className={styles.actions}>
        <Button
          onClick={handleCheckUpdates}
          disabled={
            updatePhase.kind === 'checking' || updatePhase.kind === 'installing'
          }
        >
          {updatePhase.kind === 'checking' ? 'Checking…' : 'Check for Updates'}
        </Button>
        {updatePhase.kind === 'result' &&
          updatePhase.result.kind === 'available' && (
            <Button onClick={handleInstallUpdate} disabled={false}>
              Install Now →
            </Button>
          )}
        <Button onClick={handleOpenChangelog}>View Changelog</Button>
      </div>

      {updatePhase.kind === 'result' && (
        <div className={styles.statusBox} data-kind={updatePhase.result.kind}>
          <strong>
            {updatePhase.result.kind === 'available' && 'Update available'}
            {updatePhase.result.kind === 'up_to_date' && 'Up to date'}
            {updatePhase.result.kind === 'no_endpoint' && 'Auto-update not configured'}
            {updatePhase.result.kind === 'error' && 'Check failed'}
          </strong>
          <p>{updatePhase.result.message}</p>
        </div>
      )}

      {updatePhase.kind === 'installing' && (
        <div className={styles.statusBox} data-kind="installing">
          <strong>Installing v{updatePhase.version}…</strong>
          <p>
            {updatePhase.total > 0
              ? `Downloaded ${formatBytes(updatePhase.downloaded)} / ${formatBytes(updatePhase.total)} (${Math.round(
                  (updatePhase.downloaded / updatePhase.total) * 100,
                )}%)`
              : `Downloaded ${formatBytes(updatePhase.downloaded)}…`}
          </p>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{
                width:
                  updatePhase.total > 0
                    ? `${Math.round((updatePhase.downloaded / updatePhase.total) * 100)}%`
                    : '15%',
              }}
            />
          </div>
        </div>
      )}

      {updatePhase.kind === 'installed' && (
        <div className={styles.statusBox} data-kind="installed">
          <strong>Installed v{updatePhase.version}</strong>
          <p>Restarting CTRL in a moment…</p>
        </div>
      )}

      {updatePhase.kind === 'install_error' && (
        <div className={styles.statusBox} data-kind="error">
          <strong>Install failed</strong>
          <p>{updatePhase.message}</p>
        </div>
      )}

      {changelogOpen && (
        <div
          className={styles.changelogModal}
          role="dialog"
          aria-modal="true"
          aria-label="Changelog"
          onClick={(e) => {
            // Click on backdrop (not content) closes the modal.
            if (e.target === e.currentTarget) setChangelogOpen(false);
          }}
        >
          <div className={styles.changelogPanel}>
            <header className={styles.changelogHeader}>
              <h3>Changelog</h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setChangelogOpen(false)}
                aria-label="Close changelog"
              >
                ×
              </button>
            </header>
            <div className={styles.changelogBody}>
              {changelogErr && <p className={styles.errorLine}>{changelogErr}</p>}
              {!changelogErr && changelog === null && <p>Loading…</p>}
              {!changelogErr && changelog !== null && (
                // Render markdown as plain pre-formatted text. ManifestRenderer
                // doesn't ship a markdown component yet; raw <pre> is honest +
                // doesn't pull a heavy dep for what's already structured text.
                <pre className={styles.markdownText}>{changelog}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function messageOf(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
