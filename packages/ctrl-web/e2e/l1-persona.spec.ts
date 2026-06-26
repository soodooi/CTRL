import { test, expect } from '@playwright/test';

// Functional verification for the 2026-06-26 L1/composer changes:
//   1. The row above the composer IS the persona switcher (not inline ops).
//   2. Switching a persona flips the active state.
//   3. L1 is one unified list — built-in faces render as pack entries.
//
// Tauri invoke() no-ops in browser dev mode, so installed packs (dev-box /
// ghostfolio) don't load here; built-in faces + the persona row need no
// invoke, so they are the functional surface this spec asserts.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
    } catch {
      // private mode — irrelevant for chromium
    }
  });
});

test('persona row above the composer = the 3 personas, no inline-op chips', async ({
  page,
}) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: 'Irisy persona' });
  await expect(group).toBeVisible();

  await expect(group.getByRole('button', { name: 'Knowledge Base' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Code Companion' })).toBeVisible();
  await expect(group.getByRole('button', { name: 'Tool Maker' })).toBeVisible();

  // Translate / Polish / Summarize are inline Irisy ops, not personas — they
  // must NOT occupy this slot (philosophy #5).
  await expect(group.getByRole('button', { name: 'Translate' })).toHaveCount(0);
  await expect(group.getByRole('button', { name: 'Polish' })).toHaveCount(0);
  await expect(group.getByRole('button', { name: 'Summarize' })).toHaveCount(0);
});

test('clicking a persona switches the active persona', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: 'Irisy persona' });
  const code = group.getByRole('button', { name: 'Code Companion' });

  // Exactly one persona is active at a time.
  await expect(group.getByRole('button', { pressed: true })).toHaveCount(1);

  await code.click();
  await expect(code).toHaveAttribute('aria-pressed', 'true');
  await expect(group.getByRole('button', { pressed: true })).toHaveCount(1);
});

test('L1 is one list — built-in faces render as entries', async ({ page }) => {
  await page.goto('/');
  // The L1 rail lives in AmbientHome's <aside>; icon-only buttons carry a
  // title (= accessible name). Built-in faces render with no invoke.
  await expect(page.getByRole('button', { name: 'Notes' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tables' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Coding' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/l1-persona-home.png', fullPage: false });
});

test('opening an L1 entry shows it as the context above Irisy', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('group', { name: 'Irisy persona' });
  // No context chip until something is open.
  await expect(group.locator('[title^="Working in"]')).toHaveCount(0);
  // Open the Notes face from L1 — the persona row reflects what's open
  // (bao 2026-06-26: role + the corresponding pack above Irisy).
  await page.getByRole('button', { name: 'Notes' }).first().click();
  await expect(group.locator('[title="Working in Notes"]')).toBeVisible();
});
