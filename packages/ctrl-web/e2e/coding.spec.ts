import { test, expect } from '@playwright/test';

// Browser-only harness: the production app intentionally reserves a bare
// browser for the remote-entry surface. This dev mock lets Playwright exercise
// the desktop React shell without pretending that a browser is Tauri.
function installKernelMock(
  page: import('@playwright/test').Page,
  singleProject = false,
): Promise<void> {
  return page.addInitScript((useSingleProject) => {
    const harness = window as unknown as {
      __ctrlInvokeMock: (command: string) => unknown;
      __ctrlCommands: string[];
    };
    harness.__ctrlCommands = [];
    harness.__ctrlInvokeMock = (command) => {
      harness.__ctrlCommands.push(command);
      if (command === 'coding_launcher_status') {
          return {
            workspaces: useSingleProject
              ? [{ id: 'root', label: 'CTRL', path: '/tmp/ctrl', opencodeConfigPresent: true }]
              : [
                  { id: 'root', label: 'CTRL', path: '/tmp/ctrl', opencodeConfigPresent: true },
                  { id: 'research', label: 'Research', path: '/tmp/ctrl/Research', opencodeConfigPresent: true },
                ],
            terminals: [],
            editors: [],
            opencodeAvailable: false,
            launchCommand: null,
          };
        }
        if (command === 'list_local_skills') {
          return [
            {
              name: 'create-feature-pack',
              description: 'Create a governed CTRL feature pack.',
              path: '/tmp/create-feature-pack/SKILL.md',
            },
            {
              name: 'office',
              description: 'Use an explicit LibreOffice selection.',
              path: '/tmp/office/SKILL.md',
            },
          ];
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
  }, singleProject);
}

test('Coding uses one persistent composer with real identity, resource, and skill controls', async ({ page }) => {
  await installKernelMock(page);
  await page.goto('/coding');

  const dialog = page.getByLabel('Persistent agent dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveCount(1);

  const identity = dialog.getByRole('combobox', { name: 'Irisy identity' });
  await expect(identity).toHaveValue('coding');
  await expect(identity.locator('option:checked')).toHaveText('Coding');

  const resource = dialog.getByRole('combobox', { name: 'Resource' });
  await expect(resource).toHaveValue('root');
  await expect(resource.locator('option')).toHaveText(['CTRL', 'Research']);
  await resource.selectOption('research');
  await expect(resource).toHaveValue('research');

  const skill = dialog.getByRole('combobox', { name: 'Skill' });
  await expect(skill.locator('option')).toHaveText([
    'Skill: Auto',
    'create-feature-pack',
    'office',
  ]);
  await skill.selectOption('office');
  await expect(skill).toHaveValue('office');

  await expect(dialog.getByRole('button', { name: 'Add files or folders' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'CTRL' })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: 'Research' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Coding', exact: true })).toHaveCount(0);

  await identity.selectOption('irisy');
  await expect(dialog.getByRole('textbox')).toHaveCount(1);
  await expect(dialog.getByRole('combobox', { name: 'Irisy identity' })).toHaveValue('irisy');
  await expect(dialog.getByRole('combobox', { name: 'Irisy identity' }).locator('option:checked')).toHaveText('Assistant');

  const assistantInput = dialog.getByRole('textbox');
  await assistantInput.fill(':tables');
  await assistantInput.press('Enter');
  await expect(dialog.getByText('Resource: Smart Tables', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as { __ctrlCommands: string[] }).__ctrlCommands
      .filter((command) => command === 'irisy_reset_engine').length
  ))).toBeGreaterThan(0);
});

test('Coding auto-binds one project without showing a redundant Resource control', async ({ page }) => {
  await installKernelMock(page, true);
  await page.goto('/coding');

  const dialog = page.getByLabel('Persistent agent dialog');
  await expect(dialog.getByRole('combobox', { name: 'Irisy identity' })).toHaveValue('coding');
  await expect(dialog.getByRole('combobox', { name: 'Resource' })).toHaveCount(0);
  await expect(dialog.getByRole('textbox')).toHaveAttribute('placeholder', 'Set up Irisy Coding first…');
  await expect(dialog.getByRole('combobox', { name: 'Skill' })).toBeVisible();
});
