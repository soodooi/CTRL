// GitPanel — vault-side git status + commit + push + log view.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-03 — kairo Git
// parity batch.)
//
// Drives the new `git_*` Tauri commands (src-tauri/src/commands/git.rs)
// which shell out to the host `git` binary. When the vault isn't a
// git repo yet, the first action is an explicit init button. Commit
// reads a message from a textarea, stages every change with
// `git add -A`, runs `git commit -m <msg>`, then refreshes the status
// query so the ahead/behind/staged counts roll back to zero.

import {
  useCallback,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  gitCommitAll,
  gitInit,
  gitLog,
  gitPush,
  gitStatus,
} from '@/lib/kernel';
import styles from './Notes.module.css';

export const GitPanel = (): ReactElement => {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<null | 'init' | 'commit' | 'push'>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['vault-git-status'],
    queryFn: gitStatus,
    staleTime: 5_000,
  });
  const { data: log = [], refetch: refetchLog } = useQuery({
    queryKey: ['vault-git-log'],
    queryFn: gitLog,
    staleTime: 5_000,
    enabled: !!status?.initialised,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vault-git-status'] });
    queryClient.invalidateQueries({ queryKey: ['vault-git-log'] });
  }, [queryClient]);

  const handleInit = useCallback(async () => {
    setBusy('init');
    setError(null);
    try {
      const out = await gitInit();
      setInfo(out || 'Initialised empty git repository.');
      await refetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [refetchStatus]);

  const handleCommit = useCallback(async () => {
    if (!message.trim()) {
      setError('Commit message is required.');
      return;
    }
    setBusy('commit');
    setError(null);
    setInfo(null);
    try {
      const out = await gitCommitAll(message.trim());
      setInfo(out || 'Commit recorded.');
      setMessage('');
      refresh();
      await refetchLog();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [message, refresh, refetchLog]);

  const handlePush = useCallback(async () => {
    setBusy('push');
    setError(null);
    setInfo(null);
    try {
      const out = await gitPush();
      setInfo(out || 'Pushed.');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  if (!status) {
    return (
      <section className={styles.gitPanel} aria-label="Git">
        <p className={styles.muted}>Loading git status…</p>
      </section>
    );
  }

  if (!status.initialised) {
    return (
      <section className={styles.gitPanel} aria-label="Git">
        <header className={styles.gitHeader}>
          <h2 className={styles.gitTitle}>Git</h2>
        </header>
        <p className={styles.muted}>
          Vault is not a git repository yet. Initialising creates{' '}
          <code>~/Documents/CTRL/.git/</code>.
        </p>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void handleInit()}
          disabled={busy === 'init'}
        >
          {busy === 'init' ? 'Initialising…' : 'Initialise git'}
        </button>
        {error ? <p className={styles.gitError}>{error}</p> : null}
        {info ? <p className={styles.gitInfo}>{info}</p> : null}
      </section>
    );
  }

  const totalDirty = status.staged + status.modified + status.untracked;

  return (
    <section className={styles.gitPanel} aria-label="Git">
      <header className={styles.gitHeader}>
        <h2 className={styles.gitTitle}>Git</h2>
        <span className={styles.gitBranch}>{status.branch ?? '(detached)'}</span>
      </header>
      <div className={styles.gitStats}>
        <div className={styles.statCard} data-warn={totalDirty > 0 || undefined}>
          <span className={styles.statLabel}>Modified</span>
          <span className={styles.statValue}>{status.modified}</span>
        </div>
        <div className={styles.statCard} data-warn={status.staged > 0 || undefined}>
          <span className={styles.statLabel}>Staged</span>
          <span className={styles.statValue}>{status.staged}</span>
        </div>
        <div className={styles.statCard} data-warn={status.untracked > 0 || undefined}>
          <span className={styles.statLabel}>Untracked</span>
          <span className={styles.statValue}>{status.untracked}</span>
        </div>
        <div className={styles.statCard} data-warn={status.ahead > 0 || undefined}>
          <span className={styles.statLabel}>Ahead</span>
          <span className={styles.statValue}>{status.ahead}</span>
        </div>
        <div className={styles.statCard} data-warn={status.behind > 0 || undefined}>
          <span className={styles.statLabel}>Behind</span>
          <span className={styles.statValue}>{status.behind}</span>
        </div>
      </div>
      <section className={styles.healthGroup}>
        <h3 className={styles.healthGroupTitle}>Commit</h3>
        <textarea
          className={styles.gitMessage}
          placeholder="Commit message…"
          value={message}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
          rows={3}
        />
        <div className={styles.gitActions}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void handleCommit()}
            disabled={busy === 'commit' || totalDirty === 0}
          >
            {busy === 'commit' ? 'Committing…' : 'Stage + Commit'}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void handlePush()}
            disabled={busy === 'push' || status.ahead === 0}
            title={status.ahead === 0 ? 'Nothing to push' : 'Push to remote'}
          >
            {busy === 'push' ? 'Pushing…' : 'Push'}
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        </div>
        {error ? <p className={styles.gitError}>{error}</p> : null}
        {info ? <p className={styles.gitInfo}>{info}</p> : null}
      </section>
      <section className={styles.healthGroup}>
        <h3 className={styles.healthGroupTitle}>Recent commits</h3>
        {log.length === 0 ? (
          <p className={styles.muted}>No commits yet.</p>
        ) : (
          <ul className={styles.gitLog}>
            {log.map((entry) => (
              <li key={entry.sha} className={styles.gitLogItem}>
                <span className={styles.gitSha}>{entry.sha.slice(0, 7)}</span>
                <span className={styles.gitMsg}>{entry.message}</span>
                <span className={styles.gitMeta}>
                  {entry.author} · {entry.date.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};
