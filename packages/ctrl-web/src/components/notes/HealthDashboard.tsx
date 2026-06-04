// HealthDashboard — vault health overview.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-02 — kairo feature
// parity batch.)
//
// Reads the kernel commands `vault_orphans`, `vault_broken_links`,
// `vault_graph_data`, and `vault_tags` to surface the four standard
// vault-hygiene views:
//
//   1. Stats — total notes, total tags, total backlinks, orphan count
//   2. Orphans — notes nobody links to
//   3. Broken links — references that resolve to no vault file
//   4. (Future) Unlinked mentions — requires a user-supplied query
//      string, so it's exposed inline as a search box rather than as
//      a pre-computed view.
//
// Clicking a path opens that note as the active selection (handled by
// NotesApp via the `onSelect` callback).

import { useState, type ChangeEvent, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  vaultBrokenLinks,
  vaultGraphData,
  vaultMentions,
  vaultOrphans,
  vaultTags,
} from '@/lib/kernel';
import styles from './Notes.module.css';

interface HealthDashboardProps {
  onSelect: (path: string) => void;
}

export const HealthDashboard = ({ onSelect }: HealthDashboardProps): ReactElement => {
  const { data: orphans = [] } = useQuery({
    queryKey: ['vault-orphans'],
    queryFn: () => vaultOrphans(),
    staleTime: 30_000,
  });
  const { data: broken = [] } = useQuery({
    queryKey: ['vault-broken-links'],
    queryFn: () => vaultBrokenLinks(),
    staleTime: 30_000,
  });
  const { data: graph } = useQuery({
    queryKey: ['vault-graph-data'],
    queryFn: () => vaultGraphData(),
    staleTime: 30_000,
  });
  const { data: tags = [] } = useQuery({
    queryKey: ['vault-tags'],
    queryFn: () => vaultTags(),
    staleTime: 30_000,
  });

  const [mentionQuery, setMentionQuery] = useState('');
  const trimmedMention = mentionQuery.trim();
  const { data: mentionHits = [] } = useQuery({
    queryKey: ['vault-mentions', trimmedMention],
    queryFn: () => vaultMentions(trimmedMention),
    enabled: trimmedMention.length > 1,
    staleTime: 15_000,
  });

  const totalNotes = graph?.nodes.length ?? 0;
  const totalLinks = graph?.edges.length ?? 0;
  const totalTags = tags.length;

  return (
    <section className={styles.healthView} aria-label="Vault health">
      <header className={styles.healthHeader}>
        <h2 className={styles.healthTitle}>Vault health</h2>
      </header>

      <div className={styles.healthStats}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Notes</span>
          <span className={styles.statValue}>{totalNotes}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Links</span>
          <span className={styles.statValue}>{totalLinks}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Tags</span>
          <span className={styles.statValue}>{totalTags}</span>
        </div>
        <div className={styles.statCard} data-warn={orphans.length > 0 || undefined}>
          <span className={styles.statLabel}>Orphans</span>
          <span className={styles.statValue}>{orphans.length}</span>
        </div>
        <div className={styles.statCard} data-warn={broken.length > 0 || undefined}>
          <span className={styles.statLabel}>Broken</span>
          <span className={styles.statValue}>{broken.length}</span>
        </div>
      </div>

      <section className={styles.healthGroup}>
        <h3 className={styles.healthGroupTitle}>Orphans</h3>
        {orphans.length === 0 ? (
          <p className={styles.muted}>None — every note has at least one inbound link.</p>
        ) : (
          <ul className={styles.healthList}>
            {orphans.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className={styles.healthItem}
                  onClick={() => onSelect(p)}
                  title={p}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.healthGroup}>
        <h3 className={styles.healthGroupTitle}>Broken links</h3>
        {broken.length === 0 ? (
          <p className={styles.muted}>None — every outbound link resolves.</p>
        ) : (
          <ul className={styles.healthList}>
            {broken.map((b) => (
              <li key={`${b.from}->${b.target}`} className={styles.healthBroken}>
                <button
                  type="button"
                  className={styles.healthItem}
                  onClick={() => onSelect(b.from)}
                  title={`From ${b.from}`}
                >
                  <span>{b.from}</span>
                  <span className={styles.healthArrow}>→</span>
                  <code className={styles.healthBrokenTarget}>{b.target}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.healthGroup}>
        <h3 className={styles.healthGroupTitle}>Unlinked mentions</h3>
        <input
          type="search"
          className={styles.healthSearch}
          placeholder="Find unlinked mentions of…"
          value={mentionQuery}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setMentionQuery(e.target.value)}
        />
        {trimmedMention.length <= 1 ? (
          <p className={styles.muted}>
            Type a phrase to find notes that mention it without a wikilink.
          </p>
        ) : mentionHits.length === 0 ? (
          <p className={styles.muted}>No unlinked mentions of “{trimmedMention}”.</p>
        ) : (
          <ul className={styles.healthList}>
            {mentionHits.map((m) => (
              <li key={`${m.path}-${m.snippet}`}>
                <button
                  type="button"
                  className={styles.healthItem}
                  onClick={() => onSelect(m.path)}
                  title={m.path}
                >
                  <span>{m.path}</span>
                  <span className={styles.healthSnippet}>…{m.snippet}…</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};
