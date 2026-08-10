// Tasks and calendar — real-path UI verification for U5.
//
// Both record sources were queryable through the gate with no user surface, so
// the Work pane was empty when no Resource was open. These tests drive the
// shipped panel: open tasks with overdue distinguished, today's events, and
// completing a task in place through the source's own (note, line) identity.
// (ADR-002 substrate §14.13; ADR-005 irisy §12 v42 U5)

import { test, expect, type Page } from '@playwright/test';

interface MockOptions {
  updateFails?: boolean;
  /** The note moved under the caller, so the addressed line may not be the task. */
  updateConflicts?: boolean;
}

function installShellMock(page: Page, options: MockOptions = {}): Promise<void> {
  return page.addInitScript((opts) => {
    window.localStorage.clear();
    const updates: unknown[] = [];
    (window as unknown as { __updates: unknown[] }).__updates = updates;
    const done = new Set<string>();

    // Deliberately relative to the machine's own today, so the panel's local-date
    // query has something to match without freezing the clock.
    const now = new Date();
    const pad = (value: number) => `${value}`.padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const yesterday = new Date(now.getTime() - 86_400_000);
    const overdue = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(
      yesterday.getDate(),
    )}`;

    const tasks = () =>
      [
        { path: 'Tasks/Inbox.md', line: 3, title: 'Pay invoice', status: 'todo', due: overdue, done: '', tags: [] },
        { path: 'Tasks/Inbox.md', line: 7, title: 'Draft summary', status: 'todo', due: today, done: '', tags: [] },
        { path: 'Tasks/Inbox.md', line: 9, title: 'Someday idea', status: 'todo', due: '', done: '', tags: [] },
      ].filter((task) => !done.has(`${task.path}:${task.line}`));

    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
      __today: string;
      __overdue: string;
    };
    harness.__today = today;
    harness.__overdue = overdue;
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'gate_invoke') {
        const call = args as { tool?: string; args?: Record<string, unknown> };
        if (call.tool === 'task_query') {
          return { rows: tasks(), match_count: tasks().length };
        }
        if (call.tool === 'calendar_query') {
          return {
            rows: [
              {
                path: 'Calendar/Today.md',
                title: 'Standup',
                date: today,
                start: '09:00',
                end: '09:15',
                location: 'Zoom',
                tags: [],
              },
              {
                path: 'Calendar/Today.md',
                title: 'Focus block',
                date: today,
                start: '',
                end: '',
                location: '',
                tags: [],
              },
            ],
            match_count: 2,
          };
        }
        // A task write is a canonical Resource write now: the caller reads the
        // note's revision, then produces one bounded field change and reads the
        // owner's Outcome. (ADR-002 substrate §15.2 v87)
        if (call.tool === 'describe') {
          return {
            protocol_version: '1.0.0',
            resource: String((call.args as { ref?: string }).ref ?? ''),
            content_type: 'application/json',
            freshness: { revision: 'rev-seen', stale: false },
            presentation: { viewer: 'tasks', preferred_columns: [] },
            produce: [{ kind: 'set_field', review_required: true }],
          };
        }
        if (call.tool === 'produce') {
          const write = call.args as { ref?: string; operation?: Record<string, unknown> };
          updates.push({ ref: write.ref, ...(write.operation ?? {}) });
          if (opts.updateFails) {
            return {
              resource: write.ref,
              feedback: {
                code: 'write_unverified',
                message: 'the note is locked by another writer',
                severity: 'error',
                retryable: true,
                details: {},
              },
            };
          }
          if (opts.updateConflicts) {
            return {
              resource: write.ref,
              feedback: {
                code: 'precondition_failed',
                message: 'the note changed since it was read, so nothing was written',
                severity: 'error',
                retryable: true,
                details: { expected_revision: 'rev-seen', current_revision: 'rev-moved' },
              },
            };
          }
          const line = Number((write.operation ?? {}).line);
          const note = String(write.ref ?? '').replace('ctrl://local/task/', '');
          done.add(`${note}:${line}`);
          return {
            resource: write.ref,
            effect: {
              summary: 'set status',
              verified_by: 'post-write reread returned the new value',
            },
            result: { revision: 'rev-next' },
          };
        }
        if (call.tool === 'query') return [];
        return null;
      }
      if (command === 'coding_launcher_status') {
        return {
          workspaces: [],
          terminals: [],
          editors: [],
          opencodeAvailable: false,
          launchCommand: null,
        };
      }
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'get_version') return 'e2e';
      return null;
    };
  }, options);
}

test('the Work pane shows open tasks and today’s schedule instead of nothing', async ({
  page,
}) => {
  await installShellMock(page);
  await page.goto('/');

  const tasks = page.getByTestId('today-tasks');
  await expect(tasks).toBeVisible();
  await expect(tasks).toContainText('Pay invoice');
  await expect(tasks).toContainText('Draft summary');
  await expect(tasks).toContainText('Someday idea');

  // Overdue is visibly different from a date that is merely set.
  const overdue = await page.evaluate(
    () => (window as unknown as { __overdue: string }).__overdue,
  );
  await expect(tasks).toContainText(`overdue ${overdue}`);
  await expect(tasks.locator('[data-due="overdue"]').first()).toBeVisible();
  await expect(tasks.locator('[data-due="today"]').first()).toBeVisible();

  const events = page.getByTestId('today-events');
  await expect(events).toContainText('09:00–09:15');
  await expect(events).toContainText('Standup');
  await expect(events).toContainText('Zoom');
  // An event without a start reads as all day, not as a blank column.
  await expect(events).toContainText('All day');
});

test('completing a task writes it in place and refetches the vault', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const tasks = page.getByTestId('today-tasks');
  await tasks.getByRole('button', { name: 'Complete Pay invoice' }).click();

  // Addressed by note and line — the task's real identity in Markdown.
  const updates = await page.evaluate(
    () => (window as unknown as { __updates: Record<string, unknown>[] }).__updates,
  );
  expect(updates).toEqual([
    {
      ref: 'ctrl://local/task/Tasks/Inbox.md',
      kind: 'set_field',
      // Conditioned on the revision the caller actually read, so a moved line
      // cannot be written blind.
      expected_revision: 'rev-seen',
      line: 3,
      field: 'status',
      value: 'done',
    },
  ]);

  // The list came back from the source, so the completed row is gone.
  await expect(tasks).not.toContainText('Pay invoice');
  await expect(tasks).toContainText('Draft summary');
});

test('a failed completion reports a recoverable decision and leaves the task open', async ({
  page,
}) => {
  await installShellMock(page, { updateFails: true });
  await page.goto('/');

  const tasks = page.getByTestId('today-tasks');
  await tasks.getByRole('button', { name: 'Complete Pay invoice' }).click();

  const decision = page.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('That task was not completed.');
  await expect(decision.getByRole('button', { name: 'Try again' })).toBeVisible();
  // Nothing was crossed out optimistically.
  await expect(tasks).toContainText('Pay invoice');
});

test('a note that moved underneath reports a conflict and claims nothing was written', async ({
  page,
}) => {
  await installShellMock(page, { updateConflicts: true });
  await page.goto('/');

  const tasks = page.getByTestId('today-tasks');
  await tasks.getByRole('button', { name: 'Complete Pay invoice' }).click();

  const decision = page.locator('[data-decision-kind="conflict"]');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('the note changed');
  // Both operands are shown, so this reads as a real conflict rather than a
  // vague failure.
  await expect(decision).toContainText('rev-seen');
  await expect(decision).toContainText('rev-moved');
  // The task stays open: nothing was written.
  await expect(tasks).toContainText('Pay invoice');
});
