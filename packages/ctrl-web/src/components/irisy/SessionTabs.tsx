// SessionTabs — the Kiro-style session tab bar for Irisy's chat surface.
//
// (ADR-003 frontend §8.6 v36; ADR-005 irisy §8.7 v32 — Session module of the
// Kiro-parity redesign; the product requirement includes full session tabs).
// Renders one tab per
// `IrisySession` (irisy-sessions.ts) plus a trailing "+" to start a new one.
// Deliberately CTRL's own visual language (existing chip/pill chrome, not a
// pixel copy of Kiro's dark IDE panel) — the redesign borrows the STRUCTURE
// (tabs across the top, closable, a "+" to add) not the skin.
//
// Scope: tab bar chrome only. It has no opinion on what a session's messages
// look like — that stays IrisyChat's job.

import { useState, type JSX, type KeyboardEvent } from 'react';
import {
  useIrisySessionsStore,
  type IrisySession,
} from '@/lib/irisy-sessions';
import styles from './SessionTabs.module.css';

interface SessionTabProps {
  session: IrisySession;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
}

function SessionTab({ session, active, onActivate, onClose, onRename }: SessionTabProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.label);

  const commitRename = (): void => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== session.label) onRename(draft);
    else setDraft(session.label);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(session.label);
      setEditing(false);
    }
  };

  return (
    <div
      className={`${styles.tab} ${active ? styles.tabActive : ''}`}
      role="tab"
      aria-selected={active}
      onClick={onActivate}
      onDoubleClick={() => setEditing(true)}
      title={session.label}
    >
      {editing ? (
        <input
          className={styles.renameInput}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={onKeyDown}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className={styles.tabLabel}>{session.label}</span>
      )}
      <button
        type="button"
        className={styles.closeBtn}
        aria-label={`Close ${session.label}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}

export function SessionTabs(): JSX.Element | null {
  const sessions = useIrisySessionsStore((s) => s.sessions);
  const activeSessionId = useIrisySessionsStore((s) => s.activeSessionId);
  const activateSession = useIrisySessionsStore((s) => s.activateSession);
  const closeSession = useIrisySessionsStore((s) => s.closeSession);
  const renameSession = useIrisySessionsStore((s) => s.renameSession);
  const createSession = useIrisySessionsStore((s) => s.createSession);

  // A single session with nothing to switch between is visual noise — hide
  // the bar entirely until a second session exists, matching how most
  // tabbed surfaces (including CTRL's own WorkspaceInstance switcher) only
  // show chrome once there's a real choice. The "+" button below still
  // needs A tab bar to live in, so this only suppresses when sessions is
  // empty (nothing exists yet) or has exactly one untouched default.
  if (sessions.length === 0) return null;

  return (
    <div className={styles.bar} role="tablist" aria-label="Irisy sessions">
      <div className={styles.tabScroller}>
        {sessions.map((session) => (
          <SessionTab
            key={session.id}
            session={session}
            active={session.id === activeSessionId}
            onActivate={() => activateSession(session.id)}
            onClose={() => closeSession(session.id)}
            onRename={(label) => renameSession(session.id, label)}
          />
        ))}
      </div>
      <button
        type="button"
        className={styles.newTabBtn}
        aria-label="New session"
        title="New session"
        onClick={() => createSession()}
      >
        +
      </button>
    </div>
  );
}
