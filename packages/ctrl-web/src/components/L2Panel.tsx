// L2Panel — secondary navigation column. Default closed (width 0).
// Toggle from the expand/close button at the top of L1 (PrimaryRail).
//
// The active L1 item drives what L2 shows. Each L1 nav item can declare
// a label + content; if none is declared, L2 shows an empty placeholder.
// The expanded/collapsed flag is owned by RailContext (so the L1 toggle
// can write it and L2 can read it).

import type { ReactElement, ReactNode } from 'react';
import { useRail } from './PrimaryRail';
import styles from './L2Panel.module.css';

export interface L2ItemDescriptor {
  /** Label rendered at the top of L2 when this item is active. */
  label: string;
  /** Content for the L2 body. Optional — items without it show an
   *  empty-state hint. */
  content?: ReactNode;
}

export const L2Panel = (): ReactElement | null => {
  const { l2Open, activeRailId, l2ByRailId } = useRail();
  if (!l2Open) return null;
  const descriptor = activeRailId ? l2ByRailId[activeRailId] : null;
  return (
    <aside className={styles.panel} aria-label="Secondary navigation">
      <header className={styles.header}>
        <span className={styles.title}>{descriptor?.label ?? '—'}</span>
      </header>
      <div className={styles.body}>
        {descriptor?.content ?? (
          <p className={styles.empty}>No items for this section yet.</p>
        )}
      </div>
    </aside>
  );
};
