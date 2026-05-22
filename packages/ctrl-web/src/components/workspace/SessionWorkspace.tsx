// SessionWorkspace — T5 session-type workspace template.
//
// Layout = left history sidebar (220px) + main session content (flex).
// Used by any keycap whose workspace.kind === 'session': Irisy default,
// Translate-with-history, Email-draft, ChatX-keycap, etc.
//
// This is NOT a chat component — it's a layout shell. The active
// session's UI is the children (mascot + chat input for Irisy; or a
// translation pair, or an email composer). The template provides the
// history rail, "+ New" button, group labels, and tone dots.
//
// History data shape is intentionally generic (id + title + tone) so
// the same template fits chats, translations, drafts, recordings.

import type { ReactElement, ReactNode } from 'react';
import styles from './SessionWorkspace.module.css';

export type SessionTone = 'idle' | 'active' | 'success' | 'warning' | 'danger';

export interface SessionHistoryItem {
  id: string;
  title: string;
  tone?: SessionTone;
}

export interface SessionHistoryGroup {
  label: string;
  items: ReadonlyArray<SessionHistoryItem>;
}

interface SessionWorkspaceProps {
  /** Grouped history (e.g. Today / This week / May). Empty groups are
   *  filtered out so the sidebar doesn't show stray labels. */
  groups: ReadonlyArray<SessionHistoryGroup>;
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  /** Label on the new-session button. Default "New". */
  newLabel?: string;
  /** Shown when there are no history items. */
  emptyText?: string;
  /** The active session's UI — chat thread, translation pair, etc. */
  children: ReactNode;
}

export const SessionWorkspace = ({
  groups,
  activeId,
  onSelect,
  onNew,
  newLabel = 'New',
  emptyText = 'no past sessions',
  children,
}: SessionWorkspaceProps): ReactElement => {
  const visibleGroups = groups.filter((g) => g.items.length > 0);
  const isEmpty = visibleGroups.length === 0;

  return (
    <div className={styles.shell}>
      <aside className={styles.history} aria-label="Session history">
        {onNew && (
          <button
            type="button"
            className={styles.newButton}
            onClick={onNew}
          >
            <span className={styles.newButtonPlus}>+</span>
            {newLabel}
          </button>
        )}

        {isEmpty ? (
          <div className={styles.empty}>{emptyText}</div>
        ) : (
          visibleGroups.map((group) => (
            <div key={group.label} className={styles.group}>
              <span className={styles.groupLabel}>{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.item}
                  data-active={item.id === activeId}
                  onClick={() => onSelect?.(item.id)}
                  title={item.title}
                >
                  <span
                    className={styles.itemDot}
                    data-tone={item.tone ?? 'idle'}
                    aria-hidden="true"
                  />
                  {item.title}
                </button>
              ))}
            </div>
          ))
        )}
      </aside>

      <div className={styles.main}>{children}</div>
    </div>
  );
};
