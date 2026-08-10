// Transcript recovery — real-path UI verification for U13.
//
// The canonical session store is the sole transcript authority, and the claim
// that a user can "continue, revisit, or branch earlier work" had no runnable
// check across a reload: nothing proved a transcript survives a restart, that
// switching tabs restores the right one, or that a `streaming` message from a
// crashed turn comes back inert rather than stuck mid-stream.
// (ADR-003 frontend §8.6 v40; ADR-005 irisy §11 v40, §12 v42 U13)

import { test, expect, type Page } from '@playwright/test';

const SESSIONS_KEY = 'ctrl:irisy-sessions:v1';

function installShellMock(page: Page): Promise<void> {
  return page.addInitScript((key) => {
    // Seed ONCE. This script also runs on reload, and re-seeding would reset the
    // very state these tests are checking survives a restart.
    const seeded = window.localStorage.getItem('e2e:seeded') === 'yes';
    if (!seeded) {
      window.localStorage.clear();
      window.localStorage.setItem('e2e:seeded', 'yes');
      window.localStorage.setItem(
      key,
      JSON.stringify({
        version: 2,
        state: {
          activeSessionId: 'session-a',
          sessions: [
            {
              id: 'session-a',
              label: 'Budget work',
              createdAt: 1,
              lastActiveAt: 2,
              resources: [],
              messages: [
                { id: 'm1', role: 'user', content: 'Summarize the budget' },
                { id: 'm2', role: 'assistant', content: 'Revenue is up nine percent.' },
                // A turn that died mid-stream. It must come back inert.
                { id: 'm3', role: 'assistant', content: 'Partial answer', streaming: true },
              ],
            },
            {
              id: 'session-b',
              label: 'Trip plan',
              createdAt: 1,
              lastActiveAt: 1,
              resources: [],
              messages: [{ id: 'm4', role: 'user', content: 'Plan the trip' }],
            },
          ],
        },
      }),
      );
    }

    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command) => {
      if (command === 'coding_launcher_status') {
        return {
          workspaces: [],
          terminals: [],
          editors: [],
          opencodeAvailable: false,
          launchCommand: null,
        };
      }
      if (command === 'get_version') return 'e2e';
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      return [];
    };
  }, SESSIONS_KEY);
}

test('a transcript survives a full reload and comes back inert', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  await expect(dialog).toContainText('Summarize the budget');
  await expect(dialog).toContainText('Revenue is up nine percent.');

  // Reload: the store, not the runtime, is the authority.
  await page.reload();
  await expect(dialog).toContainText('Summarize the budget');
  await expect(dialog).toContainText('Revenue is up nine percent.');
  await expect(dialog).toContainText('Partial answer');

  // Nothing claims to still be generating after a restart.
  await expect(dialog.getByRole('button', { name: 'Stop generating' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Send' })).toBeVisible();
});

test('switching tabs restores each transcript, not a merged one', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  const sessions = dialog.getByRole('tablist', { name: 'Irisy sessions' });
  await expect(sessions.getByRole('tab')).toHaveCount(2);

  await sessions.getByRole('tab', { name: /Trip plan/ }).click();
  await expect(dialog).toContainText('Plan the trip');
  await expect(dialog).not.toContainText('Summarize the budget');

  await sessions.getByRole('tab', { name: /Budget work/ }).click();
  await expect(dialog).toContainText('Summarize the budget');
  await expect(dialog).not.toContainText('Plan the trip');
});

test('the restored active session is the one the user left open', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  const sessions = dialog.getByRole('tablist', { name: 'Irisy sessions' });
  await sessions.getByRole('tab', { name: /Trip plan/ }).click();
  await expect(dialog).toContainText('Plan the trip');

  await page.reload();
  // Reopening lands where the user was, not on the first tab.
  await expect(dialog).toContainText('Plan the trip');
  await expect(dialog).not.toContainText('Summarize the budget');
});

test('a new session starts empty without disturbing the stored one', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  await dialog.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(dialog).not.toContainText('Summarize the budget');

  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SESSIONS_KEY);
  // Branching adds; it never rewrites the transcript the user came from.
  expect(stored).toContain('Summarize the budget');
  expect(stored).toContain('Plan the trip');
});
