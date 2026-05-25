import { test, expect } from '@playwright/test';

// Irisy chat — verifies the PWA wire:
//   ChatInput → handleSend → ChatStreamTransport
//   → invoke('chat_stream') → emit('chat-stream-delta')
//   → transcript renders deltas streaming in.
//
// The Volc roundtrip itself is proven separately (kernel MCP llm_chat
// curl test). This spec covers the PWA-side wire only — mocks
// chat_stream to emit deltas the transport then consumes.

test.describe('Irisy chat (mocked stream)', () => {
  test('send a message, see streamed reply', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__CTRL_TEST != null);

    // Script the mocked stream: 4 deltas combining into "你好, Irisy 在."
    await page.evaluate(() => {
      (window as any).__CTRL_TEST.setChatScript({
        chunks: ['你好', ', ', 'Irisy', ' 在.'],
        delayMs: 20,
      });
    });

    const input = page.getByPlaceholder(/Ask Irisy/i);
    await input.fill('用一句中文打招呼');
    await input.press('Enter');

    // User turn appears immediately.
    await expect(page.getByText('用一句中文打招呼')).toBeVisible();

    // Assistant turn streams in; final content shows full string.
    await expect(page.getByText('你好, Irisy 在.')).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: 'tests/e2e/__screenshots__/irisy-chat-reply.png',
      animations: 'disabled',
    });
  });

  test('new chat closes lingering workspace tabs', async ({ page }) => {
    await page.addInitScript(() => {
      // Pre-seed an open Hermes Settings tab in localStorage — mirrors
      // the real-world state bao landed in (clicked Settings, embed
      // persisted, fallback chat input hidden). New chat should clear it.
      window.localStorage.setItem(
        'ctrl-tab-store',
        JSON.stringify({
          state: {
            tabs: [
              {
                id: 'tab-hermes',
                kind: 'external-embed',
                title: 'Hermes Settings',
                url: 'http://127.0.0.1:9119',
              },
            ],
            activeId: 'tab-hermes',
          },
          version: 0,
        }),
      );
    });
    await page.goto('/');
    // With the tab persisted, the chat input is hidden (tab content shown).
    await expect(page.getByPlaceholder(/Ask Irisy/i)).toHaveCount(0);
    const newChat = page.getByRole('button', { name: /New chat/i });
    await newChat.click();
    // After New chat: tabs cleared, fallback chat input visible.
    await expect(page.getByPlaceholder(/Ask Irisy/i)).toBeVisible({
      timeout: 2_000,
    });
  });

  test('new chat clears the transcript', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__CTRL_TEST != null);
    await page.evaluate(() => {
      (window as any).__CTRL_TEST.setChatScript({
        chunks: ['先一条历史消息.'],
        delayMs: 10,
      });
    });

    const input = page.getByPlaceholder(/Ask Irisy/i);
    await input.fill('第一条');
    await input.press('Enter');
    await expect(page.getByText('先一条历史消息.')).toBeVisible({ timeout: 5_000 });

    // Open the 一级 Irisy item's 二级 sub-panel (default state already
    // has Irisy active, so the New chat button is directly visible).
    const newChat = page.getByRole('button', { name: /New chat/i });
    await newChat.click();

    // Transcript should be empty — greeting visible again, history gone.
    await expect(page.getByText('先一条历史消息.')).toBeHidden({ timeout: 2_000 });
    await expect(page.getByText(/What are we doing today/i)).toBeVisible();
    await page.screenshot({
      path: 'tests/e2e/__screenshots__/irisy-chat-new.png',
      animations: 'disabled',
    });
  });
});
