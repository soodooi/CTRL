// TodayPanel — open tasks and today's events, over the vault's own Markdown.
//
// Both sources were queryable through the gate and neither had a surface, so the
// Work pane showed nothing at all when no Resource was open. This fills that
// state with the user's actual day rather than with chrome.
//
// A task is a checkbox line in a note and an event is a note's frontmatter, so
// completing a task is addressed by (note, line) and the list is refetched
// afterwards rather than optimistically crossed out.
// (ADR-002 substrate §14.13; ADR-005 irisy §12 v42 U5)

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { DecisionSurface } from '@/components/decisions/DecisionSurface';
import { conflictFact, unavailableFact, type DecisionFact } from '@/lib/decision-registry';
import {
  completeTask,
  dueState,
  eventWhen,
  listEventsOn,
  listOpenTasks,
  localDate,
  type EventRow,
  type TaskRow,
} from '@/lib/lifeos';
import styles from './TodayPanel.module.css';

export function TodayPanel(): ReactElement | null {
  const [today] = useState(() => localDate());
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionFact | null>(null);

  // Refetch only. Clearing a decision is the user's act (dismiss or retry) or the
  // start of a new attempt — a refetch triggered BY a failure must not erase the
  // report of that failure, which is what a conflict reload used to do.
  const load = useCallback((): void => {
    void listOpenTasks()
      .then(setTasks)
      // An empty list and an unreadable source are different answers; keep them
      // distinguishable by leaving the state null on failure.
      .catch(() => setTasks(null));
    void listEventsOn(today)
      .then(setEvents)
      .catch(() => setEvents(null));
  }, [today]);

  useEffect(load, [load]);

  const complete = async (task: TaskRow): Promise<void> => {
    const key = `${task.path}:${task.line}`;
    setBusy(key);
    setDecision(null);
    try {
      // The owner's Outcome decides what happened; a call that returned is not
      // evidence that anything was written.
      // (ADR-002 substrate §15.5.2 v86)
      const result = await completeTask(task);
      if (result.kind === 'conflict') {
        setDecision(
          conflictFact({
            id: `task:${key}`,
            subject: 'That task was not completed because the note changed.',
            target: task.title,
            // Both operands, so the user can see it is a real conflict and not a
            // vague failure. A short revision is enough to compare.
            expected: result.expected
              ? `the note you saw (${result.expected.slice(0, 12)})`
              : 'the note you saw',
            current: result.current
              ? `the note on disk now (${result.current.slice(0, 12)})`
              : 'the note on disk now',
          }),
        );
        // Reload regardless: the list on screen is provably out of date.
        load();
        return;
      }
      if (result.kind === 'failed') {
        setDecision(
          unavailableFact({
            id: `task:${key}`,
            subject: 'That task was not completed.',
            target: task.title,
            reason: result.message,
            retryable: result.retryable,
          }),
        );
        return;
      }
      // Refetch: the vault is the truth, and the rewrite may shift other lines.
      load();
    } catch (error) {
      setDecision(
        unavailableFact({
          id: `task:${key}`,
          subject: 'That task was not completed.',
          target: task.title,
          reason: error instanceof Error ? error.message : String(error),
          retryable: true,
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  // Nothing readable at all: stay out of the way rather than showing two empty
  // shelves the user cannot act on.
  if (tasks === null && events === null) return null;

  return (
    <section className={styles.root} aria-label="Today">
      {decision ? (
        <DecisionSurface
          fact={decision}
          onResolve={(optionId) => {
            setDecision(null);
            if (optionId === 'retry') load();
          }}
        />
      ) : null}

      <div className={styles.column} data-testid="today-tasks">
        <div className={styles.heading}>Open tasks</div>
        {tasks === null ? (
          <p className={styles.empty}>Tasks could not be read from the vault.</p>
        ) : tasks.length === 0 ? (
          <p className={styles.empty}>Nothing open.</p>
        ) : (
          <ul className={styles.list}>
            {tasks.map((task) => {
              const key = `${task.path}:${task.line}`;
              const state = dueState(task.due, today);
              return (
                <li key={key} className={styles.task} data-due={state}>
                  <button
                    type="button"
                    className={styles.check}
                    aria-label={`Complete ${task.title}`}
                    disabled={busy === key}
                    onClick={() => void complete(task)}
                  >
                    {busy === key ? '…' : '○'}
                  </button>
                  <span className={styles.taskTitle}>{task.title}</span>
                  {task.due ? (
                    <span className={styles.due} data-due={state}>
                      {state === 'overdue' ? `overdue ${task.due}` : task.due}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.column} data-testid="today-events">
        <div className={styles.heading}>Today · {today}</div>
        {events === null ? (
          <p className={styles.empty}>The calendar could not be read from the vault.</p>
        ) : events.length === 0 ? (
          <p className={styles.empty}>Nothing scheduled.</p>
        ) : (
          <ul className={styles.list}>
            {events.map((entry) => (
              <li key={`${entry.path}:${entry.title}:${entry.start}`} className={styles.event}>
                <span className={styles.when}>{eventWhen(entry)}</span>
                <span className={styles.eventTitle}>{entry.title}</span>
                {entry.location ? (
                  <span className={styles.where}>{entry.location}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
