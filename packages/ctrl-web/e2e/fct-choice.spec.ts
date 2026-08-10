// Auto-first FCT override — real-path UI verification for U17.
//
// The composer control must state what the next turn will use without turning
// the installed catalogue into ordinary chrome: Auto at rest, an explicitly
// opened bounded panel, and Library for the complete list.
// (ADR-003 frontend §8.5 v42; ADR-005 irisy §12 v42 U17)

import { test, expect, type Page } from '@playwright/test';

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];

function installShellMock(page: Page): Promise<void> {
  return page.addInitScript((names) => {
    window.localStorage.clear();
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'gate_invoke') {
        const call = args as {
          tool?: string;
          args?: { ref?: string; request?: { operation?: string; ref?: string } };
        };
        const request = call.args?.request;
        if (call.tool === 'query' && call.args?.ref === 'ctrl://local/system/catalog') {
          if (request?.operation === 'list') {
            return names.map((name) => ({
              ref: `pack:${name.toLowerCase()}`,
              name,
              summary: `${name} does a thing`,
              source_kind: 'package',
              install_state: 'installed',
              selection_kind: 'selectable',
            }));
          }
          if (request?.operation === 'selection-projection') {
            return {
              ref: request.ref,
              resources: [],
              capability_scope: ['system'],
              policy: 'review-gated-writes',
              install_state: 'installed',
              install_ref: request.ref,
            };
          }
        }
        return null;
      }
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'get_version') return 'e2e';
      return null;
    };
  }, NAMES);
}

test('the resting control states Auto and does not enumerate the catalogue', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  const chip = dialog.getByRole('button', { name: 'FCT' });
  await expect(chip).toHaveText('FCT · Auto');

  // No inventory on screen until the user asks for it.
  await expect(dialog.locator('[data-decision-kind="choice"]')).toHaveCount(0);
  for (const name of NAMES) {
    await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
});

test('the override panel is bounded and defers the rest to Library', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  await dialog.getByRole('button', { name: 'FCT' }).click();

  const choice = dialog.locator('[data-decision-kind="choice"]');
  await expect(choice).toBeVisible();
  await expect(choice).toHaveAttribute('data-decision-intent', 'U17');

  // Five offered, seven installed, and the panel says so rather than hiding it.
  for (const name of NAMES.slice(0, 5)) {
    await expect(choice.getByRole('button', { name, exact: true })).toBeVisible();
  }
  for (const name of NAMES.slice(5)) {
    await expect(choice.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(choice.getByRole('button', { name: 'Browse all 7 in Library' })).toBeVisible();
});

test('keeping current changes nothing, and choosing one commits it', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  const chip = dialog.getByRole('button', { name: 'FCT' });
  await chip.click();
  const choice = dialog.locator('[data-decision-kind="choice"]');
  await choice.getByRole('button', { name: 'Keep current' }).click();
  await expect(choice).toHaveCount(0);
  await expect(chip).toHaveText('FCT · Auto');

  await chip.click();
  await dialog
    .locator('[data-decision-kind="choice"]')
    .getByRole('button', { name: 'Charlie', exact: true })
    .click();
  await expect(chip).toHaveText('FCT · Charlie');

  // Reopening offers the way back to Auto and no longer re-offers the current one.
  await chip.click();
  const reopened = dialog.locator('[data-decision-kind="choice"]');
  await expect(reopened.getByRole('button', { name: 'Auto', exact: true })).toBeVisible();
  await expect(reopened.getByRole('button', { name: 'Charlie', exact: true })).toHaveCount(0);
  await expect(reopened).toContainText('Charlie does a thing');

  await reopened.getByRole('button', { name: 'Auto', exact: true }).click();
  await expect(chip).toHaveText('FCT · Auto');
});

test('browsing hands off to Library instead of expanding in place', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  await dialog.getByRole('button', { name: 'FCT' }).click();
  await dialog.getByRole('button', { name: 'Browse all 7 in Library' }).click();

  await expect(dialog.locator('[data-decision-kind="choice"]')).toHaveCount(0);
  await expect(page.getByText('FCT Library')).toBeVisible();
  // Browsing is not a selection.
  await expect(dialog.getByRole('button', { name: 'FCT' })).toHaveText('FCT · Auto');
});
