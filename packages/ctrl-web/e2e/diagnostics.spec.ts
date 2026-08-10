// Diagnostics client — real-path UI verification for U21.
//
// The kernel composed typed status, smoke checks, a bounded trace, and a
// metadata-only export preview, and nothing consumed any of it. This drives the
// mounted surface in Settings and checks the honest-reporting rules: a stuck
// module reads as not-ready, capture is rechecked rather than assumed, and the
// export preview says plainly that nothing has left the machine.
// (ADR-003 frontend § diagnostics-surface v26; ADR-005 irisy §12 v42 U21)

import { test, expect, type Page } from '@playwright/test';

interface MockOptions {
  statusFails?: boolean;
}

function installShellMock(page: Page, options: MockOptions = {}): Promise<void> {
  return page.addInitScript((opts) => {
    window.localStorage.clear();
    const captured = new Set<string>();
    const calls: string[] = [];
    (window as unknown as { __calls: string[] }).__calls = calls;

    const statusFor = (module: string) => ({
      observed_at_ms: Date.UTC(2026, 7, 5, 10, 0, 0),
      module,
      startup: module === 'coding' ? 'starting' : 'ready',
      live: true,
      // Coding is live but not usable yet — the state this surface exists for.
      ready: module !== 'coding',
      health: module === 'coding' ? 'degraded' : 'ok',
      summary: module === 'coding' ? 'waiting for the workspace' : 'engine responded',
      capture_active: captured.has(module),
      // The kernel reports when a capture stops; so does this harness, because
      // the surface must show the window rather than an open-ended "active".
      ...(captured.has(module)
        ? { capture_expires_at_ms: Date.UTC(2026, 7, 5, 10, 2, 0) }
        : {}),
      retained_events: module === 'irisy' ? 2 : 0,
      attributes: {},
    });

    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
    };
    harness.__ctrlInvokeMock = (command, args) => {
      const module = (args as { module?: string } | undefined)?.module ?? 'irisy';
      if (command === 'app_diagnostics_status') {
        calls.push(`status:${module}`);
        if (opts.statusFails) throw new Error('diagnostics composer is not running');
        return statusFor(module);
      }
      if (command === 'app_diagnostics_trace') {
        return {
          module,
          retention_seconds: 600,
          capacity: 500,
          events:
            module === 'irisy'
              ? [
                  {
                    timestamp_ms: Date.UTC(2026, 7, 5, 9, 59, 0),
                    module,
                    trace_id: 'trace-1',
                    kind: 'turn',
                    phase: 'start',
                    severity: 'info',
                    outcome: 'ok',
                    attributes: {},
                  },
                  {
                    timestamp_ms: Date.UTC(2026, 7, 5, 10, 0, 0),
                    module,
                    trace_id: 'trace-1',
                    kind: 'tool',
                    phase: 'end',
                    severity: 'error',
                    outcome: 'failed',
                    duration_ms: 42,
                    attributes: {},
                  },
                ]
              : [],
        };
      }
      if (command === 'app_diagnostics_smoke') {
        calls.push(`smoke:${module}`);
        return {
          observed_at_ms: Date.UTC(2026, 7, 5, 10, 0, 0),
          module,
          health: 'degraded',
          checks: [
            { name: 'gate', health: 'ok', summary: 'reachable' },
            { name: 'provider', health: 'degraded', summary: 'no adapter configured' },
          ],
        };
      }
      if (command === 'diagnostics_capture_start') {
        calls.push(`capture_start:${module}`);
        captured.add(module);
        return { module, active: true, expires_at_ms: Date.UTC(2026, 7, 5, 10, 2, 0) };
      }
      if (command === 'diagnostics_capture_stop') {
        calls.push(`capture_stop:${module}`);
        captured.delete(module);
        return { module, active: false };
      }
      if (command === 'diagnostics_export_preview') {
        calls.push(`export:${module}`);
        return {
          generated_at_ms: Date.UTC(2026, 7, 5, 10, 0, 0),
          module,
          status: statusFor(module),
          trace: { module, retention_seconds: 600, capacity: 500, events: [] },
          metadata_only: true,
          destination: 'local_user_selected_file',
          estimated_bytes: 2048,
        };
      }
      if (command === 'list_mcps') return [];
      if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
      if (command === 'get_version') return 'e2e';
      // Settings mounts provider/env lists that search their reply; an empty
      // array is the truthful "nothing configured" answer for this harness.
      return [];
    };
  }, options);
}

