import { test, expect } from '@playwright/test';

// Irisy chat — verifies session persistence to the vault:
//   user send → vault_write(create session file) → stream → vault_write(append turns)
//   sidebar list reads via vault_list + vault_read
//   click existing session → vault_read → transcript restored
//
// Vault commands are intercepted with an in-memory store inside the
// page, so the round-trip exercises real PWA logic end-to-end without
// touching disk or the Rust kernel.

// Race-free vault override: we trap the assignment to `__CTRL_TEST` via
// a getter/setter pair so the moment the harness installs it (during
// main.tsx top-level await), our overrides are also registered — BEFORE
// any React effect can call invoke('vault_list'). Storage outlives
// __CTRL_TEST.reset() so subsequent navigations keep their persisted
// sessions.
const VAULT_STORE_INIT = `
  window.__CTRL_VAULT_STORE = window.__CTRL_VAULT_STORE || new Map();
  const applyOverrides = (api) => {
    const store = window.__CTRL_VAULT_STORE;
    api.overrideInvoke('vault_write', (args) => {
      const { path, content, frontmatter } = args.args;
      const fm = frontmatter ?? {};
      store.set(path, { path, frontmatter: fm, content });
      return { absolute_path: '/tmp/vault/' + path, path };
    });
    api.overrideInvoke('vault_list', (args) => {
      const subdir = args.args.subdir ?? '';
      const prefix = subdir ? subdir + '/' : '';
      return Array.from(store.keys()).filter((p) => p.startsWith(prefix));
    });
    api.overrideInvoke('vault_read', (args) => {
      const entry = store.get(args.args.path);
      if (!entry) throw new Error('not found: ' + args.args.path);
      return entry;
    });
  };
  let stored;
  Object.defineProperty(window, '__CTRL_TEST', {
    configurable: true,
    get() { return stored; },
    set(v) { stored = v; if (v && typeof v.overrideInvoke === 'function') applyOverrides(v); },
  });
`;

test.describe('Irisy chat persistence (vault round-trip)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(VAULT_STORE_INIT);
  });

  test('first send creates a session, sidebar lists it after stream done', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__CTRL_TEST != null);

    // Script a short stream so the assert below is deterministic.
    await page.evaluate(() => {
      (window as any).__CTRL_TEST.setChatScript({
        chunks: ['Hi there.'],
        delayMs: 5,
      });
    });

    const input = page.getByPlaceholder(/Ask Irisy/i);
    await input.fill('Plan my Monday morning');
    await input.press('Enter');

    // Wait for the assistant reply to finish streaming.
    await expect(page.getByText('Hi there.')).toBeVisible({ timeout: 5_000 });

    // The persisted session should appear in the right-rail sidebar as a
    // clickable history item (under the Today bucket).
    await expect(
      page.getByRole('button', { name: /Plan my Monday morning/ }),
    ).toBeVisible({ timeout: 5_000 });

    // Vault should now hold exactly one session file with both turns.
    // Note: filter to `.irisy-sessions/*` only — `.irisy-prompts/irisy-system.md`
    // also lands here on mount via ensurePromptsBootstrap (Irisy persona).
    const persisted = await page.evaluate(() => {
      const store: Map<string, { path: string; content: string; frontmatter: Record<string, unknown> }> =
        (window as any).__CTRL_VAULT_STORE;
      return Array.from(store.values())
        .filter((e) => e.path.startsWith('.irisy-sessions/'))
        .map((e) => ({
          path: e.path,
          title: e.frontmatter.title,
          kind: e.frontmatter.kind,
          body: e.content,
        }));
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].kind).toBe('irisy-session');
    expect(persisted[0].title).toBe('Plan my Monday morning');
    expect(persisted[0].path).toMatch(/^\.irisy-sessions\/.+\.md$/);
    expect(persisted[0].body).toContain('## user');
    expect(persisted[0].body).toContain('Plan my Monday morning');
    expect(persisted[0].body).toContain('## assistant');
    expect(persisted[0].body).toContain('Hi there.');

    await page.screenshot({
      path: 'tests/e2e/__screenshots__/irisy-sessions-after-send.png',
      animations: 'disabled',
    });
  });

  test('clicking a past session resumes its transcript', async ({ page }) => {
    // Pre-seed the in-memory vault store BEFORE any navigation — simulates
    // the user arriving on a fresh launch with prior chats on disk.
    await page.addInitScript(() => {
      const store: Map<string, { path: string; content: string; frontmatter: Record<string, unknown> }> =
        (window as any).__CTRL_VAULT_STORE = (window as any).__CTRL_VAULT_STORE || new Map();
      store.set('.irisy-sessions/seed-001.md', {
        path: '.irisy-sessions/seed-001.md',
        frontmatter: {
          kind: 'irisy-session',
          id: 'seed-001',
          title: 'Earlier discussion about Coze',
          created_at: '2026-05-23T10:00:00.000Z',
          updated_at: new Date().toISOString(),
        },
        content:
          '## user\nremind me what we said about Coze\n\n## assistant\nWe agreed not to ship a Coze keycap in v1.',
      });
    });

    await page.goto('/');
    await page.waitForFunction(() => (window as any).__CTRL_TEST != null);

    const sessionBtn = page.getByRole('button', {
      name: /Earlier discussion about Coze/,
    });
    await expect(sessionBtn).toBeVisible({ timeout: 5_000 });
    await sessionBtn.click();

    // Transcript should now show both restored turns.
    await expect(
      page.getByText('remind me what we said about Coze'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByText('We agreed not to ship a Coze keycap in v1.'),
    ).toBeVisible();

    await page.screenshot({
      path: 'tests/e2e/__screenshots__/irisy-sessions-resumed.png',
      animations: 'disabled',
    });
  });
});
