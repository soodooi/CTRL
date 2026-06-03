// NotesBacklinks — right column of the Notes app.
//
// (ADR-002 substrate § vault v1 §8.6 v4, 2026-06-02 — memory
// `decision_vault_adr_002_section_8`.)
//
// Reads `vault_backlinks(activePath)` and surfaces the inbound link
// list with snippet previews. Clicking a row selects that note in
// the Notes app (via `onSelect`); this keeps NotesBacklinks
// presentational while NotesApp owns the `selectedPath` state.

import { type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultBacklinks } from '@/lib/kernel';
import styles from './Notes.module.css';

interface NotesBacklinksProps {
  path: string | null;
  onSelect: (path: string) => void;
}

export const NotesBacklinks = ({
  path,
  onSelect,
}: NotesBacklinksProps): ReactElement => {
  const { data: hits = [], isLoading } = useQuery({
    queryKey: ['vault-backlinks', path],
    queryFn: () => (path ? vaultBacklinks(path) : Promise.resolve([])),
    enabled: !!path,
    staleTime: 5_000,
  });

  return (
    <aside className={styles.backlinks} aria-label="Backlinks">
      <header className={styles.backlinksHeader}>
        <h2 className={styles.backlinksTitle}>Backlinks</h2>
        <span className={styles.backlinksCount}>{hits.length}</span>
      </header>
      <div className={styles.backlinksBody}>
        {!path ? (
          <p className={styles.muted}>Select a note to see backlinks.</p>
        ) : isLoading ? (
          <p className={styles.muted}>Scanning…</p>
        ) : hits.length === 0 ? (
          <p className={styles.muted}>No notes link here yet.</p>
        ) : (
          <ul className={styles.backlinksList}>
            {hits.map((hit) => (
              <li key={hit.from}>
                <button
                  type="button"
                  className={styles.backlinksItem}
                  onClick={() => onSelect(hit.from)}
                  title={hit.from}
                >
                  <span className={styles.backlinksFrom}>{hit.from}</span>
                  {hit.snippet ? (
                    <span className={styles.backlinksSnippet}>…{hit.snippet}…</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
};
