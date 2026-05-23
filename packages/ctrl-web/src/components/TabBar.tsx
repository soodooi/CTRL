// TabBar — horizontal tab strip for the workspace work surface.
//
// Per decision_ctrl_is_hermes_workbench: workspace is a persistent
// multi-tab IDE-style work area. Each tab tracks a Tab from
// tab-store (vault doc / keycap output / external embed / session).

import type { ReactElement } from 'react';
import type { Tab } from '@/lib/tab-store';
import { useTabStore } from '@/lib/tab-store';
import styles from './TabBar.module.css';

interface TabBarProps {
  tabs: ReadonlyArray<Tab>;
  activeId: string | null;
}

const KIND_LABEL: Record<Tab['kind'], string> = {
  'external-embed': 'EMBED',
  'vault-md': 'DOC',
  'keycap-output': 'OUT',
  'session-stream': 'LIVE',
  route: 'PAGE',
};

const KIND_GLYPH: Record<Tab['kind'], string> = {
  'external-embed': '⤢',
  'vault-md': '⌬',
  'keycap-output': '◉',
  'session-stream': '◐',
  route: '⌘',
};

export const TabBar = ({ tabs, activeId }: TabBarProps): ReactElement | null => {
  const activate = useTabStore((s) => s.activateTab);
  const close = useTabStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className={styles.bar} role="tablist" aria-label="Workspace tabs">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            className={styles.tab}
            onClick={() => activate(tab.id)}
            onAuxClick={(e) => {
              // Middle click closes (browser/VS Code convention).
              if (e.button === 1) {
                e.preventDefault();
                close(tab.id);
              }
            }}
            title={tab.title}
          >
            <span className={styles.tabIcon} aria-hidden="true">
              {tab.icon ?? KIND_GLYPH[tab.kind]}
            </span>
            <span className={styles.tabKind}>{KIND_LABEL[tab.kind]}</span>
            <span className={styles.tabLabel}>{tab.title}</span>
            <span
              role="button"
              className={styles.close}
              aria-label={`Close ${tab.title}`}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                close(tab.id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  close(tab.id);
                }
              }}
            >
              ×
            </span>
          </button>
        );
      })}
      <div className={styles.spacer} />
    </div>
  );
};
