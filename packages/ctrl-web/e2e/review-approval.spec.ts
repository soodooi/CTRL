// Rendered coverage for the approval decision in the shipped shell.
//
// `ReviewGateHost` seeds parked reviews through `invoke('review_pending')`, which
// the harness mocks, so this drives the REAL component: fact rendering, the
// non-committing default focus, Esc/backdrop denying, and the honest no-preview
// state. (ADR-003 frontend §8.5 v44; ADR-005 §12 U10)

import { test, expect, type Page } from '@playwright/test';

interface PendingReview {
  id: string;
  caller: string;
  tool: string;
  arg_summary: string;
  outcome?: {
    resource: string;
    target?: string;
    before: string;
    after: string;
    preconditions?: { label: string; value: string }[];
  };
}

function install(page: Page, pending: PendingReview[]): Promise<void> {
  return page.addInitScript((seed) => {
    window.localStorage.clear();
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
      __ctrlResolved: { id: string; approved: boolean }[];
    };
    harness.__ctrlResolved = [];
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'review_pending') return seed;
      if (command === 'review_resolve') {
        harness.__ctrlResolved.push(args as { id: string; approved: boolean });
        return null;
      }
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'get_version') return 'e2e';
      if (command === 'gate_invoke') return null;
      return null;
    };
  }, pending);
}

const staged: PendingReview = {
  id: 'rv-1',
  caller: 'hermes',
  tool: 'produce',
  arg_summary: '{"ref":"ctrl://local/note/daily/today.md"}',
  outcome: {
    resource: 'ctrl://local/note/daily/today.md',
    target: 'today.md',
    before: 'This note tracks the quarterly budget.',
    after: 'Quarterly budget tracker.',
    preconditions: [{ label: 'Revision', value: 'rev-0182' }],
  },
};

test('a staged write shows what changes, with focus parked on Deny', async ({ page }) => {
  await install(page, [staged]);
  await page.goto('/');

  const decision = page.locator('[data-decision-kind="approval"]');
  await expect(decision).toBeVisible();
  await expect(decision).toHaveAttribute('data-decision-intent', 'U10');

  // The user sees the target and the actual change, not just a tool name.
  await expect(decision).toContainText('today.md');
  await expect(decision).toContainText('This note tracks the quarterly budget.');
  await expect(decision).toContainText('Quarterly budget tracker.');
  await expect(decision).toContainText('rev-0182');

  // Internal call identity stays visible as fact, never as the headline.
  await expect(decision).toContainText('produce');

  // A stray Enter must not approve: focus starts on the non-committing option.
  await expect(page.getByRole('button', { name: 'Deny' })).toBeFocused();
});

test('Escape denies rather than silently dismissing', async ({ page }) => {
  await install(page, [staged]);
  await page.goto('/');
  await expect(page.locator('[data-decision-kind="approval"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-decision-kind="approval"]')).toHaveCount(0);
  const resolved = await page.evaluate(
    () => (window as unknown as { __ctrlResolved: unknown[] }).__ctrlResolved,
  );
  expect(resolved).toEqual([{ id: 'rv-1', approved: false }]);
});

test('approving sends exactly one approval for that request', async ({ page }) => {
  await install(page, [staged]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.locator('[data-decision-kind="approval"]')).toHaveCount(0);
  const resolved = await page.evaluate(
    () => (window as unknown as { __ctrlResolved: unknown[] }).__ctrlResolved,
  );
  expect(resolved).toEqual([{ id: 'rv-1', approved: true }]);
});

test('an operation that staged nothing says so instead of implying a preview', async ({ page }) => {
  await install(page, [{ ...staged, id: 'rv-2', outcome: undefined }]);
  await page.goto('/');
  const decision = page.locator('[data-decision-kind="approval"]');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('none — this operation did not stage a change');
  await expect(decision).not.toContainText('Before');
});

test('queued reviews are counted, not dropped', async ({ page }) => {
  await install(page, [staged, { ...staged, id: 'rv-3' }]);
  await page.goto('/');
  const decision = page.locator('[data-decision-kind="approval"]');
  await expect(decision).toContainText('+1 more waiting');
  await page.getByRole('button', { name: 'Deny' }).click();
  await expect(decision).toBeVisible();
  await expect(decision).not.toContainText('more waiting');
});
