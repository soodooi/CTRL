// ViewSwitcher — segmented control that flips the center pane of
// NotesApp between Editor / Graph / Daily / Health.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-02 — kairo feature
// parity batch.)

import { type ReactElement } from 'react';
import styles from './Notes.module.css';

export type NotesView = 'editor' | 'graph' | 'daily' | 'health';

interface ViewSwitcherProps {
  active: NotesView;
  onChange: (view: NotesView) => void;
}

const VIEWS: ReadonlyArray<{ id: NotesView; label: string }> = [
  { id: 'editor', label: 'Editor' },
  { id: 'graph', label: 'Graph' },
  { id: 'daily', label: 'Daily' },
  { id: 'health', label: 'Health' },
];

export const ViewSwitcher = ({ active, onChange }: ViewSwitcherProps): ReactElement => (
  <nav className={styles.viewSwitcher} aria-label="Notes views">
    {VIEWS.map((v) => (
      <button
        type="button"
        key={v.id}
        className={styles.viewTab}
        data-active={active === v.id || undefined}
        onClick={() => onChange(v.id)}
      >
        {v.label}
      </button>
    ))}
  </nav>
);
