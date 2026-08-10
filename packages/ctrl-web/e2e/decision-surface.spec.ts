// Decision surface registry — real-path UI verification.
//
// Drives the shipped composer so a failing FCT selection renders a typed
// `unavailable` decision with a recovery action, instead of the fabricated
// assistant message the previous code injected.
// (ADR-003 frontend § decision-registry v43; ADR-005 §12 U12/U17)

import { test, expect, type Page } from '@playwright/test';

function installShellMock(page: Page, options: { selectionFails: boolean }): Promise<void> {
  return page.addInitScript((opts) => {
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
            return [
              {
                ref: 'pack:removed-companion',
                name: 'Removed Companion',
                summary: 'A pack whose live projection fails',
                source_kind: 'package',
                install_state: 'installed',
                selection_kind: 'selectable',
              },
            ];
          }
          if (request?.operation === 'selection-projection') {
            if (opts.selectionFails) {
              throw new Error('FCT is installed but has no projectable Resource');
            }
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
  }, options);
}

test('a failed FCT selection renders a typed unavailable decision, not an assistant turn', async ({
  page,
}) => {
  await installShellMock(page, { selectionFails: true });
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  const selector = dialog.getByRole('button', { name: 'FCT' });
  await expect(selector).toHaveText('FCT · Auto');
  await selector.click();
  await dialog
    .locator('[data-decision-kind="choice"]')
    .getByRole('button', { name: 'Removed Companion' })
    .click();

  // The decision renders through the registry, tagged with its kind and the
  // intent it serves.
  const decision = page.getByLabel('Persistent agent dialog').locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await expect(decision).toHaveAttribute('data-decision-intent', 'U19');
  await expect(decision).toContainText('That FCT could not be used, so the session is unchanged.');

  // Recovery is an action, not a sentence.
  const recover = decision.getByRole('button', { name: 'Manage in Library' });
  await expect(recover).toBeVisible();

  // The kernel reason stays available as drill-down rather than the headline.
  await decision.getByText('View details').click();
  await expect(decision).toContainText('no projectable Resource');

  // Selection did not commit and no fake assistant reply was injected.
  await expect(selector).toHaveText('FCT · Auto');
  await expect(page.getByText('I could not use that FCT')).toHaveCount(0);

  // The recovery option actually navigates to the management surface.
  await recover.click();
  await expect(decision).toHaveCount(0);
  await expect(page.getByText('FCT Library')).toBeVisible();
});

test('a resolvable FCT commits without raising a decision', async ({ page }) => {
  await installShellMock(page, { selectionFails: false });
  await page.goto('/');

  const dialog = page.getByLabel('Persistent agent dialog');
  const selector = dialog.getByRole('button', { name: 'FCT' });
  await selector.click();
  await dialog
    .locator('[data-decision-kind="choice"]')
    .getByRole('button', { name: 'Removed Companion' })
    .click();

  await expect(selector).toHaveText('FCT · Removed Companion');
  // Scoped to the Irisy column: the Work pane owns its own decisions in this
  // harness, and this assertion is about the SELECTION raising none — including
  // the override panel, which must close once the choice is made.
  await expect(dialog.locator('[data-decision-kind]')).toHaveCount(0);
});
