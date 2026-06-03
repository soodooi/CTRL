// DiagramView — Notes app sub-view that lists diagrams under
// `vault/diagrams/*.md` and lets the user open / create one.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-03 — kairo Diagram
// parity batch.)

import {
  useCallback,
  useState,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { vaultList, vaultWrite } from '@/lib/kernel';
import { DiagramEditor } from './DiagramEditor';
import styles from './Notes.module.css';

const DIAGRAMS_DIR = 'diagrams';

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const DiagramView = (): ReactElement => {
  const [activePath, setActivePath] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: diagrams = [], isLoading } = useQuery({
    queryKey: ['vault-list-diagrams'],
    queryFn: () => vaultList(DIAGRAMS_DIR),
    staleTime: 10_000,
  });

  const handleNewDiagram = useCallback(async () => {
    const title = window.prompt('Diagram title', 'Flow');
    if (!title || !title.trim()) return;
    const path = `${DIAGRAMS_DIR}/${slugify(title.trim())}.md`;
    try {
      await vaultWrite({
        path,
        content: '',
        frontmatter: {
          type: 'diagram',
          title: title.trim(),
          diagram: JSON.stringify({ nodes: [], edges: [] }),
        },
      });
      queryClient.invalidateQueries({ queryKey: ['vault-list-diagrams'] });
      setActivePath(path);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('diagram new failed', err);
    }
  }, [queryClient]);

  const visible = diagrams.filter((p) => p.endsWith('.md')).sort();

  return (
    <section className={styles.diagramView} aria-label="Diagrams">
      <header className={styles.diagramViewHeader}>
        <h2 className={styles.diagramViewTitle}>Diagrams</h2>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void handleNewDiagram()}
        >
          + Diagram
        </button>
        {activePath ? (
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => setActivePath(null)}
          >
            ← Back to list
          </button>
        ) : null}
      </header>
      {activePath ? (
        <DiagramEditor path={activePath} />
      ) : (
        <div className={styles.diagramList}>
          {isLoading ? (
            <p className={styles.muted}>Loading…</p>
          ) : visible.length === 0 ? (
            <p className={styles.muted}>
              No diagrams yet. Click <code>+ Diagram</code> to start one.
            </p>
          ) : (
            <ul className={styles.kanbanListItems}>
              {visible.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    className={styles.kanbanListItem}
                    onClick={() => setActivePath(p)}
                    title={p}
                  >
                    <span>{stem(baseName(p))}</span>
                    <span className={styles.kanbanListPath}>{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
