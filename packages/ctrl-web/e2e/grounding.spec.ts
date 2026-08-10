// Grounding in the opened Resource — UI half of U1.
//
// The contract that the turn actually CARRIES the opened Resource is asserted
// directly in `src/lib/irisy-turn.test.ts`; the streaming transport sets up Tauri
// event listeners that cannot exist in a browser, so it is not drivable here and
// this spec does not pretend to drive it.
//
// What this spec proves is the other half, which is equally load-bearing: the
// Resource the user believes is open really is open, its content came through the
// governed read rather than some side channel, and its identity is on screen so
// the user can check what an answer was grounded in.
// (ADR-002 substrate §15 v83; ADR-005 irisy §11 v40, §12 v42 U1)

import { test, expect, type Page } from '@playwright/test';

const NOTE_REF = 'ctrl://local/note/Budget.md';

function installShellMock(page: Page): Promise<void> {
  return page.addInitScript((ref) => {
    window.localStorage.clear();
    window.localStorage.setItem(
      'ctrl:irisy-sessions:v1',
      JSON.stringify({
        version: 2,
        state: {
          activeSessionId: 'session-a',
          sessions: [
            {
              id: 'session-a',
              label: 'Grounded',
              createdAt: 1,
              lastActiveAt: 1,
              resources: [ref],
              messages: [],
            },
          ],
        },
      }),
    );

    const reads: string[] = [];
    (window as unknown as { __reads: string[] }).__reads = reads;

    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'gate_invoke') {
        const call = args as {
          tool?: string;
          args?: { ref?: string; request?: { operation?: string } };
        };
        if (call.tool === 'describe' && call.args?.ref === ref) {
          reads.push('describe');
          return {
            protocol_version: '1',
            resource: ref,
            content_type: 'text/markdown',
            provenance: [],
            freshness: { revision: 'rev-1', observed_at: '2026-08-05T10:00:00Z', stale: false },
            degradation: null,
            presentation: { viewer: 'markdown', title: 'Budget.md', preferred_columns: [] },
            produce: [],
          };
        }
        if (call.tool === 'query' && call.args?.ref === ref) {
          reads.push('query');
          return {
            resource: ref,
            revision: 'rev-1',
            content: '# Budget\n\nRevenue is up nine percent.\n',
            content_type: 'text/markdown',
          };
        }
        if (call.tool === 'query' && call.args?.request?.operation === 'list') return [];
        if (call.tool === 'vault_list') return [];
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
      // No provider is bound. Stated explicitly rather than left to a fallback,
      // because "no provider" is the state the last test asserts.
      if (command === 'get_active_providers') return { roles: {} };
      if (command === 'get_version') return 'e2e';
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      return [];
    };
  }, NOTE_REF);
}

test('the Resource the session owns is really open, read through the governed path', async ({
  page,
}) => {
  await installShellMock(page);
  await page.goto('/');

  // Its content is on screen, and it came from the canonical read verbs.
  await expect(page.locator('.ProseMirror').first()).toContainText(
    'Revenue is up nine percent.',
  );
  const reads = await page.evaluate(
    () => (window as unknown as { __reads: string[] }).__reads,
  );
  expect(reads).toContain('describe');
  expect(reads).toContain('query');
});

test('the opened Resource states its identity so an answer can be checked against it', async ({
  page,
}) => {
  await installShellMock(page);
  await page.goto('/');

  const strip = page.getByTestId('provenance-drilldown');
  await expect(strip).toContainText(NOTE_REF);
  await strip.locator('summary').click();
  // Revision and observation time are what make "is this what I asked about"
  // answerable rather than a matter of trust.
  await expect(strip).toContainText('rev-1');
  await expect(strip).toContainText('2026-08-05T10:00:00Z');
});

test('a turn that cannot run says so instead of answering from memory', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const composer = page.getByRole('textbox', { name: 'Ask Irisy…' });
  await composer.fill('What does this say about revenue?');
  await composer.press('Enter');

  const dialog = page.getByLabel('Persistent agent dialog');
  // The user's words are kept, so the request is not lost.
  await expect(dialog).toContainText('What does this say about revenue?');

  // The failure is a typed, recoverable decision — never a sentence in Irisy's
  // voice, and never a plausible answer assembled from the model's memory.
  const decision = dialog.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('Irisy could not finish this answer.');
  await expect(decision.getByRole('button', { name: 'Try again' })).toBeVisible();
  // The opened Resource's content is rendered in the Work pane, and Irisy did not
  // repeat it back as if it had read and reasoned over it.
  await expect(dialog).not.toContainText('Revenue is up nine percent');
});
