// NotesTabBar — open-notes tab strip above the editor.
//
// bao 2026-06-03 (kairo-parity batch): multi-note pinning inside the
// Notes app. Tabs are *inside* the Notes route — they do NOT spawn
// workspace-level tabs (that would mix L1 Notes tabs with Pool /
// Coding / Settings tabs and pollute the cockpit). Closing the last
// tab clears selection back to the empty editor state.

import { type ReactElement } from 'react';
import styles from './Notes.module.css';

interface OpenTab {
  path: string;
  dirty: boolean;
}

interface NotesTabBarProps {
  tabs: ReadonlyArray<OpenTab>;
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};
const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

export const NotesTabBar = ({
  tabs,
  activePath,
  onSelect,
  onClose,
}: NotesTabBarProps): ReactElement | null => {
  if (tabs.length === 0) return null;
  return (
    <nav className={styles.notesTabBar} aria-label="Open notes">
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        return (
          <div
            key={tab.path}
            className={styles.notesTab}
            data-active={active || undefined}
          >
            <button
              type="button"
              className={styles.notesTabButton}
              onClick={() => onSelect(tab.path)}
              title={tab.path}
            >
              {tab.dirty ? <span className={styles.notesTabDirty} aria-hidden /> : null}
              <span className={styles.notesTabLabel}>{stem(baseName(tab.path))}</span>
            </button>
            <button
              type="button"
              className={styles.notesTabClose}
              onClick={() => onClose(tab.path)}
              title="Close tab"
              aria-label={`Close ${baseName(tab.path)}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </nav>
  );
};
