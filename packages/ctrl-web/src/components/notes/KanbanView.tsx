// KanbanView — Notes app sub-view that lists boards under
// `vault/boards/*.md` and lets the user open / create one.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-03 — kairo Kanban
// parity batch.)

import {
  useCallback,
  useState,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { vaultList, vaultWrite } from '@/lib/kernel';
import { KanbanBoard } from './KanbanBoard';
import styles from './Notes.module.css';

const BOARDS_DIR = 'boards';

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

export const KanbanView = (): ReactElement => {
  const [activePath, setActivePath] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: boards = [], isLoading } = useQuery({
    queryKey: ['vault-list-boards'],
    queryFn: () => vaultList(BOARDS_DIR),
    staleTime: 10_000,
  });

  const handleNewBoard = useCallback(async () => {
    const title = window.prompt('Board title', 'Sprint');
    if (!title || !title.trim()) return;
    const path = `${BOARDS_DIR}/${slugify(title.trim())}.md`;
    const body =
      '## To Do\n\n- Sample card\n\n## Doing\n\n## Done\n';
    try {
      await vaultWrite({
        path,
        content: body,
        frontmatter: { type: 'kanban', title: title.trim() },
      });
      queryClient.invalidateQueries({ queryKey: ['vault-list-boards'] });
      setActivePath(path);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('kanban new failed', err);
    }
  }, [queryClient]);

  const visible = boards.filter((p) => p.endsWith('.md')).sort();

  return (
    <section className={styles.kanbanView} aria-label="Kanban">
      <header className={styles.kanbanViewHeader}>
        <h2 className={styles.kanbanViewTitle}>Kanban</h2>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void handleNewBoard()}
        >
          + Board
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
        <KanbanBoard path={activePath} />
      ) : (
        <div className={styles.kanbanList}>
          {isLoading ? (
            <p className={styles.muted}>Loading…</p>
          ) : visible.length === 0 ? (
            <p className={styles.muted}>
              No boards yet. Click <code>+ Board</code> to start one.
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
