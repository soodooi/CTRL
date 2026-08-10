// Provenance drill-down — real-path UI verification for U11.
//
// Drives the shipped Work pane: a session that owns a project Resource mounts
// ResourceViewerHost, which must expose the descriptor facts it fetches and let
// the user walk the provenance chain back to the original local source.
// (ADR-002 substrate §15 v83; ADR-003 frontend §8.5 v44; ADR-005 irisy §12 v42 U11)

import { test, expect, type Page } from '@playwright/test';

const PROJECT_REF = 'ctrl://local/project/demo';
const SOURCE_REF = 'ctrl://local/note/Notes.md';

function installShellMock(page: Page): Promise<void> {
  return page.addInitScript(
    (refs) => {
      window.localStorage.clear();
      // Seed the canonical transcript store so the Work pane has a project
      // Resource to project. Zustand-persist envelope, version 2.
      window.localStorage.setItem(
        'ctrl:irisy-sessions:v1',
        JSON.stringify({
          version: 2,
          state: {
            activeSessionId: 'e2e-session',
            sessions: [
              {
                id: 'e2e-session',
                label: 'Provenance',
                messages: [],
                createdAt: 1,
                lastActiveAt: 1,
                resources: [refs.project],
              },
            ],
          },
        }),
      );

      const descriptors: Record<string, unknown> = {
        [refs.project]: {
          protocol_version: '1',
          resource: refs.project,
          content_type: 'text/plain',
          provenance: [refs.source],
          freshness: {
            revision: 'rev-0182abcdef99',
            observed_at: '2026-08-05T10:00:00Z',
            stale: false,
          },
          degradation: null,
          presentation: { preferred_columns: [] },
          produce: [],
        },
        [refs.source]: {
          protocol_version: '1',
          resource: refs.source,
          content_type: 'text/plain',
          provenance: [],
          freshness: { revision: 'rev-0001', observed_at: null, stale: true },
          degradation: {
            code: 'source_unreachable',
            summary: 'Source did not answer the last read',
            retryable: true,
          },
          presentation: { preferred_columns: [] },
          produce: [],
        },
      };

      const harness = window as unknown as {
        __ctrlInvokeMock: (command: string, args?: Record<string, unknown>) => unknown;
      };
      harness.__ctrlInvokeMock = (command, args) => {
        if (command === 'gate_invoke') {
          const call = args as {
            tool?: string;
            args?: { ref?: string; request?: { operation?: string } };
          };
          if (call.tool === 'describe') {
            const descriptor = descriptors[call.args?.ref ?? ''];
            if (!descriptor) throw new Error('unknown resource');
            return descriptor;
          }
          if (call.tool === 'query') {
            if (call.args?.request?.operation === 'list') return [];
            return null;
          }
          return null;
        }
        // The Work pane only mounts a Resource viewer once a project is
        // resolved, so the harness must answer the launcher the same way a real
        // machine with one workspace would.
        if (command === 'coding_launcher_status') {
          return {
            workspaces: [
              {
                id: 'ws-demo',
                label: 'demo',
                path: '/tmp/demo',
                opencodeConfigPresent: false,
              },
            ],
            terminals: [],
            editors: [],
            opencodeAvailable: false,
            launchCommand: null,
          };
        }
        if (command === 'register_project_resource') return refs.project;
        if (command === 'list_mcps') return [];
        if (command === 'fetch_pack_registry') return JSON.stringify({ servers: [] });
        if (command === 'get_version') return 'e2e';
        return null;
      };
    },
    { project: PROJECT_REF, source: SOURCE_REF },
  );
}

test('a rendered Resource exposes its descriptor facts and its source chain', async ({
  page,
}) => {
  await installShellMock(page);
  await page.goto('/');

  const strip = page.getByTestId('provenance-drilldown');
  await expect(strip).toBeVisible();

  // Collapsed: the canonical ref and a short revision, no stale warning.
  await expect(strip).toContainText(PROJECT_REF);
  await expect(strip).toContainText('rev rev-0182abcd…');
  await expect(page.getByTestId('provenance-stale')).toHaveCount(0);

  // Expanded: kernel-sent facts verbatim, nothing invented.
  await strip.locator('summary').click();
  await expect(strip).toContainText('Content type');
  await expect(strip).toContainText('text/plain');
  await expect(strip).toContainText('rev-0182abcdef99');
  await expect(strip).toContainText('2026-08-05T10:00:00Z');
  await expect(strip).toContainText('current');

  // The chain is reachable, not just described.
  await expect(page.getByTestId('provenance-sources')).toContainText(SOURCE_REF);
});

test('drilling into a source shows that source own facts and can return', async ({ page }) => {
  await installShellMock(page);
  await page.goto('/');

  const strip = page.getByTestId('provenance-drilldown');
  await strip.locator('summary').click();
  await page.getByTestId('provenance-sources').getByRole('button', { name: SOURCE_REF }).click();

  // Now describing the upstream Resource: its own revision, its own staleness,
  // and the kernel's degradation report rather than the child's facts.
  const upstream = page.getByTestId('provenance-drilldown');
  await expect(upstream).toContainText(SOURCE_REF);
  await expect(page.getByTestId('provenance-stale')).toBeVisible();

  await upstream.locator('summary').click();
  await expect(upstream).toContainText('rev-0001');
  await expect(upstream).toContainText('stale — behind its source');
  await expect(upstream).toContainText('source_unreachable');
  await expect(upstream).toContainText('(retryable)');
  // An unreported observation time is absent, not guessed.
  await expect(upstream).not.toContainText('Observed at');
  // End of the chain is stated plainly.
  await expect(page.getByTestId('provenance-sources')).toContainText(
    'nothing — this is the original local source',
  );

  // Back returns to the Resource the user drilled in from.
  await page.getByTestId('provenance-back').click();
  await expect(page.getByTestId('provenance-drilldown')).toContainText(PROJECT_REF);
  await expect(page.getByTestId('provenance-back')).toHaveCount(0);
});
