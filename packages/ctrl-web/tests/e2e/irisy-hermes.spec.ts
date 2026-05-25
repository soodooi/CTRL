import { test, expect } from '@playwright/test';

// Hermes wire — verifies the irisy_chat_hermes path AND the session-id
// namespacing rule that bao hit in production (2026-05-25):
//   "hermes error: Session not found: <vault-uuid>"
//   We must never pass the vault session id to hermes — they're disjoint
//   namespaces. First turn = no --resume; capture hermes' returned
//   session_id; persist it; pass it on every subsequent turn.

test.describe('Irisy chat (hybrid routing)', () => {
  test('default route: no prefix uses chat_stream even when hermes ready', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as any).__HERMES_CALLS = [];
      const apply = (): void => {
        const api = (window as any).__CTRL_TEST;
        if (!api) {
          setTimeout(apply, 5);
          return;
        }
        // Hermes IS ready, but no prefix → still chat_stream.
        api.overrideInvoke('irisy_init', () => ({
          kernel_llm: { ready: true, primary_adapter: 'volc' },
          hermes: {
            binary_path: '/Users/mac/.local/bin/hermes',
            version: '0.14.0',
            brain_configured: true,
            plugin_enabled: true,
          },
          app_version: '0.1.30',
        }));
        api.overrideInvoke('irisy_chat_hermes', () => {
          (window as any).__HERMES_CALLS.push({ called: true });
          return { session_id: 'should-not-be-called', content: '', elapsed_ms: 0 };
        });
      };
      apply();
    });
    await page.goto('/');
    const input = page.getByPlaceholder(/Ask Irisy/i);
    await input.fill('Just a normal message');
    await input.press('Enter');
    await expect(page.getByText('测试回复')).toBeVisible({ timeout: 5_000 });
    const hermesCalls = await page.evaluate(() => (window as any).__HERMES_CALLS);
    expect(hermesCalls).toHaveLength(0);
  });

  test('first turn: no session_id; second turn: hermes session id (NOT vault uuid)', async ({
    page,
  }) => {
    // Capture every invoke(irisy_chat_hermes) call so we can assert on
    // the session_id passed across turns.
    await page.addInitScript(() => {
      (window as any).__HERMES_CALLS = [];
      // Hermes ready: all three flags true so the route picks the hermes branch.
      const apply = (): void => {
        const api = (window as any).__CTRL_TEST;
        if (!api) {
          setTimeout(apply, 5);
          return;
        }
        api.overrideInvoke('irisy_init', () => ({
          kernel_llm: { ready: true, primary_adapter: 'volc' },
          hermes: {
            binary_path: '/Users/mac/.local/bin/hermes',
            version: '0.14.0',
            brain_configured: true,
            plugin_enabled: true,
          },
          app_version: '0.1.28',
        }));
        api.overrideInvoke('irisy_chat_hermes', (rawArgs: unknown) => {
          const args = (rawArgs as { args: { prompt: string; session_id?: string; max_turns?: number } }).args;
          (window as any).__HERMES_CALLS.push({
            prompt: args.prompt,
            session_id: args.session_id ?? null,
            max_turns: args.max_turns ?? null,
          });
          // Always return the same hermes session id so the second turn
          // can assert it was reused.
          return {
            session_id: 'hermes-session-abc',
            content: `Hi from Irisy — turn ${(window as any).__HERMES_CALLS.length}`,
            elapsed_ms: 42,
          };
        });
      };
      apply();
    });

    await page.goto('/');
    const input = page.getByPlaceholder(/Ask Irisy/i);

    // Turn 1 — `/hermes` prefix explicitly routes to hermes path
    await input.fill('/hermes Hello');
    await input.press('Enter');
    await expect(page.getByText('Hi from Irisy — turn 1')).toBeVisible({ timeout: 5_000 });

    // Turn 2 — same prefix; verifies multi-turn session id round-trip
    await input.fill('/hermes Follow-up');
    await input.press('Enter');
    await expect(page.getByText('Hi from Irisy — turn 2')).toBeVisible({ timeout: 5_000 });

    // Assert the session-id contract: turn 1 sends nothing (hermes assigns),
    // turn 2 sends back exactly the id hermes returned (NOT our vault uuid).
    const calls = await page.evaluate(() => (window as any).__HERMES_CALLS);
    expect(calls).toHaveLength(2);
    expect(calls[0].session_id).toBeNull();
    expect(calls[1].session_id).toBe('hermes-session-abc');
    // Vault uuid would be a 36-char hyphenated string; the hermes id we
    // returned is the literal string above. If the route ever regresses
    // and passes the vault id, this assertion fails loudly.
    expect(calls[1].session_id).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('falls back to chat_stream with system prompt when hermes not ready', async ({
    page,
  }) => {
    // Hermes-not-ready override; chat_stream uses default harness behavior
    // (emits "测试回复" deltas) and records every call in __CHAT_STREAM_LOG.
    await page.addInitScript(() => {
      const apply = (): void => {
        const api = (window as any).__CTRL_TEST;
        if (!api) {
          setTimeout(apply, 5);
          return;
        }
        api.overrideInvoke('irisy_init', () => ({
          kernel_llm: { ready: true, primary_adapter: 'volc' },
          hermes: {
            binary_path: null,
            version: null,
            brain_configured: false,
            plugin_enabled: false,
          },
          app_version: '0.1.28',
        }));
      };
      apply();
    });

    await page.goto('/');
    const input = page.getByPlaceholder(/Ask Irisy/i);
    await input.fill('Hello');
    await input.press('Enter');
    await expect(page.getByText('测试回复')).toBeVisible({ timeout: 5_000 });

    const calls = await page.evaluate(
      () => (window as any).__CHAT_STREAM_LOG as { messages?: { role: string; content: string }[] }[],
    );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const messages = calls[0]?.messages ?? [];
    // System prompt prepended ⇒ first message is the persona, second is the user.
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toMatch(/Irisy/i);
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('Hello');
  });
});
