// BacklinksDrawer — collapsible bottom drawer inside WorkspaceShell.
//
// (ADR-002 substrate § vault v1 §8.6, 2026-06-01 — memory
// `decision_vault_adr_002_section_8`.)
//
// Shows backlinks for the currently-active vault-md tab. Reads via
// kernel `vault_backlinks(path)` — replaces the retired client-side
// O(N) BacklinksPanel scan (§8.7). Default collapsed; header shows the
// hit count even when closed so users see at-a-glance whether a note
// has inbound references.

import {
  useCallback,
  useState,
  type ReactElement,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultBacklinks } from '@/lib/kernel';
import { useWorkspaceStore } from '@/lib/workspace-store';
import styles from './BacklinksDrawer.module.css';

interface BacklinksDrawerProps {
  /** Vault-relative path of the note in focus. */
  path: string;
}

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

export const BacklinksDrawer = ({ path }: BacklinksDrawerProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const openTab = useWorkspaceStore((s) => s.openTab);

  const { data: hits = [], isLoading } = useQuery({
    queryKey: ['vault-backlinks', path],
    queryFn: () => vaultBacklinks(path),
    enabled: open && path.length > 0,
    staleTime: 5_000,
  });

  const toggle = useCallback(() => setOpen((v) => !v), []);

  const openFrom = useCallback(
    (from: string) => {
      openTab(
        {
          id: `vault:${from}`,
          kind: 'vault-md',
          title: baseName(from),
          vaultPath: from,
        },
        { activate: true },
      );
    },
    [openTab],
  );

  return (
    <section className={styles.drawer} aria-label="Backlinks" data-open={open || undefined}>
      <button
        type="button"
        className={styles.header}
        onClick={toggle}
        aria-expanded={open}
      >
        <span className={styles.chevron} aria-hidden>{open ? '▾' : '▸'}</span>
        <span className={styles.label}>Backlinks</span>
        <span className={styles.count}>{hits.length}</span>
      </button>
      {open ? (
        <div className={styles.body}>
          {isLoading ? (
            <p className={styles.muted}>Scanning vault…</p>
          ) : hits.length === 0 ? (
            <p className={styles.muted}>No notes link here yet.</p>
          ) : (
            <ul className={styles.list}>
              {hits.map((hit) => (
                <li key={hit.from} className={styles.item}>
                  <button
                    type="button"
                    className={styles.itemButton}
                    onClick={() => openFrom(hit.from)}
                    title={hit.from}
                  >
                    <span className={styles.itemFrom}>{hit.from}</span>
                    {hit.snippet ? (
                      <span className={styles.itemSnippet}>…{hit.snippet}…</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
};
