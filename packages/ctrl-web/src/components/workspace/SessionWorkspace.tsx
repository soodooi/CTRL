// SessionWorkspace — T5 session-type workspace template.
//
// Layout = HistorySidebar (220px) + active session content (flex).
// Used by any mcp whose workspace.kind === 'session': Irisy default,
// Translate-with-history, Email-draft, ChatX-mcp, etc.
//
// Composed entirely from L1 primitives (HistorySidebar). The template
// itself only contributes the 2-col grid + content frame.

import type { ReactElement, ReactNode } from 'react';
import {
  HistorySidebar,
  type HistoryGroup,
  type HistoryItem,
} from '@/components/primitives';
import styles from './SessionWorkspace.module.css';

// Re-export for callers — keeps the public shape stable while the
// internal sidebar moves between primitives folders.
export type SessionHistoryItem = HistoryItem;
export type SessionHistoryGroup = HistoryGroup;

interface SessionWorkspaceProps {
  groups: ReadonlyArray<SessionHistoryGroup>;
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  newLabel?: string;
  emptyText?: string;
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
}: SessionWorkspaceProps): ReactElement => (
  <div className={styles.shell}>
    <HistorySidebar
      groups={groups}
      activeId={activeId}
      onSelect={onSelect}
      onNew={onNew}
      newLabel={newLabel}
      emptyText={emptyText}
      className={styles.history}
    />
    <div className={styles.main}>{children}</div>
  </div>
);
