// Provider verification states — real-path UI verification for U20.
//
// The kernel already reports configuration, runtime availability, and production
// verification as three SEPARATE facts, and no runnable check proved the UI keeps
// them separate. That distinction is the whole point: a saved key does not mean a
// reachable runtime, and a reachable runtime does not mean a verified one. A
// surface that collapses them tells the user their AI is ready when it is not.
// (ADR-002 substrate § provider v71; ADR-005 irisy §12 v42 U20)

import { test, expect, type Page } from '@playwright/test';

interface Row {
  id: string;
  label: string;
  configured: boolean;
  runtime_status: 'unknown' | 'available' | 'unavailable';
  runtime_detail: string | null;
  verified: boolean;
  active_roles: string[];
}

const row = (overrides: Partial<Row> & Pick<Row, 'id' | 'label'>): Record<string, unknown> => ({
  kind: 'rest',
  shape: 'openai_chat_completions',
  endpoint: 'https://example.invalid/v1',
  models: ['demo-model'],
  description: 'A demo provider',
  configured: false,
  runtime_status: 'unknown',
  runtime_detail: null,
  verified: false,
  active_roles: [],
  load_error: null,
  source: 'builtin',
  ...overrides,
});

function installShellMock(page: Page, rows: Record<string, unknown>[]): Promise<void> {
  return page.addInitScript((seed) => {
    window.localStorage.clear();
    const calls: unknown[] = [];
    (window as unknown as { __setActive: unknown[] }).__setActive = calls;
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command, args) => {
      if (command === 'provider_list') return seed;
      if (command === 'provider_set_active') {
        calls.push((args as { args?: unknown }).args);
        throw new Error('the production trial failed: 401 from the provider');
      }
      if (command === 'get_version') return 'e2e';
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      return [];
    };
  }, rows);
}

test('configuration, runtime, and verification are reported as separate facts', async ({
  page,
}) => {
  await installShellMock(page, [
    row({
      id: 'saved-only',
      label: 'Saved Only',
      configured: true,
      runtime_status: 'unknown',
    }),
    row({
      id: 'reachable',
      label: 'Reachable',
      configured: true,
      runtime_status: 'available',
    }),
    row({
      id: 'broken',
      label: 'Broken',
      configured: true,
      runtime_status: 'unavailable',
      runtime_detail: 'connection refused',
    }),
  ]);
  await page.goto('/settings/providers');

  // A saved key alone is never reported as verified.
  const saved = page.getByText('Saved Only', { exact: true }).locator('..').locator('..');
  await expect(saved.getByLabel('Provider status')).toContainText('Not verified');

  // A reachable runtime is still not a verified one.
  const reachable = page.getByText('Reachable', { exact: true }).locator('..').locator('..');
  await expect(reachable.getByLabel('Provider status')).toContainText('Not verified');

  // An unavailable runtime says why and cannot be activated.
  const broken = page.getByText('Broken', { exact: true }).locator('..').locator('..');
  await expect(broken.getByLabel('Provider status')).toContainText('Runtime unavailable');
  // The kernel's reason sits with the provider, not hidden behind a generic badge.
  await expect(broken).toContainText('connection refused');
  await expect(broken.getByRole('button', { name: 'Use primary' })).toHaveCount(0);
});

test('a verified provider says so, and the unverified one still offers a trial', async ({
  page,
}) => {
  await installShellMock(page, [
    row({
      id: 'trusted',
      label: 'Trusted',
      configured: true,
      runtime_status: 'available',
      verified: true,
      active_roles: ['irisy.primary'],
    }),
    row({
      id: 'candidate',
      label: 'Candidate',
      configured: true,
      runtime_status: 'available',
    }),
  ]);
  await page.goto('/settings/providers');

  const trusted = page.getByText('Trusted', { exact: true }).locator('..').locator('..');
  await expect(trusted.getByLabel('Provider status')).toContainText('Verified');

  // Selecting an unverified provider is a trial, not a claim.
  const candidate = page.getByText('Candidate', { exact: true }).locator('..').locator('..');
  await expect(candidate.getByRole('button', { name: 'Use primary' })).toBeVisible();
});

test('a failed trial surfaces the kernel reason and does not claim the provider works', async ({
  page,
}) => {
  await installShellMock(page, [
    row({
      id: 'candidate',
      label: 'Candidate',
      configured: true,
      runtime_status: 'available',
    }),
  ]);
  await page.goto('/settings/providers');

  const candidate = page.getByText('Candidate', { exact: true }).locator('..').locator('..');
  await candidate.getByRole('button', { name: 'Use primary' }).click();

  // The kernel's own reason reaches the user.
  await expect(page.getByText('the production trial failed: 401 from the provider')).toBeVisible();
  // And the row still reports itself unverified.
  await expect(candidate.getByLabel('Provider status')).toContainText('Not verified');

  const attempts = await page.evaluate(
    () => (window as unknown as { __setActive: { role?: string; provider_id?: string }[] })
      .__setActive,
  );
  expect(attempts).toEqual([{ role: 'irisy.primary', provider_id: 'candidate' }]);
});
