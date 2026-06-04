// KanbanBoard — single board view.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-03 — kairo Kanban
// parity batch.)
//
// Board storage is plain markdown so vim test still passes:
//
//   ---
//   type: kanban
//   title: Sprint board
//   ---
//
//   ## To Do
//   - Buy milk
//   - Refactor router
//
//   ## Doing
//   - Wire kanban
//
//   ## Done
//   - Ship v0.1.152
//
// Each H2 = a column. Each top-level `- ` list item under a column
// = a card. Column order in the file is the column order in the UI.
// Drag-drop between columns mutates the markdown body and persists
// back through `vault_write`. The frontmatter is left untouched so
// the user can stash board metadata (priority colours, due date
// defaults, ...) there without our parser rewriting it.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react';
import { vaultRead, vaultWrite } from '@/lib/kernel';
import styles from './Notes.module.css';

interface KanbanBoardProps {
  path: string;
}

interface Column {
  title: string;
  cards: string[];
}

const splitColumns = (body: string): Column[] => {
  const cols: Column[] = [];
  let current: Column | null = null;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd();
    const head = /^##\s+(.+?)\s*$/.exec(line);
    if (head) {
      if (current) cols.push(current);
      current = { title: head[1] ?? 'Untitled', cards: [] };
      continue;
    }
    if (!current) continue;
    const item = /^[-*]\s+(.+?)\s*$/.exec(line);
    if (item) {
      current.cards.push(item[1] ?? '');
    }
  }
  if (current) cols.push(current);
  return cols;
};

const serialise = (cols: Column[]): string => {
  const lines: string[] = [];
  for (const col of cols) {
    lines.push(`## ${col.title}`);
    lines.push('');
    for (const card of col.cards) {
      lines.push(`- ${card}`);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
};

export const KanbanBoard = ({ path }: KanbanBoardProps): ReactElement => {
  const [columns, setColumns] = useState<Column[]>([]);
  const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<{ col: number; idx: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const entry = await vaultRead(path);
      const body = typeof entry.body === 'string' ? entry.body : '';
      setColumns(splitColumns(body));
      setFrontmatter((entry.frontmatter ?? {}) as Record<string, unknown>);
      setDirty(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('kanban load failed', err);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await vaultWrite({
        path,
        content: serialise(columns),
        frontmatter: { ...frontmatter, type: 'kanban' },
      });
      setDirty(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('kanban save failed', err);
    } finally {
      setSaving(false);
    }
  }, [columns, frontmatter, path]);

  const handleAddCard = useCallback((colIdx: number) => {
    const text = window.prompt('New card');
    if (!text || !text.trim()) return;
    setColumns((prev) =>
      prev.map((c, i) =>
        i === colIdx ? { ...c, cards: [...c.cards, text.trim()] } : c,
      ),
    );
    setDirty(true);
  }, []);

  const handleAddColumn = useCallback(() => {
    const title = window.prompt('Column title');
    if (!title || !title.trim()) return;
    setColumns((prev) => [...prev, { title: title.trim(), cards: [] }]);
    setDirty(true);
  }, []);

  const handleRenameColumn = useCallback((colIdx: number) => {
    const next = window.prompt('Column title', columns[colIdx]?.title ?? '');
    if (next === null) return;
    setColumns((prev) =>
      prev.map((c, i) => (i === colIdx ? { ...c, title: next.trim() } : c)),
    );
    setDirty(true);
  }, [columns]);

  const handleEditCard = useCallback((colIdx: number, cardIdx: number) => {
    const current = columns[colIdx]?.cards[cardIdx] ?? '';
    const next = window.prompt('Card', current);
    if (next === null) return;
    const trimmed = next.trim();
    setColumns((prev) =>
      prev.map((c, i) => {
        if (i !== colIdx) return c;
        const cards = c.cards.slice();
        if (trimmed === '') cards.splice(cardIdx, 1);
        else cards[cardIdx] = trimmed;
        return { ...c, cards };
      }),
    );
    setDirty(true);
  }, [columns]);

  const handleDeleteColumn = useCallback((colIdx: number) => {
    if (!window.confirm('Delete this column and its cards?')) return;
    setColumns((prev) => prev.filter((_, i) => i !== colIdx));
    setDirty(true);
  }, []);

  // ----- HTML5 drag-drop wiring ---------------------------------
  const handleDragStart = useCallback(
    (colIdx: number, cardIdx: number) => (e: DragEvent<HTMLLIElement>) => {
      setDragging({ col: colIdx, idx: cardIdx });
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(cardIdx));
    },
    [],
  );

  const handleDragOverColumn = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (dragging) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, [dragging]);

  const handleDropColumn = useCallback(
    (destCol: number) => (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!dragging) return;
      const { col: srcCol, idx: srcIdx } = dragging;
      if (srcCol === destCol) {
        setDragging(null);
        return;
      }
      setColumns((prev) => {
        const next = prev.map((c) => ({ ...c, cards: c.cards.slice() }));
        const movedCard = next[srcCol]?.cards.splice(srcIdx, 1)[0];
        if (movedCard !== undefined && next[destCol]) {
          next[destCol].cards.push(movedCard);
        }
        return next;
      });
      setDirty(true);
      setDragging(null);
    },
    [dragging],
  );

  const totalCards = useMemo(
    () => columns.reduce((acc, c) => acc + c.cards.length, 0),
    [columns],
  );

  return (
    <section className={styles.kanbanBoard} aria-label="Kanban board">
      <header className={styles.kanbanHeader}>
        <span className={styles.kanbanCount}>
          {columns.length} col · {totalCards} cards
        </span>
        <button type="button" className={styles.actionButton} onClick={handleAddColumn}>
          + Column
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
        >
          {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </header>
      <div className={styles.kanbanCols}>
        {columns.map((col, colIdx) => (
          <div
            key={`${colIdx}-${col.title}`}
            className={styles.kanbanCol}
            onDragOver={handleDragOverColumn}
            onDrop={handleDropColumn(colIdx)}
          >
            <header className={styles.kanbanColHeader}>
              <button
                type="button"
                className={styles.kanbanColTitle}
                onClick={() => handleRenameColumn(colIdx)}
                title="Rename column"
              >
                {col.title}
              </button>
              <span className={styles.kanbanColBadge}>{col.cards.length}</span>
              <button
                type="button"
                className={styles.kanbanColDel}
                onClick={() => handleDeleteColumn(colIdx)}
                title="Delete column"
              >
                ✕
              </button>
            </header>
            <ul className={styles.kanbanCards}>
              {col.cards.map((card, cardIdx) => (
                <li
                  key={`${colIdx}-${cardIdx}-${card}`}
                  className={styles.kanbanCard}
                  draggable
                  onDragStart={handleDragStart(colIdx, cardIdx)}
                  onClick={() => handleEditCard(colIdx, cardIdx)}
                  title="Click to edit, drag to move"
                >
                  {card}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className={styles.kanbanAdd}
              onClick={() => handleAddCard(colIdx)}
            >
              + Card
            </button>
          </div>
        ))}
        {columns.length === 0 ? (
          <p className={styles.muted}>
            Empty board. Click <code>+ Column</code> to start.
          </p>
        ) : null}
      </div>
    </section>
  );
};
