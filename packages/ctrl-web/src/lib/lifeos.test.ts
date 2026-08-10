// Tasks and calendar projections. The boundary cases here are the ones a user
// notices: an overdue task must not read as upcoming, and an all-day event must
// not render as a blank time.
// (ADR-002 substrate §14.13; ADR-005 irisy §12 v42 U5)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeTask,
  dueState,
  eventWhen,
  localDate,
  setEventField,
  taskResourceRef,
  type EventRow,
} from './lifeos';

const invokeMock = vi.fn();

vi.mock('./bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
});

const event = (overrides: Partial<EventRow> = {}): EventRow => ({
  path: 'Calendar/2026-08-05.md',
  title: 'Review',
  date: '2026-08-05',
  start: '',
  end: '',
  location: '',
  tags: [],
  ...overrides,
});

describe('dueState', () => {
  it('separates overdue from today so a late task cannot read as upcoming', () => {
    expect(dueState('2026-08-04', '2026-08-05')).toBe('overdue');
    expect(dueState('2026-08-05', '2026-08-05')).toBe('today');
    expect(dueState('2026-08-06', '2026-08-05')).toBe('later');
  });

  it('reports no due date as none rather than as overdue', () => {
    expect(dueState('', '2026-08-05')).toBe('none');
  });
});

describe('localDate', () => {
  it('formats the user’s local calendar day, zero padded', () => {
    expect(localDate(new Date(2026, 0, 9, 23, 30))).toBe('2026-01-09');
  });

  it('does not shift the day across a late-evening local time', () => {
    // A UTC-based implementation would report the next day here in +hours zones.
    const late = new Date(2026, 7, 5, 23, 59);
    expect(localDate(late)).toBe('2026-08-05');
  });
});

describe('eventWhen', () => {
  it('says All day when the event has no start', () => {
    expect(eventWhen(event())).toBe('All day');
  });

  it('shows a range when both ends are known', () => {
    expect(eventWhen(event({ start: '09:00', end: '10:00' }))).toBe('09:00–10:00');
  });

  it('shows just the start when there is no end, rather than a dangling dash', () => {
    expect(eventWhen(event({ start: '09:00' }))).toBe('09:00');
  });
});

describe('task writes through the canonical verb', () => {
  it('encodes each note path segment so a separator stays a separator', () => {
    expect(taskResourceRef('daily/2026-08-05.md')).toBe(
      'ctrl://local/task/daily/2026-08-05.md',
    );
    expect(taskResourceRef('Work notes/My tasks.md')).toBe(
      'ctrl://local/task/Work%20notes/My%20tasks.md',
    );
  });

  it('conditions the write on the revision it just read and never guesses one', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    invokeMock.mockImplementation((_command: string, payload: unknown) => {
      const call = payload as { tool: string; args: Record<string, unknown> };
      calls.push(call);
      if (call.tool === 'describe') {
        return Promise.resolve({ freshness: { revision: 'rev-seen' }, presentation: {} });
      }
      return Promise.resolve({
        effect: { summary: 'set status', verified_by: 'reread' },
        result: { revision: 'rev-next' },
      });
    });

    const result = await completeTask({
      path: 'Inbox.md',
      line: 2,
      title: 'Pay the invoice',
      status: 'todo',
      due: '',
      done: '',
      tags: [],
    });
    expect(result.kind).toBe('verified');
    const write = calls.find((call) => call.tool === 'produce');
    expect(write!.args).toMatchObject({
      ref: 'ctrl://local/task/Inbox.md',
      operation: {
        kind: 'set_field',
        expected_revision: 'rev-seen',
        line: 2,
        field: 'status',
        value: 'done',
      },
    });
  });

  /// Without a revision there is nothing safe to write against.
  it('reports a note that gave no revision instead of writing blind', async () => {
    invokeMock.mockResolvedValue({ freshness: {}, presentation: {} });
    const result = await completeTask({
      path: 'Inbox.md',
      line: 2,
      title: 'Pay the invoice',
      status: 'todo',
      due: '',
      done: '',
      tags: [],
    });
    expect(result).toMatchObject({ kind: 'failed', code: 'unavailable' });
    expect(
      invokeMock.mock.calls.some(
        ([, payload]) => (payload as { tool?: string } | undefined)?.tool === 'produce',
      ),
    ).toBe(false);
  });
});

describe('calendar event writes', () => {
  it('addresses an event by its note, not by a row index from an earlier scan', async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    invokeMock.mockImplementation((_command: string, payload: unknown) => {
      const call = payload as { tool: string; args: Record<string, unknown> };
      calls.push(call);
      if (call.tool === 'describe') {
        return Promise.resolve({ freshness: { revision: 'rev-seen' }, presentation: {} });
      }
      return Promise.resolve({
        effect: { summary: 'set location', verified_by: 'reread' },
        result: { revision: 'rev-next' },
      });
    });

    const result = await setEventField(
      event({ path: 'calendar/2026-08-05-standup.md' }),
      'location',
      'Room 3',
    );
    expect(result.kind).toBe('verified');
    const write = calls.find((call) => call.tool === 'produce');
    expect(write!.args).toMatchObject({
      ref: 'ctrl://local/calendar/calendar/2026-08-05-standup.md',
      operation: {
        kind: 'set_field',
        expected_revision: 'rev-seen',
        field: 'location',
        value: 'Room 3',
      },
    });
    // No row index travels: position is not identity.
    expect((write!.args.operation as Record<string, unknown>).row).toBeUndefined();
  });
});
