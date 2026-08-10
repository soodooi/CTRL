import { test, expect, type Page } from '@playwright/test';

function installShellMock(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.clear();
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'gate_invoke') {
        const call = args as {
          tool?: string;
          args?: { ref?: string; request?: { operation?: string } };
        };
        if (
          call.tool === 'query'
          && call.args?.ref === 'ctrl://local/system/catalog'
          && call.args.request?.operation === 'list'
        ) {
          return [{
            ref: 'skill:office',
            name: 'Office',
            summary: 'Use office documents',
            source_kind: 'skill',
            install_state: 'available',
            selection_kind: 'selectable',
          }];
        }
        return null;
      }
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'get_version') return 'e2e';
      return null;
    };
  });
}

test.beforeEach(async ({ page }) => {
  await installShellMock(page);
});

test('production shell exposes only canonical L1 and the compact FCT composer', async ({ page }) => {
  await page.goto('/');

  // Use is session-owned and only the normalized FCT projection is user-facing.
  // (ADR-003 frontend §8.5 v41)
  const navigation = page.getByRole('complementary', { name: 'Primary navigation' });
  await expect(navigation.getByRole('button')).toHaveCount(3);
  await expect(navigation.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: 'Library' })).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Settings' })).toBeVisible();

  const dialog = page.getByLabel('Persistent agent dialog');
  const controls = dialog.getByRole('group', { name: 'FCT and turn action' });
  // Auto-first override: the resting control states what the next turn uses and
  // does NOT enumerate the catalogue. (ADR-003 frontend §8.5 v42; U17)
  const selector = controls.getByRole('button', { name: 'FCT' });
  await expect(selector).toHaveText('FCT · Auto');
  await expect(dialog.locator('[data-decision-kind="choice"]')).toHaveCount(0);
  await selector.click();
  const choice = dialog.locator('[data-decision-kind="choice"]');
  await expect(choice.getByRole('button', { name: 'Office' })).toBeVisible();
  await choice.getByRole('button', { name: 'Keep current' }).click();
  await expect(selector).toHaveText('FCT · Auto');
  await expect(controls.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(controls.getByRole('button', { name: 'Stop generating' })).toHaveCount(0);

  await expect(dialog.getByRole('combobox', { name: 'Irisy identity' })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Resource' })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Skill' })).toHaveCount(0);
  await expect(dialog.getByText('Ready', { exact: true })).toHaveCount(0);
  expect(await page.getByText('Irisy', { exact: true }).count()).toBeLessThanOrEqual(1);
});

test('Library separates Find, Installed, and Create from session use', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();

  // Availability and authoring stay in Library; activation stays in Work.
  // (ADR-003 frontend §8.5 v41)
  const modes = page.getByRole('tablist', { name: 'FCT Library mode' });
  await expect(modes.getByRole('tab')).toHaveText(['Find FCTs', 'Installed FCTs', 'Create FCT']);
  await expect(modes.getByRole('tab', { name: 'Find FCTs' })).toHaveAttribute('aria-selected', 'true');

  await modes.getByRole('tab', { name: 'Installed FCTs' }).click();
  await expect(page.getByText('Office', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use FCT' })).toBeVisible();

  await modes.getByRole('tab', { name: 'Create FCT' }).click();
  await expect(page.getByText('✦ Create FCT', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(page.getByText('Find FCTs', { exact: true })).toHaveCount(1);
  await expect(
    page.getByLabel('Persistent agent dialog').getByRole('button', { name: 'FCT' }),
  ).toHaveText('FCT · Auto');

  await page.screenshot({ path: 'test-results/fct-library-create.png', fullPage: false });
});
