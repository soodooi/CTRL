// Today — the LifeOS home surface (GOAL Phase 1, governing
// `vault/ctrl/lifeos-layer-restructure.md`). Quick-capture a task and see your
// open tasks, all operated through the SAME :17873 gate an external agent uses
// (task_query / task_create / task_update). Tasks are inline `- [ ]` checkbox
// lines in the vault (markdown = truth), so what shows here is exactly what a
// user would see opening today's daily note in vim.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { queryTasks, createTask, updateTask, type TaskRow } from '@/lib/kernel';
import styles from './TodayView.module.css';

function todayISO(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function TodayView(): ReactElement {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Open tasks (todo + doing), soonest due first.
      const res = await queryTasks({
        filters: [{ field: 'status', op: 'neq', value: 'done' }],
        sort: [{ field: 'due' }],
      });
      setRows(res.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCapture = useCallback(async () => {
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      // A bare `@YYYY-MM-DD` token in the draft becomes the due date.
      const dueMatch = title.match(/@(\d{4}-\d{2}-\d{2})/);
      const clean = title.replace(/@\d{4}-\d{2}-\d{2}/, '').trim();
      await createTask({ title: clean || title, due: dueMatch?.[1] ?? null });
      setDraft('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, refresh]);

  const onComplete = useCallback(
    async (row: TaskRow) => {
      setBusy(true);
      try {
        await updateTask({
          note: row.path,
          line: Number(row.line),
          field: 'status',
          value: 'done',
        });
        // Optimistic: drop it from the open list immediately.
        setRows((rs) => rs.filter((r) => !(r.path === row.path && r.line === row.line)));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        void refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const dueClass = (due: string): string => {
    if (!due) return '';
    const t = todayISO();
    if (due < t) return styles.overdue ?? '';
    if (due === t) return styles.today ?? '';
    return '';
  };

  return (
    <div className={styles.root} data-testid="today-view">
      <header className={styles.head}>
        <h1 className={styles.title}>Today</h1>
        <span className={styles.date}>{todayISO()}</span>
      </header>

      <div className={styles.capture}>
        <input
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onCapture();
          }}
          placeholder="Capture a task…  (add @2026-07-05 for a due date)"
          aria-label="Capture a task"
        />
        <button
          type="button"
          className={styles.add}
          onClick={() => void onCapture()}
          disabled={!draft.trim() || busy}
        >
          Add
        </button>
      </div>

      {error && (
        <div className={styles.notice} data-tone="error">
          {error.includes('kernel') || error.toLowerCase().includes('connect')
            ? 'Kernel not connected — open the desktop app to load your tasks.'
            : error}
        </div>
      )}

      {loading ? (
        <div className={styles.notice}>Loading tasks…</div>
      ) : rows.length === 0 && !error ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No open tasks</p>
          <p className={styles.emptyHint}>
            Capture one above, or jot <code>- [ ] something</code> in any note.
          </p>
        </div>
      ) : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={`${r.path}:${r.line}`} className={styles.item}>
              <button
                type="button"
                className={styles.check}
                onClick={() => void onComplete(r)}
                disabled={busy}
                aria-label={`Complete ${r.title}`}
                data-status={r.status}
              />
              <div className={styles.body}>
                <span className={styles.taskTitle}>{r.title}</span>
                <span className={styles.meta}>
                  {r.due && <span className={`${styles.due} ${dueClass(r.due)}`}>{r.due}</span>}
                  {r.tags
                    ? r.tags
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean)
                        .map((t) => (
                          <span key={t} className={styles.tag}>
                            #{t}
                          </span>
                        ))
                    : null}
                  <span className={styles.src}>{r.path}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
