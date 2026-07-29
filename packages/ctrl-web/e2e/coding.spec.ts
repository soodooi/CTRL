import { test, expect } from '@playwright/test';

// Browser-only harness: the production app intentionally reserves a bare
// browser for the remote-entry surface. This dev mock lets Playwright exercise
// the desktop React shell without pretending that a browser is Tauri.
function installKernelMock(page: import('@playwright/test').Page): Promise<void> {
  return page.addInitScript(() => {
    (window as unknown as { __ctrlInvokeMock: (command: string) => unknown }).__ctrlInvokeMock =
      (command) => {
        if (command === 'coding_launcher_status') {
          return {
            workspaces: [
              { id: 'root', label: 'CTRL', path: '/tmp/ctrl', opencodeConfigPresent: true },
              { id: 'research', label: 'Research', path: '/tmp/ctrl/Research', opencodeConfigPresent: true },
            ],
            terminals: [],
            editors: [],
            opencodeAvailable: false,
            launchCommand: null,
          };
        }
        if (command === 'irisy_init') {
          return {
            app_version: 'e2e',
            kernel_llm: { adapter: 'e2e', ready: true },
            mcp_bridge: { handshake_written: true, handshake_path: '/tmp/ctrl' },
            active_brain: 'e2e',
          };
        }
        if (command === 'kernel_status') {
          return {
            uptime_ms: 1,
            first_run_state: 'ready',
            llm_adapters: [],
            primary_adapter: null,
            mcp_servers_installed: 0,
            vault_files: 0,
            event_ws_addr: '127.0.0.1:17872',
            overall: 'ok',
            warnings: [],
            active_brain: 'e2e',
          };
        }
        return null;
      };
  });
}

test('Coding renders workspace session tabs and the single path menu', async ({ page }) => {
  await installKernelMock(page);
  await page.goto('/coding');

  await expect(page.getByRole('tab', { name: 'CTRL' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Research' })).toBeVisible();

  const addPath = page.getByRole('button', { name: 'Add a file or folder path' });
  await expect(addPath).toBeVisible();
  await addPath.click();
  await expect(page.getByRole('menuitem', { name: 'Add file path' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add folder path' })).toBeVisible();

  await page.screenshot({ path: 'test-results/coding-session-path-menu.png', fullPage: false });
});
