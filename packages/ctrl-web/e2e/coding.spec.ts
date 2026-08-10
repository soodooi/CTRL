import { test, expect, type Page } from '@playwright/test';

function installFctHarness(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.clear();
    const office = {
      ref: 'skill:office',
      name: 'Office',
      summary: 'Use office documents',
      source_kind: 'skill',
      install_state: 'available',
      selection_kind: 'selectable',
    };
    const tables = {
      ref: 'skill:tables',
      name: 'Tables',
      summary: 'Work with tables',
      source_kind: 'skill',
      install_state: 'available',
      selection_kind: 'selectable',
    };
    let created: typeof office | null = null;
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
      __ctrlCalls: typeof calls;
    };
    harness.__ctrlCalls = calls;
    harness.__ctrlInvokeMock = (command, args) => {
      calls.push({ command, args });
      if (command === 'gate_invoke') {
        const call = args as {
          tool?: string;
          args?: {
            ref?: string;
            request?: { operation?: string; ref?: string };
            manifest?: Record<string, unknown>;
          };
        };
        if (call.tool === 'query' && call.args?.ref === 'ctrl://local/system/catalog') {
          if (call.args.request?.operation === 'list') return created ? [office, tables, created] : [office, tables];
          if (call.args.request?.operation === 'selection-projection') {
            const ref = call.args.request.ref ?? '';
            return {
              ref,
              resources: [],
              skill_id: ref.startsWith('skill:') ? ref.slice('skill:'.length) : undefined,
              capability_scope: ['tool:describe', 'tool:produce', 'tool:query'],
              policy: 'review-gated-writes',
              install_state: 'available',
              install_ref: ref,
            };
          }
        }
        if (call.tool === 'mcp_pack_scaffold') {
          return { record_source: { kind: 'http-json', fields: [] }, notes: [] };
        }
        if (call.tool === 'mcp_pack_validate') return { ok: true, issues: [], record_source_fields: 0 };
        if (call.tool === 'mcp_pack_install') {
          const manifest = call.args?.manifest ?? {};
          const id = String(manifest.id ?? 'created');
          created = {
            ref: `pack:${id}`,
            name: String(manifest.name ?? id),
            summary: 'Created in Library',
            source_kind: 'package',
            install_state: 'installed',
            selection_kind: 'selectable',
          };
          return null;
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
  await installFctHarness(page);
});

test('/coding redirects to the canonical shell and FCT selection belongs to each session', async ({ page }) => {
  await page.goto('/coding');
  await expect(page).toHaveURL(/\/$/);

  const dialog = page.getByLabel('Persistent agent dialog');
  const selector = dialog.getByRole('button', { name: 'FCT' });
  await selector.click();
  await dialog.locator('[data-decision-kind="choice"]').getByRole('button', { name: 'Office' }).click();
  await expect(selector).toHaveText('FCT · Office');

  // Expanded turn facts resolve live, while only the stable ref is session state.
  // (ADR-002 substrate §15.4 v84; ADR-003 frontend §8.5 v41)
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as unknown as { __ctrlCalls: Array<{ command: string; args?: Record<string, unknown> }> }).__ctrlCalls;
    return calls.some(({ command, args }) => {
      const gate = args as { tool?: string; args?: { request?: { operation?: string; ref?: string } } } | undefined;
      return command === 'gate_invoke'
        && gate?.tool === 'query'
        && gate.args?.request?.operation === 'selection-projection'
        && gate.args.request.ref === 'skill:office';
    });
  })).toBe(true);

  await dialog.getByRole('button', { name: 'New session', exact: true }).click();
  await expect(selector).toHaveText('FCT · Auto');
  await selector.click();
  await dialog.locator('[data-decision-kind="choice"]').getByRole('button', { name: 'Tables' }).click();
  await expect(selector).toHaveText('FCT · Tables');

  const sessions = dialog.getByRole('tablist', { name: 'Irisy sessions' });
  await expect(sessions.getByRole('tab')).toHaveCount(2);
  await sessions.getByRole('tab').nth(0).click();
  await expect(selector).toHaveText('FCT · Office');
  await sessions.getByRole('tab').nth(1).click();
  await expect(selector).toHaveText('FCT · Tables');

  await expect(dialog.getByRole('combobox', { name: 'Irisy identity' })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Resource' })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: 'Skill' })).toHaveCount(0);
});

test('creating an FCT changes Library availability without activating it', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByLabel('Persistent agent dialog');
  const selector = dialog.getByRole('button', { name: 'FCT' });
  await selector.click();
  await dialog.locator('[data-decision-kind="choice"]').getByRole('button', { name: 'Office' }).click();
  await expect(selector).toHaveText('FCT · Office');

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('tab', { name: 'Create FCT' }).click();
  await page.getByText('or scaffold a connector from an OpenAPI spec', { exact: true }).click();
  await page.getByPlaceholder('read path, e.g. /api/v1/portfolio/holdings').fill('/api/v1/holdings');
  await page.getByRole('textbox', { name: 'OpenAPI spec JSON' }).fill(JSON.stringify({ openapi: '3.0.0', paths: {} }));
  await page.getByRole('button', { name: 'Scaffold from OpenAPI' }).click();
  await expect(page.getByRole('textbox', { name: 'Pack manifest JSON' })).toBeVisible();
  await page.getByRole('button', { name: 'Add FCT', exact: true }).click();

  await expect(page.getByText('FCT added to Installed FCTs. It was not activated.', { exact: true })).toBeVisible();
  await expect(page.getByText('Holdings', { exact: true })).toBeVisible();

  // Creation and installation alter availability only; Use FCT is the explicit handoff.
  // (ADR-003 frontend §8.5 v41)
  await page.getByRole('button', { name: 'Work' }).click();
  await expect(selector).toHaveText('FCT · Office');

  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('tab', { name: 'Installed FCTs' }).click();
  const card = page.getByText('Holdings', { exact: true }).locator('..').locator('..');
  await card.getByRole('button', { name: 'Use FCT' }).click();
  await expect(page.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-current', 'page');
  await expect(selector).toHaveText('FCT · Holdings');
});
