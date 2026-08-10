// lifeos — tasks and calendar over the vault's own Markdown.
//
// Both record sources were fully queryable through the gate and neither had a
// user surface, so "keep my tasks and schedule" was served only for smart
// tables. Nothing here introduces a second store: a task is a checkbox line in a
// note and an event is a note's frontmatter, which is why completing a task is
// addressed by (note, line) rather than by an invented id.
// (ADR-002 substrate §14.13; ADR-005 irisy §12 v42 U5)

import { gateInvoke } from './kernel';
import { resourceRefFor, writeRecord, type RecordWriteResult } from './record-write';

export interface TaskRow {
  path: string;
  line: number;
  title: string;
  status: string;
  due: string;
  done: string;
  tags: string[];
}

export interface EventRow {
  path: string;
  title: string;
  date: string;
  start: string;
  end: string;
  location: string;
  tags: string[];
}

interface RecordReply<T> {
  rows?: T[];
  match_count?: number;
}

/** Open tasks, soonest due first. Completed ones are excluded by the source
 *  filter rather than by hiding them after the fact. */
export async function listOpenTasks(limit = 50): Promise<TaskRow[]> {
  const reply = await gateInvoke<RecordReply<TaskRow>>('task_query', {
    filters: [{ field: 'status', op: 'neq', value: 'done' }],
    sort: [{ field: 'due', direction: 'asc' }],
    limit,
  });
  return Array.isArray(reply.rows) ? reply.rows : [];
}

/** Today's events, in start order. */
export async function listEventsOn(date: string, limit = 50): Promise<EventRow[]> {
  const reply = await gateInvoke<RecordReply<EventRow>>('calendar_query', {
    filters: [{ field: 'date', op: 'eq', value: date }],
    sort: [{ field: 'start', direction: 'asc' }],
    limit,
  });
  return Array.isArray(reply.rows) ? reply.rows : [];
}

/** The canonical ref for one note's tasks. */
export const taskResourceRef = (notePath: string): string => resourceRefFor('task', notePath);

/** The canonical ref for one event, which is one note. */
export const eventResourceRef = (notePath: string): string =>
  resourceRefFor('calendar', notePath);

/** Complete one task through the canonical write verb, conditioned on the note
 *  the caller read. Addressed by note and line, which is the task's real identity
 *  in a Markdown vault. (ADR-002 substrate §15.2 v87) */
export async function completeTask(task: TaskRow): Promise<RecordWriteResult> {
  return setTaskField(task, 'status', 'done');
}

export async function setTaskField(
  task: TaskRow,
  field: 'status' | 'due' | 'title' | 'tags',
  value: string,
): Promise<RecordWriteResult> {
  return writeRecord(taskResourceRef(task.path), (expected_revision) => ({
    kind: 'set_field',
    expected_revision,
    line: task.line,
    field,
    value,
  }));
}

/** Change one field of one event. The note is the event's identity, so this is
 *  addressed by note rather than by a row index from an earlier scan.
 *  (ADR-002 substrate §15.2 v87) */
export async function setEventField(
  event: EventRow,
  field: 'title' | 'date' | 'start' | 'end' | 'location' | 'tags',
  value: string,
): Promise<RecordWriteResult> {
  return writeRecord(eventResourceRef(event.path), (expected_revision) => ({
    kind: 'set_field',
    expected_revision,
    field,
    value,
  }));
}

export type DueState = 'overdue' | 'today' | 'later' | 'none';

/** Classify a due date against today. Pure so the boundary cases are testable
 *  without waiting for midnight. */
export function dueState(due: string, today: string): DueState {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'later';
}

/** Local calendar date as `YYYY-MM-DD`. Deliberately local, not UTC: "today"
 *  means the user's today. */
export function localDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Time range shown for an event. An event without a start is an all-day entry
 *  and says so rather than showing an empty column. */
export function eventWhen(event: EventRow): string {
  if (!event.start) return 'All day';
  return event.end ? `${event.start}–${event.end}` : event.start;
}
