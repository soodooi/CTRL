// Sources — real-path UI verification for U3, U4, and U7.
//
// All three were unserved for the same reason: nothing showed a user where an
// answer came from. These tests drive the shipped data-supply surface and assert
// the rules that make it trustworthy: every passage is cited to its note, opening
// a hit makes it the session's Work Resource, a local search never sends a web
// request, and an external lookup names the provider that answered.
// (ADR-002 substrate §1.9 v46; ADR-005 irisy §12 v42 U3/U4/U7)

import { test, expect, type Page } from '@playwright/test';

interface MockOptions {
  /** Local search fails. */
  localFails?: boolean;
  /** Kernel answers with the back-compat shape (plain path strings). */
  plainPaths?: boolean;
  /** External lookup degraded to a keyless provider. */
  degraded?: boolean;
}

const NOTE_PATH = 'Notes/Budget.md';
const NOTE_REF = 'ctrl://local/note/Notes/Budget.md';

function installShellMock(page: Page, options: MockOptions = {}): Promise<void> {
  return page.addInitScript(
    (opts) => {
      window.localStorage.clear();
      const calls: string[] = [];
      (window as unknown as { __calls: string[] }).__calls = calls;

      const harness = window as unknown as {
        __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
      };
      harness.__ctrlInvokeMock = (command, args) => {
        if (command === 'gate_invoke') {
          const call = args as {
            tool?: string;
            args?: { ref?: string; request?: { operation?: string } };
          };
          if (call.tool === 'vault_search') {
            calls.push('vault_search');
            if (opts.localFails) throw new Error('the vault index is rebuilding');
            if (opts.plainPaths) return [opts.notePath];
            return [
              { path: opts.notePath, context: '…revenue rose nine percent this quarter…' },
              { path: 'Notes/Orphan.md' },
            ];
          }
          if (call.tool === 'web_search') {
            calls.push('web_search');
            return {
              source: opts.degraded ? 'duckduckgo' : 'tavily',
              note: opts.degraded ? 'no keyed provider configured' : '',
              results: [
                {
                  title: 'Quarterly revenue report',
                  url: 'https://example.test/report',
                  snippet: 'Revenue rose across the sector.',
                },
                // No URL: cannot be checked, so it must not be shown.
                { title: 'Trust me', snippet: 'no link' },
              ],
            };
          }
          if (call.tool === 'describe' && call.args?.ref === opts.noteRef) {
            return {
              protocol_version: '1',
              resource: opts.noteRef,
              content_type: 'text/markdown',
              provenance: [],
              freshness: { revision: 'rev-1', observed_at: null, stale: false },
              degradation: null,
              presentation: { viewer: 'markdown', title: 'Budget.md', preferred_columns: [] },
              produce: [],
            };
          }
          if (call.tool === 'query' && call.args?.ref === opts.noteRef) {
            return {
              resource: opts.noteRef,
              revision: 'rev-1',
              content: '# Budget\n\nRevenue rose nine percent.\n',
              content_type: 'text/markdown',
            };
          }
          if (call.tool === 'query' && call.args?.request?.operation === 'list') return [];
          if (call.tool === 'task_query') return { rows: [] };
          if (call.tool === 'calendar_query') return { rows: [] };
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
        if (command === 'get_version') return 'e2e';
        if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
        return [];
      };
    },
    { ...options, notePath: NOTE_PATH, noteRef: NOTE_REF },
  );
}

const search = async (page: Page, text: string): Promise<void> => {
  await page.getByRole('textbox', { name: 'Search your notes' }).fill(text);
  await page.getByRole('button', { name: 'Search notes' }).click();
};

test('a local search cites every passage to the note it came from', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');
  await search(page, 'revenue');

  const local = page.getByTestId('sources-local');
  await expect(local).toBeVisible();
  await expect(local).toContainText(NOTE_PATH);
  await expect(local).toContainText('revenue rose nine percent this quarter');
  // A hit without a passage says so rather than showing an unsourced quote.
  await expect(local).toContainText('Notes/Orphan.md');
  await expect(local).toContainText('no passage was returned');

  // Searching notes never leaves the machine.
  const calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
  expect(calls).toContain('vault_search');
  expect(calls).not.toContain('web_search');
});

test('opening a hit makes it the session Work Resource', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');
  await search(page, 'revenue');

  await page.getByTestId('sources-local').getByRole('button', { name: NOTE_PATH }).click();

  // The note is now open in the Work pane through the canonical Resource path.
  await expect(page.getByTestId('provenance-drilldown')).toContainText(NOTE_REF);
  await expect(page.locator('.ProseMirror').first()).toContainText(
    'Revenue rose nine percent.',
  );
});

test('the back-compat reply shape still yields an openable citation', async ({ page }) => {
  await installShellMock(page, { plainPaths: true });
  await page.goto('/');
  await search(page, 'revenue');

  const local = page.getByTestId('sources-local');
  await expect(local).toContainText(NOTE_PATH);
  await expect(local.getByRole('button', { name: NOTE_PATH })).toBeEnabled();
});

test('an external lookup is a separate act and names the provider that answered', async ({
  page,
}) => {
  await installShellMock(page);
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search your notes' }).fill('revenue');

  // Nothing has left the machine yet.
  let calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
  expect(calls).not.toContain('web_search');

  await page.getByRole('button', { name: 'Look up on the web' }).click();

  const external = page.getByTestId('sources-external');
  await expect(external).toContainText('answered by tavily');
  await expect(external).toContainText('Quarterly revenue report');
  await expect(external).toContainText('example.test');
  // A result with no URL cannot be checked, so it is not offered as a source.
  await expect(external).not.toContainText('Trust me');

  calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
  expect(calls).toContain('web_search');
});

test('a degraded lookup says which provider answered and why', async ({ page }) => {
  await installShellMock(page, { degraded: true });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search your notes' }).fill('revenue');
  await page.getByRole('button', { name: 'Look up on the web' }).click();

  const external = page.getByTestId('sources-external');
  await expect(external).toContainText('answered by duckduckgo');
  await expect(external).toContainText('no keyed provider configured');
});

test('a failed local search is recoverable and shows the kernel reason', async ({ page }) => {
  await installShellMock(page, { localFails: true });
  await page.goto('/');
  await search(page, 'revenue');

  const decision = page.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('Your notes could not be searched.');
  const reason = decision.getByText('the vault index is rebuilding');
  await expect(reason).toBeHidden();
  await decision.getByText('View details').click();
  await expect(reason).toBeVisible();
  await expect(decision.getByRole('button', { name: 'Try again' })).toBeVisible();
});
