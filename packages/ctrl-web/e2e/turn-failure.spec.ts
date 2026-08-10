// Rendered coverage for a failed turn: the failure is a decision fact with a
// recovery action, not a raw error rendered as Irisy's own answer, and no content
// actions are offered on it.
// (ADR-003 frontend § decision-registry v44; ADR-005 §12 U12)

import { test, expect, type Page } from '@playwright/test';

function install(page: Page, options: { failWith: string }): Promise<void> {
  return page.addInitScript((opts) => {
    window.localStorage.clear();
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
      __ctrlStreamAttempts: number;
    };
    harness.__ctrlStreamAttempts = 0;
    harness.__ctrlInvokeMock = (command) => {
      // Count kernel work, not just the streaming call: in a browser harness the
      // turn cannot reach the Tauri streaming transport, so re-invocation of the
      // send path is the observable evidence that a retry really ran.
      if (command !== 'review_pending') harness.__ctrlStreamAttempts += 1;
      if (command === 'brain_status') return { active_brain: 'e2e-model' };
      if (command === 'get_version') return 'e2e';
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'review_pending') return [];
      // The turn transport fails. A provider-shaped message would route to the
      // settings recovery instead, so this is a plain engine failure.
      if (command === 'irisy_chat_stream' || command === 'chat_stream') {
        throw new Error(opts.failWith);
      }
      if (command === 'gate_invoke') {
        // The FCT catalog must answer with a list, otherwise the shell never
        // finishes its first render and no composer exists to drive.
        return [];
      }
      // NOTE: the Work pane may raise its own unavailable decision in this
      // harness. That is why every assertion below is scoped to the Irisy column
      // — each region owns its own decision, and an unscoped locator would
      // collide with an unrelated failure.
      // Unknown commands answer with a benign object rather than null so the turn
      // reaches the streaming call and fails THERE, deterministically, instead of
      // tripping over a missing field on the way.
      return { version: 'e2e', ok: true };
    };
  }, options);
}

const FAILURE = "Cannot read properties of undefined (reading 'transformCallback')";

test('a failed turn reports a recoverable decision instead of speaking as Irisy', async ({
  page,
}) => {
  await install(page, { failWith: FAILURE });
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  await dialog.getByPlaceholder('Ask Irisy…').fill('Summarize the open note');
  await dialog.getByRole('button', { name: 'Send' }).click();

  // Scope to the Irisy column: other panes own their own decisions, so an
  // unscoped locator would collide with an unrelated failure elsewhere.
  const decision = dialog.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await expect(decision).toHaveAttribute('data-decision-intent', 'U12');
  await expect(decision).toContainText('Irisy could not finish this answer.');

  // The raw error is drill-down, never the headline and never a reply. The exact
  // message depends on where the turn broke, so assert the SHAPE: no `Error: …`
  // bubble in the transcript, and the raw text available behind the disclosure.
  await expect(page.getByText(/^Error: /)).toHaveCount(0);
  await decision.getByText('View details').click();
  await expect(decision).toContainText('Reason');
  await expect(decision).toContainText(/Cannot read properties|transformCallback/);

  // Recovery is an action.
  await expect(decision.getByRole('button', { name: 'Try again' })).toBeVisible();

  // No content actions on a failure. Scope to the transcript: the window status
  // bar has its own unrelated Copy control.
  const transcript = dialog.locator('[class*="scroller"]');
  await expect(transcript.getByRole('button', { name: /Copy/ })).toHaveCount(0);
  await expect(transcript.getByRole('button', { name: /Save to a note/ })).toHaveCount(0);
  await expect(transcript.getByRole('button', { name: /Ask my knowledge base/ })).toHaveCount(0);

  // The user's own message is preserved so the request is not lost.
  await expect(dialog).toContainText('Summarize the open note');
});

test('Try again re-runs the request', async ({ page }) => {
  await install(page, { failWith: FAILURE });
  await page.goto('/');
  const dialog = page.getByLabel('Persistent agent dialog');
  await dialog.getByPlaceholder('Ask Irisy…').fill('Summarize the open note');
  await dialog.getByRole('button', { name: 'Send' }).click();

  // Scope to the Irisy column: other panes own their own decisions, so an
  // unscoped locator would collide with an unrelated failure elsewhere.
  const decision = dialog.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  const before = await page.evaluate(
    () => (window as unknown as { __ctrlStreamAttempts: number }).__ctrlStreamAttempts,
  );
  expect(before).toBeGreaterThan(0);

  await decision.getByRole('button', { name: 'Try again' }).click();
  // Retry re-runs the send path — evidenced by fresh kernel activity plus a fresh
  // failure decision. Dismiss (below) does neither, which is the contrast that
  // makes this meaningful.
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __ctrlStreamAttempts: number }).__ctrlStreamAttempts,
        ),
      { timeout: 5000 },
    )
    .toBeGreaterThan(before);
  await expect(dialog.locator('[data-decision-kind="unavailable"]')).toBeVisible();
});

test('Dismiss closes the failure without retrying', async ({ page }) => {
  await install(page, { failWith: FAILURE });
  await page.goto('/');
  const dialog = page.getByLabel('Persistent agent dialog');
  await dialog.getByPlaceholder('Ask Irisy…').fill('Summarize the open note');
  await dialog.getByRole('button', { name: 'Send' }).click();

  // Scope to the Irisy column: other panes own their own decisions, so an
  // unscoped locator would collide with an unrelated failure elsewhere.
  const decision = dialog.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  const before = await page.evaluate(
    () => (window as unknown as { __ctrlStreamAttempts: number }).__ctrlStreamAttempts,
  );
  await decision.getByRole('button', { name: 'Dismiss' }).click();
  await expect(dialog.locator('[data-decision-kind]')).toHaveCount(0);
  // Dismiss is not a retry: no new kernel work and no new decision.
  await page.waitForTimeout(300);
  const after = await page.evaluate(
    () => (window as unknown as { __ctrlStreamAttempts: number }).__ctrlStreamAttempts,
  );
  expect(after).toBe(before);
});
