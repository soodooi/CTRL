import { defineConfig } from 'vitest/config';

// Standalone test config — intentionally does NOT inherit vite.config.ts
// plugins (react / vite-plugin-pwa) or the `@` alias. Irisy unit tests are
// pure TS / node: no JSX transform, no service-worker generation, and the
// specs import their targets by relative path. Keeping this minimal mirrors
// packages/ctrl-stss/vitest.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
