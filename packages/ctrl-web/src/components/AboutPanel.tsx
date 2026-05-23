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

type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'result'; result: UpdateCheckResult };

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
        <Button onClick={handleCheckUpdates} disabled={updatePhase.kind === 'checking'}>
          {updatePhase.kind === 'checking' ? 'Checking…' : 'Check for Updates'}
        </Button>
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
