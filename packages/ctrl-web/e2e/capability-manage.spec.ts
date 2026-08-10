// Source-aware capability management — real-path UI verification for U15/U18.
//
// Installed used to be the only reachable state, so the only way to stop using
// something was to delete it. Library must now show what owns each capability
// and offer the reversible option, and a disabled capability must disappear from
// the composer override without being uninstalled.
// (ADR-002 substrate §15.4 v88; ADR-005 irisy §12 v42 U15/U18)

import { test, expect, type Page } from '@playwright/test';

function installShellMock(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.clear();
    // Server-side truth for this harness: which refs are disabled.
    const disabled = new Set<string>();
    const produced: unknown[] = [];
    (window as unknown as { __produced: unknown[] }).__produced = produced;
    const revealed: unknown[] = [];
    (window as unknown as { __revealed: unknown[] }).__revealed = revealed;

    const catalogue = () =>
      [
        { ref: 'pack:office', name: 'Office', summary: 'Documents', source_kind: 'package' },
        { ref: 'skill:tables', name: 'Tables', summary: 'Spreadsheets', source_kind: 'skill' },
      ].map((entry) => ({
        ...entry,
        install_state: entry.source_kind === 'package' ? 'installed' : 'available',
        enabled: !disabled.has(entry.ref),
        selection_kind: disabled.has(entry.ref) ? 'disabled' : 'selectable',
      }));

    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'gate_invoke') {
        const call = args as {
          tool?: string;
          args?: {
            ref?: string;
            request?: { operation?: string; ref?: string };
            operation?: { kind?: string; ref?: string };
          };
        };
        if (call.tool === 'query' && call.args?.ref === 'ctrl://local/system/catalog') {
          if (call.args.request?.operation === 'list') return catalogue();
          if (call.args.request?.operation === 'selection-projection') {
            const ref = call.args.request.ref ?? '';
            if (disabled.has(ref)) {
              throw new Error('FCT is disabled; enable it in Library before using it');
            }
            return {
              ref,
              resources: [],
              capability_scope: ['system'],
              policy: 'review-gated-writes',
              install_state: 'installed',
              install_ref: ref,
            };
          }
        }
        if (call.tool === 'produce' && call.args?.ref === 'ctrl://local/system/catalog') {
          const operation = call.args.operation ?? {};
          produced.push(operation);
          const ref = operation.ref ?? '';
          const wasDisabled = disabled.has(ref);
          if (operation.kind === 'disable') disabled.add(ref);
          if (operation.kind === 'enable') disabled.delete(ref);
          return {
            resource: 'ctrl://local/system/catalog',
            target: ref,
            staged: {
              before: wasDisabled ? 'disabled' : 'enabled',
              after: operation.kind === 'disable' ? 'disabled' : 'enabled',
            },
            effect: {
              summary: `${operation.kind}d the capability`,
              verified_by: 'reread the capability state file and it matched',
            },
            result: { ref, enabled: operation.kind === 'enable' },
          };
        }
        return null;
      }
      if (command === 'reveal_capability') {
        revealed.push(args);
        const ref = (args as { capabilityRef?: string }).capabilityRef ?? '';
        return `/tmp/ctrl/mcps/${ref.split(':')[1] ?? ''}`;
      }
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'get_version') return 'e2e';
      return null;
    };
  });
}

async function openInstalled(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('tab', { name: 'Installed FCTs' }).click();
}

test('Library states what owns each capability', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');
  await openInstalled(page);

  // Ownership is visible, so Remove is not a guess about what gets deleted.
  await expect(page.getByText('Installed package · Available')).toBeVisible();
  await expect(page.getByText('Local Skill · Available')).toBeVisible();
});

test('disabling keeps a capability installed and removes it from the composer', async ({
  page,
}) => {
  await installShellMock(page);
  await page.goto('/');

  // Offered before.
  const chip = page.getByLabel('Persistent agent dialog').getByRole('button', { name: 'FCT' });
  await chip.click();
  await expect(page.getByRole('button', { name: 'Office', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep current' }).click();

  await openInstalled(page);
  const card = page.getByText('Office', { exact: true }).locator('..').locator('..');
  await card.getByRole('button', { name: 'Disable' }).click();

  // The kernel is told to disable, not to uninstall.
  const produced = await page.evaluate(
    () => (window as unknown as { __produced: { kind?: string; ref?: string }[] }).__produced,
  );
  expect(produced).toEqual([{ kind: 'disable', ref: 'pack:office' }]);

  // It stays installed and says so, and the control now offers the way back.
  await expect(page.getByText('Disabled "Office". It is still installed.')).toBeVisible();
  await expect(page.getByText('Installed package · Disabled')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Enable' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Remove FCT' })).toBeVisible();

  // And it is no longer offered for the next turn.
  await page.getByRole('button', { name: 'Work' }).click();
  await chip.click();
  await expect(page.getByRole('button', { name: 'Office', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tables', exact: true })).toBeVisible();
});

test('ownership can be opened, addressed by ref rather than by path', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');
  await openInstalled(page);

  const card = page.getByText('Office', { exact: true }).locator('..').locator('..');
  await card.getByRole('button', { name: 'Show files' }).click();

  // The frontend asks by ref; the kernel decides which path that is.
  const revealed = await page.evaluate(
    () => (window as unknown as { __revealed: unknown[] }).__revealed,
  );
  expect(revealed).toEqual([{ capabilityRef: 'pack:office' }]);
  await expect(page.getByText('Showing /tmp/ctrl/mcps/office')).toBeVisible();
});

test('a Skill can be disabled and enabled again, not only removed', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');
  await openInstalled(page);

  const card = page.getByText('Tables', { exact: true }).locator('..').locator('..');
  // A Skill has no Remove today; disabling is the only management it needs.
  await expect(card.getByRole('button', { name: 'Remove FCT' })).toHaveCount(0);

  await card.getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByText('Local Skill · Disabled')).toBeVisible();

  await card.getByRole('button', { name: 'Enable' }).click();
  await expect(page.getByText('Enabled "Tables".')).toBeVisible();
  await expect(page.getByText('Local Skill · Available')).toBeVisible();

  const produced = await page.evaluate(
    () => (window as unknown as { __produced: { kind?: string; ref?: string }[] }).__produced,
  );
  expect(produced).toEqual([
    { kind: 'disable', ref: 'skill:tables' },
    { kind: 'enable', ref: 'skill:tables' },
  ]);
});
