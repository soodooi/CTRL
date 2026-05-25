import { test, expect } from '@playwright/test';

// Smoke — visit every top-level route, assert it renders SOMETHING
// (not blank), screenshot for review. Would have caught:
//   • Hermes Settings blank iframe (5/24)
//   • Settings click → 一级 nav disappears (5/24)
//   • Empty page on first launch

const SCREENSHOT_OPTS = {
  fullPage: false,
  animations: 'disabled' as const,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.documentElement.dataset.theme = 'dark';
  });
});

test('home — default workspace renders mascot + chat input', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByPlaceholder(/Ask Irisy/i)).toBeVisible();
  await page.screenshot({ path: 'tests/e2e/__screenshots__/home.png', ...SCREENSHOT_OPTS });
});

test('settings/ctrl — opens with 一级 nav still visible', async ({ page }) => {
  await page.goto('/settings/ctrl');
  await expect(page.locator('main')).toBeVisible();
  // Level-1 nav must remain on screen — regression guard for the
  // 5/24 bug where clicking Settings made it vanish behind subPanel.
  await expect(page.getByRole('button', { name: /Settings/i }).first()).toBeVisible();
  await page.screenshot({ path: 'tests/e2e/__screenshots__/settings-ctrl.png', ...SCREENSHOT_OPTS });
});

test('settings/hermes — shows empty state when daemon absent', async ({ page }) => {
  await page.goto('/settings/hermes');
  await expect(page.getByText(/Hermes Settings/i).first()).toBeVisible();
  // Default mock returns hermes_dashboard_url=null, so the page MUST
  // render the empty-state message (not a blank iframe). Regression
  // guard for the 5/24 white-iframe bug.
  await expect(page.getByText(/Hermes is not running/i)).toBeVisible();
  await expect(page.locator('iframe[title="Hermes dashboard"]')).toHaveCount(0);
  await page.screenshot({
    path: 'tests/e2e/__screenshots__/settings-hermes.png',
    ...SCREENSHOT_OPTS,
  });
});

test('settings/hermes — embeds iframe when daemon is up', async ({ page }) => {
  // Override kernel_status BEFORE the route mounts — `addInitScript`
  // runs in every new page document, so the very first useKernelStatus
  // poll already sees hermes_dashboard_url populated. Doing this
  // post-navigation + reload loses the override when test-harness
  // re-initializes.
  await page.addInitScript(() => {
    const apply = (): void => {
      const api = (window as any).__CTRL_TEST;
      if (!api) {
        setTimeout(apply, 5);
        return;
      }
      api.overrideInvoke('kernel_status', () => ({
        uptime_ms: 1000,
        llm_adapters: ['volc'],
        primary_adapter: 'volc',
        mcp_servers_installed: 0,
        vault_files: 0,
        stss_bridge_addr: '127.0.0.1:17872',
        warnings: [],
        overall: 'ok',
        hermes_dashboard_url: 'http://127.0.0.1:9119',
      }));
    };
    apply();
  });
  await page.goto('/settings/hermes');
  await expect(page.locator('iframe[title="Hermes dashboard"]')).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(/Hermes is not running/i)).toHaveCount(0);
});

test('settings/updates — renders changelog', async ({ page }) => {
  await page.goto('/settings/updates');
  await expect(page.locator('main')).toBeVisible();
  await page.screenshot({
    path: 'tests/e2e/__screenshots__/settings-updates.png',
    ...SCREENSHOT_OPTS,
  });
});

test('pool — renders keycap catalog', async ({ page }) => {
  await page.goto('/pool');
  await expect(page.locator('main')).toBeVisible();
  await page.screenshot({ path: 'tests/e2e/__screenshots__/pool.png', ...SCREENSHOT_OPTS });
});

test('irisy route loads (keycap creator entry)', async ({ page }) => {
  await page.goto('/irisy');
  await expect(page.locator('body')).toBeVisible();
  await page.screenshot({ path: 'tests/e2e/__screenshots__/irisy.png', ...SCREENSHOT_OPTS });
});
