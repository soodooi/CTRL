// NotesActions — top bar of the Notes app (workspace tab body).
//
// (ADR-002 substrate § vault v1 §8.6 v4, 2026-06-02 — bao 2026-06-02
// realignment: Vault is substrate, Notes is the L1 app; memory
// `decision_vault_adr_002_section_8`.)
//
// Hosts the search input + quick-action buttons (+ Note / Today /
// Review). Pure presentation — state lives in NotesApp.

import { type ChangeEvent, type ReactElement } from 'react';
import styles from './Notes.module.css';

interface NotesActionsProps {
  query: string;
  onQueryChange: (q: string) => void;
  onNew: () => void;
  onToday: () => void;
  onReview: () => void;
  reviewCount: number;
  busy?: boolean;
}

export const NotesActions = ({
  query,
  onQueryChange,
  onNew,
  onToday,
  onReview,
  reviewCount,
  busy,
}: NotesActionsProps): ReactElement => (
  <header className={styles.actions} role="toolbar" aria-label="Notes actions">
    <input
      type="search"
      className={styles.search}
      placeholder="Search notes…"
      value={query}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onQueryChange(e.target.value)}
      aria-label="Search notes"
    />
    <button type="button" className={styles.actionButton} onClick={onNew} disabled={busy}>
      + Note
    </button>
    <button type="button" className={styles.actionButton} onClick={onToday} disabled={busy}>
      Today
    </button>
    <button
      type="button"
      className={styles.actionButton}
      onClick={onReview}
      disabled={busy}
      data-pending={reviewCount > 0 || undefined}
    >
      Review <span className={styles.badge}>{reviewCount}</span>
    </button>
  </header>
);
