// NotesBacklinks — right column of the Notes app.
//
// (ADR-002 substrate § vault v1 §8.6 v4 + v5 §10 embeddings, 2026-06-03 —
// memory `decision_vault_adr_002_section_8`. Product spec §5.1 + §5.8.)
//
// Surfaces two grouped lists:
//   - **Backlinks** — explicit [[wikilinks]] pointing into the active note.
//   - **Suggested** — embeddings-driven candidates from
//     `vault.suggest_links`. Hidden when the embedding provider is
//     unreachable (Ollama down + user opted-out of cloud) so the panel
//     does not lie about availability.
//
// Both are clickable rows that route through `onSelect` — NotesBacklinks
// stays presentational; NotesApp owns `selectedPath`.

import { type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultBacklinks, vaultMentions, vaultSuggestLinks } from '@/lib/kernel';
import styles from './Notes.module.css';

interface NotesBacklinksProps {
  path: string | null;
  onSelect: (path: string) => void;
}

/** Title stem of a note path, used as the unlinked-mention search term. */
const noteStem = (p: string): string => {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
};

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

  // Embeddings-suggested links. Failure is silent (Ollama unreachable
  // == feature unavailable, not an error to surface to the user). Cached
  // 30s — when the user actively writes the editor will not re-fetch on
  // every keystroke.
  const { data: suggested = [] } = useQuery({
    queryKey: ['vault-suggest-links', path],
    queryFn: () => (path ? vaultSuggestLinks(path, 5).catch(() => []) : Promise.resolve([])),
    enabled: !!path,
    staleTime: 30_000,
  });

  // Unlinked mentions — notes that name this one in prose but never
  // [[linked]] it. Search term = the note's title stem; only run when
  // it is distinctive enough (>= 3 chars) to avoid noise, and drop the
  // note's own self-mentions. Wires vault_mentions (backend was ready,
  // no UI surfaced it — an "AI is a pipe" prompt to link your thinking).
  const term = path ? noteStem(path) : '';
  const { data: mentions = [] } = useQuery({
    queryKey: ['vault-mentions', term],
    queryFn: () =>
      term.length >= 3 ? vaultMentions(term).catch(() => []) : Promise.resolve([]),
    enabled: !!path && term.length >= 3,
    staleTime: 30_000,
  });
  const unlinkedMentions = mentions.filter((m) => m.path !== path);

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

        {path && suggested.length > 0 ? (
          <>
            <header className={`${styles.backlinksHeader} ${styles.backlinksSuggestedHeader}`}>
              <h2 className={styles.backlinksTitle}>Suggested</h2>
              <span className={styles.backlinksCount}>{suggested.length}</span>
            </header>
            <ul className={styles.backlinksList}>
              {suggested.map((hit) => (
                <li key={`suggest:${hit.path}`}>
                  <button
                    type="button"
                    className={styles.backlinksItem}
                    onClick={() => onSelect(hit.path)}
                    title={`${hit.path} · score ${hit.score.toFixed(2)}`}
                  >
                    <span className={styles.backlinksFrom}>{hit.path}</span>
                    {hit.snippet ? (
                      <span className={styles.backlinksSnippet}>{hit.snippet}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {path && unlinkedMentions.length > 0 ? (
          <>
            <header className={`${styles.backlinksHeader} ${styles.backlinksSuggestedHeader}`}>
              <h2 className={styles.backlinksTitle}>Unlinked mentions</h2>
              <span className={styles.backlinksCount}>{unlinkedMentions.length}</span>
            </header>
            <ul className={styles.backlinksList}>
              {unlinkedMentions.map((hit) => (
                <li key={`mention:${hit.path}`}>
                  <button
                    type="button"
                    className={styles.backlinksItem}
                    onClick={() => onSelect(hit.path)}
                    title={hit.path}
                  >
                    <span className={styles.backlinksFrom}>{hit.path}</span>
                    {hit.snippet ? (
                      <span className={styles.backlinksSnippet}>…{hit.snippet}…</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </aside>
  );
};
