// Local application connect + explicit selection — real-path UI verification for
// U19 and U22.
//
// The LibreOffice bridge was fully implemented in the kernel and shipped in the
// bundle, yet no user could reach it: bundled connectors are deliberately not
// auto-seeded and nothing offered to connect one. These tests drive the shipped
// Library surface: connect explicitly, then read only what the user selected.
// (ADR-004 cap §1 v13; ADR-002 substrate §14.12; ADR-005 irisy §12 v42 U19/U22)

import { test, expect, type Page } from '@playwright/test';

interface MockOptions {
  /** Rows the connector returns for the explicit selection. */
  rows?: Record<string, string>[];
  /** When set, source_query fails with this message. */
  queryError?: string;
}

function installShellMock(page: Page, options: MockOptions = {}): Promise<void> {
  return page.addInitScript((opts) => {
    window.localStorage.clear();
    let connected = false;
    const calls: string[] = [];
    (window as unknown as { __calls: string[] }).__calls = calls;

    const connector = () => ({
      id: 'ctrl-libreoffice',
      name: 'LibreOffice Companion',
      summary: 'Read the explicit Writer selection or Calc range',
      connected,
      requires: 'LibreOffice',
    });

    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'list_local_app_connectors') {
        calls.push('list');
        return [connector()];
      }
      if (command === 'connect_local_app') {
        calls.push('connect');
        connected = true;
        return connector();
      }
      if (command === 'gate_invoke') {
        const call = args as { tool?: string; args?: { request?: { operation?: string } } };
        if (call.tool === 'source_query') {
          calls.push('source_query');
          if (opts.queryError) throw new Error(opts.queryError);
          return { rows: opts.rows ?? [], match_count: (opts.rows ?? []).length };
        }
        if (call.tool === 'query' && call.args?.request?.operation === 'list') return [];
        return null;
      }
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'get_version') return 'e2e';
      return null;
    };
  }, options);
}

async function openLocalApps(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('tab', { name: 'Installed FCTs' }).click();
  await expect(page.getByLabel('Local apps')).toBeVisible();
}

test('a local app is offered but not connected until the user says so', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');
  await openLocalApps(page);

  const card = page.locator('[data-connector="ctrl-libreoffice"]');
  await expect(card).toContainText('Needs LibreOffice · Not connected');
  // Nothing is read before a connection exists.
  await expect(card.getByRole('button', { name: 'Read selection' })).toHaveCount(0);

  let calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
  expect(calls).not.toContain('connect');

  await card.getByRole('button', { name: 'Connect' }).click();
  await expect(card).toContainText('Needs LibreOffice · Connected');

  calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
  expect(calls.filter((entry) => entry === 'connect')).toHaveLength(1);
});

test('reading the explicit selection shows only what was selected', async ({ page }) => {
  await installShellMock(page, {
    rows: [
      {
        document_id: 'Budget.ods',
        document_type: 'calc',
        selection_kind: 'range',
        target: 'A1:C4',
        revision: 'rev-7',
        content: '1,2,3',
        formulas: '=SUM(A1:A3)',
        content_hash: 'abc123',
      },
    ],
  });
  await page.goto('/');
  await openLocalApps(page);

  const card = page.locator('[data-connector="ctrl-libreoffice"]');
  await card.getByRole('button', { name: 'Connect' }).click();
  await card.getByRole('button', { name: 'Read selection' }).click();

  const selection = page.getByTestId('local-app-selection');
  await expect(selection).toBeVisible();
  // The selection is identified, not just pasted: document, range, revision.
  await expect(selection).toContainText('Budget.ods');
  await expect(selection).toContainText('A1:C4');
  await expect(selection).toContainText('rev-7');
  await expect(selection).toContainText('=SUM(A1:A3)');

  // Handing it to the session prefills the composer instead of fabricating a turn.
  await selection.getByRole('button', { name: 'Use in this session' }).click();
  const composer = page.getByRole('textbox', { name: 'Ask Irisy…' });
  await expect(composer).toHaveValue(/Selection from LibreOffice Companion/);
  await expect(composer).toHaveValue(/Target: A1:C4/);
  await expect(page.getByText('LibreOffice Companion', { exact: false }).first()).toBeVisible();
});

test('nothing selected is a recoverable state, not an error', async ({ page }) => {
  await installShellMock(page, { rows: [] });
  await page.goto('/');
  await openLocalApps(page);

  const card = page.locator('[data-connector="ctrl-libreoffice"]');
  await card.getByRole('button', { name: 'Connect' }).click();
  await card.getByRole('button', { name: 'Read selection' }).click();

  const decision = page.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('nothing selected to read');
  // Retry is the action that actually resolves it once a selection exists.
  await expect(decision.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByTestId('local-app-selection')).toHaveCount(0);
});

test('a failing read reports the connector reason as drill-down, not as the headline', async ({
  page,
}) => {
  await installShellMock(page, {
    queryError: 'Enable CTRL Companion in LibreOffice, then retry.',
  });
  await page.goto('/');
  await openLocalApps(page);

  const card = page.locator('[data-connector="ctrl-libreoffice"]');
  await card.getByRole('button', { name: 'Connect' }).click();
  await card.getByRole('button', { name: 'Read selection' }).click();

  const decision = page.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  // Collapsed disclosure content stays in the DOM, so assert on visibility: the
  // headline is the outcome and the connector's own wording is drill-down.
  const reason = decision.getByText('Enable CTRL Companion in LibreOffice, then retry.');
  await expect(reason).toBeHidden();
  await decision.getByText('View details').click();
  await expect(reason).toBeVisible();
});
