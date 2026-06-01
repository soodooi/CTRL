import { defineConfig, devices } from '@playwright/test';

// ADR-003 frontend §7 v4 — verify the 4-col shell `[Tab | L2 | L1 | Irisy]`
// renders correctly in a real browser (no Tauri native side-effects).
// `invoke()` no-ops via lib/bridge.ts when not inside Tauri, so React
// state still updates but window resize / hotkey etc. don't fire — tests
// must inspect DOM state, not native window geometry.

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    actionTimeout: 5_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
