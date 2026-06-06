// SessionListModal — Pi conversation history browser.
//
// bao 2026-06-05 ("open all Pi capability — history"): Pi already
// persists every chat as a jsonl under ~/.pi/agent/sessions/<cwd-slug>/.
// This modal reads that directory via the `pi_sessions` Tauri command,
// renders a scrollable list, and lets the user:
//
//   - Resume a session: calls switchSession; IrisyChat re-renders by
//     pulling getMessages from Pi (caller responsibility).
//   - Fork a session: not implemented in this MVP; the fork() RPC
//     requires an entryId from inside the session — wire when we add
//     hover-on-message UI.
//   - Delete a session: removes the jsonl from disk.
//
// Style mirrors clearFloating chrome — small radius, muted border,
// no full-bleed shadow — so it feels native to the chat surface.

import { useCallback, useEffect, useState } from 'react';
import { listSessions, deleteSession, switchSession, type SessionMeta } from '../../lib/usePiRpc';
import styles from './SessionListModal.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fires after switchSession returns ok; parent should re-pull
   *  messages from Pi (`getMessages()`) and replace its UI state. */
  onResumed: (path: string) => void;
}

export function SessionListModal({ open, onClose, onResumed }: Props): JSX.Element | null {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const items = await listSessions();
      setSessions(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleResume = async (s: SessionMeta): Promise<void> => {
    setBusyPath(s.path);
    setError(null);
    try {
      const { cancelled } = await switchSession(s.path);
      if (cancelled) {
        setError('Pi extension cancelled the switch (likely a hook said no).');
        return;
      }
      onResumed(s.path);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPath(null);
    }
  };

  const handleDelete = async (s: SessionMeta): Promise<void> => {
    if (!window.confirm(`Delete session "${s.name ?? s.id.slice(0, 8)}"? This removes the jsonl from disk.`)) return;
    setBusyPath(s.path);
    setError(null);
    try {
      await deleteSession(s.path);
      setSessions((prev) => prev.filter((x) => x.path !== s.path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Conversation history"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2>Conversation history</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>
        <div className={styles.body}>
          {loading && <p className={styles.empty}>Loading…</p>}
          {error && <p className={styles.error}>{error}</p>}
          {!loading && !error && sessions.length === 0 && (
            <p className={styles.empty}>No prior sessions yet. Start a chat — Pi writes one jsonl per turn loop.</p>
          )}
          <ul className={styles.list}>
            {sessions.map((s) => (
              <li key={s.path} className={styles.item}>
                <button
                  type="button"
                  className={styles.itemBody}
                  onClick={() => void handleResume(s)}
                  disabled={busyPath != null}
                  title={s.path}
                >
                  <span className={styles.itemTitle}>{s.name ?? s.id.slice(0, 12)}</span>
                  <span className={styles.itemMeta}>
                    {new Date(s.createdAt).toLocaleString()} · {(s.sizeBytes / 1024).toFixed(1)} KB
                  </span>
                  {s.firstMessage && <span className={styles.itemPreview}>{s.firstMessage}</span>}
                </button>
                <button
                  type="button"
                  className={styles.itemDelete}
                  onClick={() => void handleDelete(s)}
                  disabled={busyPath != null}
                  aria-label={`Delete ${s.name ?? s.id}`}
                  title="Delete this session"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.refresh} onClick={() => void reload()} disabled={loading}>
            Refresh
          </button>
          <span className={styles.hint}>{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
        </footer>
      </div>
    </div>
  );
}
