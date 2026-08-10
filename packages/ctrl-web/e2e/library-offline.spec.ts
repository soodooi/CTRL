// Library discovery when the registry is unreachable — U14.
//
// "Find a capability for something I cannot do yet" was only ever exercised with
// a working registry. The states that actually matter on a local-first product
// were uncovered: offline, and a registry that answers with nothing. Neither may
// read as a broken app, and neither may hide the paths that still work locally.
// (ADR-002 substrate § composition §7.4; ADR-005 irisy §12 v42 U14)

import { test, expect, type Page } from '@playwright/test';

interface MockOptions {
  /** Registry fetch throws, as it does with no network. */
  offline?: boolean;
  /** Registry answers, with no servers. */
  empty?: boolean;
}

function installShellMock(page: Page, options: MockOptions): Promise<void> {
  return page.addInitScript((opts) => {
    window.localStorage.clear();
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'fetch_pack_registry') {
        if (opts.offline) throw new Error('network is unreachable');
        return JSON.stringify({ servers: [] });
      }
      if (command === 'gate_invoke') {
        const call = args as { tool?: string; args?: { request?: { operation?: string } } };
        if (call.tool === 'query' && call.args?.request?.operation === 'list') {
          // One locally installed capability survives an offline registry.
          return [
            {
              ref: 'skill:office',
              name: 'Office',
              summary: 'Documents',
              source_kind: 'skill',
              install_state: 'available',
              selection_kind: 'selectable',
              enabled: true,
            },
          ];
        }
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
      return [];
    };
  }, options);
}

test('an unreachable registry leaves Library usable, not broken', async ({ page }) => {
  await installShellMock(page, { offline: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();

  // The shell renders and the local half still works.
  await expect(page.getByText('FCT Library')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Find FCTs' })).toBeVisible();

  // Find reports nothing available rather than a stack trace or a spinner.
  await expect(page.getByText('No FCTs match. Try Create FCT.')).toBeVisible();

  // What is already installed is still listed and selectable offline.
  await page.getByRole('tab', { name: 'Installed FCTs' }).click();
  await expect(page.getByText('Office', { exact: true })).toBeVisible();
  await expect(page.getByText('Local Skill · Available')).toBeVisible();
});

test('an empty registry says so and still offers Create', async ({ page }) => {
  await installShellMock(page, { empty: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();

  await expect(page.getByText('No FCTs match. Try Create FCT.')).toBeVisible();
  // The recovery is an actual authoring mode, not advice.
  await page.getByRole('tab', { name: 'Create FCT' }).click();
  await expect(
    page.getByText('Describe an FCT — Irisy drafts it, the gate checks it, and you review'),
  ).toBeVisible();
  await expect(
    page.getByText('or scaffold a connector from an OpenAPI spec', { exact: true }),
  ).toBeVisible();
});

test('searching an unreachable registry reports no matches rather than hanging', async ({
  page,
}) => {
  await installShellMock(page, { offline: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Library' }).click();

  await page.getByPlaceholder('Find FCTs…').fill('spreadsheet');
  await expect(page.getByText('No FCTs match. Try Create FCT.')).toBeVisible();
});
