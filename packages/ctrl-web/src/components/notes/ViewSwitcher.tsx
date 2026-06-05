// ViewSwitcher — 2-view toggle (Notes / Graph) matching kairo v0.1.0
// upstream. Earlier kairo-parity batch (2026-06-02 v5) added Daily /
// Health / Kanban / Diagram / Git views; bao 2026-06-05 reverted to
// 1:1 kairo UI fidelity. The backend Tauri commands behind those
// removed views (git_*, vault_*) are retained for Irisy MCP access —
// see commands/git.rs + kernel/vault.rs.

import { type ReactElement } from 'react';
import styles from './Notes.module.css';

export type NotesView = 'editor' | 'graph';

interface ViewSwitcherProps {
  active: NotesView;
  onChange: (view: NotesView) => void;
}

const VIEWS: ReadonlyArray<{ id: NotesView; label: string }> = [
  { id: 'editor', label: 'Notes' },
  { id: 'graph', label: 'Graph' },
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
