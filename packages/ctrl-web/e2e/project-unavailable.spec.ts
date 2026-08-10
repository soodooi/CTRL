// Rendered coverage for U9's failure surface: the project pane no longer makes a
// raw loader error its headline, and its recovery is a real action.
// (ADR-003 frontend § decision-registry v44; ADR-005 §12 U9/U12)

import { test, expect, type Page } from '@playwright/test';

const RAW = "Cannot read properties of null (reading 'workspaces')";

function install(page: Page, options: { failTimes: number }): Promise<void> {
  return page.addInitScript((opts) => {
    window.localStorage.clear();
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
      __statusCalls: number;
    };
    harness.__statusCalls = 0;
    harness.__ctrlInvokeMock = (command) => {
      if (command === 'coding_launcher_status') {
        harness.__statusCalls += 1;
        if (harness.__statusCalls <= opts.failTimes) {
          throw new Error("Cannot read properties of null (reading 'workspaces')");
        }
        return { root: '/tmp/demo', workspaces: [], targets: [], open_code: null };
      }
      if (command === 'get_version') return 'e2e';
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'review_pending') return [];
      if (command === 'gate_invoke') return [];
      return { version: 'e2e', ok: true };
    };
  }, options);
}

/** Open the Project surface the way a user does: L1 → Work is already active, so
 *  the coding panel is reached through the workspace route. */
async function openProject(page: Page): Promise<void> {
  await page.goto('/coding');
}

test('a failed project load states the problem plainly and keeps the reason as detail', async ({
  page,
}) => {
  await install(page, { failTimes: 99 });
  await openProject(page);

  const decision = page.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('CTRL could not inspect your local projects.');

  // The raw error is not the headline any more. It lives in a collapsed
  // disclosure, so assert it is not VISIBLE rather than absent from the DOM.
  await expect(page.getByRole('heading', { name: 'Project unavailable' })).toHaveCount(0);
  await expect(page.getByText(RAW, { exact: true })).toBeHidden();

  await decision.getByText('View details').click();
  await expect(page.getByText(RAW, { exact: true })).toBeVisible();
  await expect(decision).toContainText("reading 'workspaces'");

  // Nothing sits behind this state, so no dismissal is offered — only recovery.
  await expect(decision.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
  await expect(decision.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('Try again re-reads the project instead of only closing the message', async ({ page }) => {
  // Fail once, then succeed: the retry must reach a loaded pane.
  await install(page, { failTimes: 1 });
  await openProject(page);

  const decision = page.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await decision.getByRole('button', { name: 'Try again' }).click();

  await expect(page.locator('[data-decision-kind="unavailable"]')).toHaveCount(0);
  const calls = await page.evaluate(
    () => (window as unknown as { __statusCalls: number }).__statusCalls,
  );
  expect(calls).toBeGreaterThan(1);
});
