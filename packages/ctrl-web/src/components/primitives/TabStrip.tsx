// TabStrip — horizontal tabs with a per-tab status dot. L1 navigation
// primitive used by ClusterWorkspace group cards (multi-session
// switching), Code Space detail view mode toggle, etc.

import type { ReactElement } from 'react';
import { Led, type LedTone } from './Led';
import styles from './TabStrip.module.css';

export interface TabItem {
  id: string;
  label: string;
  tone?: LedTone;
}

export interface TabStripProps {
  items: ReadonlyArray<TabItem>;
  activeId?: string;
  onChange?: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}

export const TabStrip = ({
  items,
  activeId,
  onChange,
  ariaLabel = 'Tabs',
  className,
}: TabStripProps): ReactElement => (
  <div
    className={[styles.strip, className ?? ''].filter(Boolean).join(' ')}
    role="tablist"
    aria-label={ariaLabel}
  >
    {items.map((item) => (
      <button
        key={item.id}
        type="button"
        role="tab"
        aria-selected={item.id === activeId}
        data-active={item.id === activeId}
        className={styles.tab}
        onClick={() => onChange?.(item.id)}
        title={item.label}
      >
        <Led tone={item.tone ?? 'unknown'} size="sm" />
        <span className={styles.label}>{item.label}</span>
      </button>
    ))}
  </div>
);
