// HistorySidebar — vertical grouped list of past sessions/items with
// an optional "+ new" button at top. L1 navigation primitive.
//
// Drives the left rail of any session-type workspace (Irisy default,
// chat keycaps, Code Space env switcher when used in compact mode).
// Generic on item shape — each item carries id + title + optional
// tone dot (uses Led primitive for the dot indicator).

import type { ReactElement, ReactNode } from 'react';
import { Led, type LedTone } from './Led';
import styles from './HistorySidebar.module.css';

export interface HistoryItem {
  id: string;
  title: string;
  tone?: LedTone;
}

export interface HistoryGroup {
  label: string;
  items: ReadonlyArray<HistoryItem>;
}

export interface HistorySidebarProps {
  groups: ReadonlyArray<HistoryGroup>;
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  newLabel?: ReactNode;
  emptyText?: string;
  className?: string;
}

export const HistorySidebar = ({
  groups,
  activeId,
  onSelect,
  onNew,
  newLabel = 'New',
  emptyText = 'no items',
  className,
}: HistorySidebarProps): ReactElement => {
  const visible = groups.filter((g) => g.items.length > 0);
  const isEmpty = visible.length === 0;
  return (
    <aside
      className={[styles.sidebar, className ?? ''].filter(Boolean).join(' ')}
      aria-label="History"
    >
      {onNew && (
        <button type="button" className={styles.newButton} onClick={onNew}>
          <span className={styles.newPlus}>+</span>
          {newLabel}
        </button>
      )}
      {isEmpty ? (
        <div className={styles.empty}>{emptyText}</div>
      ) : (
        visible.map((group) => (
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
                <Led tone={item.tone ?? 'unknown'} size="sm" />
                {item.title}
              </button>
            ))}
          </div>
        ))
      )}
    </aside>
  );
};
