import { test, expect, type Page } from '@playwright/test';

// ADR-003 frontend §7 v4 verification.
//
// CSS modules hash class names (`.shell` -> `_shell_abc123`); the
// `[class*="shell"]` attribute selector matches stably across rebuilds.
// All assertions inspect DOM state — Tauri `invoke()` no-ops in browser,
// so native window resize / hotkey side-effects are out of scope.

const STORAGE_KEY = 'irisy:chat:v1';

async function readGridTemplateAreas(page: Page): Promise<string> {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-testid="shell"]');
    if (!shell) return '';
    return getComputedStyle(shell).gridTemplateAreas;
  });
}

async function readCellWidths(
  page: Page,
): Promise<{ tab: number; l2: number; l1: number; irisy: number }> {
  return page.evaluate(() => {
    function w(id: string): number {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      return el ? el.getBoundingClientRect().width : -1;
    }
    return {
      tab: w('grid-tab'),
      l2: w('grid-l2'),
      l1: w('grid-l1'),
      irisy: w('grid-irisy'),
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
    } catch {
      // Some browsers throw in private mode — irrelevant for our chromium project.
    }
  });
});

test('A: grid-template-areas row 2 is [tab l2 l1 irisy]', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="shell"]');
  const areas = await readGridTemplateAreas(page);
  // getComputedStyle returns each row as a quoted string. Row 2 carries
  // the layout we care about; the order must match ADR-003 v4 §7.1.
  expect(areas).toContain('tab l2 l1 irisy');
});

test('B: compact view collapses Tab + L2 to 0px', async ({ page }) => {
  await page.setViewportSize({ width: 478, height: 720 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="shell"]');
  const widths = await readCellWidths(page);
  expect(widths.tab).toBe(0);
  expect(widths.l2).toBe(0);
  // Sanity: L1 + Irisy stay rendered.
  expect(widths.l1).toBeGreaterThan(0);
  expect(widths.irisy).toBeGreaterThan(0);
});

test('C: opening a system tab expands Tab while L2 stays collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 720 });
  await page.goto('/');
  await page.waitForSelector('[data-testid="shell"]');
  // Drive the workspace store directly via the dev-only window handle
  // exposed in lib/workspace-store.ts. This avoids depending on the L1
  // chip click path (whose timing varies with lazy chunk loading) while
  // exercising the same `data-workspace-open` flip the chip would cause.
  await page.evaluate(() => {
    type Store = {
      getState: () => {
        openSystemTab: (tab: {
          id: string;
          kind: 'route';
          path: string;
          title: string;
        }) => void;
      };
    };
    const w = window as unknown as { __ctrlWorkspaceStore?: Store };
    w.__ctrlWorkspaceStore?.getState().openSystemTab({
      id: 'pool',
      kind: 'route',
      path: '/pool',
      title: 'Mcp pool',
    });
  });
  await page.waitForSelector('[data-testid="shell"][data-workspace-open="true"]', {
    timeout: 5000,
  });
  const widths = await readCellWidths(page);
  // Tab grew from 0 to a positive pixel width (1fr resolves once layout
  // settles). L2 stays at 0 because no sub-nav has been declared yet.
  expect(widths.tab).toBeGreaterThan(100);
  expect(widths.l2).toBe(0);
});

test('D: <call> markup renders as ToolCard, not raw XML — skipped pending invoke stub', async () => {
  test.skip(
    true,
    'IrisyChat flips to "upgrade stub" when `invoke(irisy_init)` rejects (always in browser dev mode, since Pi is not reachable via WS without a kernel). To unskip, add a dev-only window.__ctrlInvokeMock hook in lib/bridge.ts that tests can populate with a fixture set of command responses. Production ship path is verified manually with Pi running.',
  );
});

test('E: Pi RPC error path renders errorPanel — skipped pending transport stub seam', async () => {
  test.skip(
    true,
    'transport.stream() runs inside IrisyChat; no DI seam exists to inject a fake chunk yielding {error: ...}. Same fix as test D — add a window.__ctrlInvokeMock / __ctrlTransportMock hook in dev builds.',
  );
});
