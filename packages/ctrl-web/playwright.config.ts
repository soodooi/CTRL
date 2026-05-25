import { defineConfig, devices } from '@playwright/test';

// Single-worker, single-browser, screenshot-rich config. Optimized for the
// "I want to SEE what the user sees" workflow — every spec ends with a
// screenshot Claude can Read.
//
// Boots `vite dev` with VITE_PLAYWRIGHT=true so main.tsx loads
// `src/test-harness.ts` which installs `mockIPC()`. No Tauri build needed.

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { VITE_PLAYWRIGHT: 'true' },
  },
});
