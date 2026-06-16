// SessionHistory — Irisy conversation history drawer.
//
// ADR-002 § provider v27 + vault/ctrl/strategy/0012 §8 (2026-06-16): Irisy runs
// on the hermes AGENT, so past conversations live in hermes's session store, not
// PWA memory. This drawer lists them (newest first) and loads one for read-only
// viewing. Restores the history entry the old Pi-RPC IrisyChat rail had, which
// the AmbientHome rewrite dropped (bao: history is a must-have for Irisy).

import { useEffect, useState, type ReactElement } from 'react';
import {
  listIrisySessions,
  getIrisySession,
  type IrisySessionSummary,
  type IrisySessionTurn,
} from '@/lib/kernel';
import styles from './SessionHistory.module.css';

interface SessionHistoryProps {
  open: boolean;
  onClose: () => void;
  onSelect: (turns: IrisySessionTurn[], title: string) => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function SessionHistory({ open, onClose, onSelect }: SessionHistoryProps): ReactElement | null {
  const [sessions, setSessions] = useState<IrisySessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    listIrisySessions()
      .then((s) => setSessions(s))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [open]);

  // Esc closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pick = async (s: IrisySessionSummary): Promise<void> => {
    setOpening(s.id);
    try {
      const turns = await getIrisySession(s.id);
      onSelect(turns, s.title);
    } catch (e) {
      setError(String(e));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <span className={styles.title}>History</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className={styles.body}>
          {loading && <p className={styles.muted}>Loading…</p>}
          {error && <p className={styles.error}>{error}</p>}
          {!loading && !error && sessions.length === 0 && (
            <p className={styles.muted}>No past conversations yet.</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={styles.row}
              onClick={() => void pick(s)}
              disabled={opening !== null}
            >
              <span className={styles.rowTitle}>{s.title || 'Untitled'}</span>
              {s.preview && s.preview !== s.title && (
                <span className={styles.rowPreview}>{s.preview}</span>
              )}
              <span className={styles.rowMeta}>
                {relativeTime(s.ended_at ?? s.started_at)} · {s.message_count} msg
                {opening === s.id ? ' · opening…' : ''}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