const openDiagnostics = async (page: Page): Promise<void> => {
  await page.goto('/settings/logs');
  // Exact, because the module tablist is also labelled "Diagnostics module".
  await expect(page.getByRole('region', { name: 'Diagnostics', exact: true })).toBeVisible();
};

test('the diagnostics client reports each module status and its retained activity', async ({
  page,
}) => {
  await installShellMock(page);
  await openDiagnostics(page);

  const status = page.getByTestId('diagnostics-status');
  await expect(status).toContainText('Irisy · ok');
  await expect(status).toContainText('engine responded');
  await expect(status).toContainText('Retained events');

  // Structured records, newest first — not a log tail.
  const trace = page.getByTestId('diagnostics-trace');
  const rows = trace.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('tool');
  await expect(rows.first()).toContainText('42ms');
  // The event without a measured duration shows no fabricated 0ms.
  await expect(rows.nth(1)).toContainText('turn');
});

test('a live but unready module reads as degraded rather than as running', async ({ page }) => {
  await installShellMock(page);
  await openDiagnostics(page);

  await page.getByRole('tab', { name: 'Coding' }).click();
  const status = page.getByTestId('diagnostics-status');
  await expect(status).toContainText('Coding · degraded');
  await expect(status).toContainText('waiting for the workspace');
  await expect(status).toContainText('starting');

  // Nothing retained is stated with the action that changes it.
  await expect(page.getByTestId('diagnostics-trace')).toContainText('Start a capture');
});

test('checks and capture report the kernel state, and capture is rechecked not assumed', async ({
  page,
}) => {
  await installShellMock(page);
  await openDiagnostics(page);

  await page.getByRole('button', { name: 'Run checks' }).click();
  const smoke = page.getByTestId('diagnostics-smoke');
  await expect(smoke).toContainText('Checks · degraded');
  await expect(smoke).toContainText('no adapter configured');

  await page.getByRole('button', { name: 'Capture 120s' }).click();
  await expect(page.getByTestId('diagnostics-status')).toContainText('active until');
  await expect(page.getByRole('button', { name: 'Stop capture' })).toBeVisible();

  // The toggle re-read status instead of trusting its own optimistic flip.
  const calls = await page.evaluate(() => (window as unknown as { __calls: string[] }).__calls);
  expect(calls.filter((entry) => entry === 'capture_start:irisy')).toHaveLength(1);
  expect(calls.filter((entry) => entry === 'status:irisy').length).toBeGreaterThan(1);
});

test('the export preview says nothing has left the machine', async ({ page }) => {
  await installShellMock(page);
  await openDiagnostics(page);

  await page.getByRole('button', { name: 'Preview export' }).click();
  const preview = page.getByTestId('diagnostics-export');
  await expect(preview).toContainText('metadata only');
  await expect(preview).toContainText('a local file you choose');
  await expect(preview).toContainText('Nothing has been written yet');
});

test('a diagnostics failure is reported through the decision registry with a retry', async ({
  page,
}) => {
  await installShellMock(page, { statusFails: true });
  await openDiagnostics(page);

  const decision = page.locator('[data-decision-kind="unavailable"]');
  await expect(decision).toBeVisible();
  await expect(decision).toContainText('could not read this module’s status');
  const reason = decision.getByText('diagnostics composer is not running');
  await expect(reason).toBeHidden();
  await decision.getByText('View details').click();
  await expect(reason).toBeVisible();
  await expect(decision.getByRole('button', { name: 'Try again' })).toBeVisible();
});
