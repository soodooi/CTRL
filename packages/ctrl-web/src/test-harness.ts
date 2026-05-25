// Playwright/E2E harness — only loaded when `VITE_PLAYWRIGHT=true`.
//
// Wires `@tauri-apps/api/mocks` to provide deterministic responses to
// every `invoke()` the PWA makes, and exposes `window.__CTRL_TEST` for
// per-spec overrides. Tree-shaken from prod builds: main.tsx imports
// this only inside an env-guarded branch.
//
// Default behavior (overridable per-spec):
//   • `chat_stream` — schedules deltas + done via the Tauri event bus
//     so the PWA's ChatStreamTransport sees a real-shaped stream
//   • `kernel_status` — green KRN, no warnings, Volc adapter, MCP 0
//   • `app_meta` — pkg version
//   • `check_for_updates` / `force_check_for_updates` — "up_to_date"
//   • `list_keycaps` — 6 seed cards
//   • Everything else — `null` (override per-test via window.__CTRL_TEST)

import { mockIPC, mockWindows, clearMocks } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';

// `mockWindows` declares the current window label; required before any
// `@tauri-apps/api/window` usage in non-Tauri contexts. Without it,
// `emit()` silently no-ops because the IPC layer has no "current window"
// to route events through.
mockWindows('main');

interface ChatDeltaScript {
  /** Chunks emitted before `done`. */
  chunks: string[];
  /** Delay between chunks in ms (default 5). */
  delayMs?: number;
  /** Emit an `error` instead of `done`. */
  error?: string;
}

interface CtrlTestApi {
  /** Override the chat_stream script for the next send. Default = single
   *  chunk "测试回复". */
  setChatScript: (script: ChatDeltaScript) => void;
  /** Replace any invoke handler — pass `null` to clear and revert to
   *  the default mock for that command. */
  overrideInvoke: (
    cmd: string,
    handler: ((args: unknown) => unknown | Promise<unknown>) | null,
  ) => void;
  /** Wipe all overrides + reset chat script. */
  reset: () => void;
}

declare global {
  interface Window {
    __CTRL_TEST: CtrlTestApi;
  }
}

const DEFAULT_CHAT_SCRIPT: ChatDeltaScript = {
  chunks: ['测试回复'],
  delayMs: 5,
};

let chatScript: ChatDeltaScript = DEFAULT_CHAT_SCRIPT;
const overrides = new Map<
  string,
  (args: unknown) => unknown | Promise<unknown>
>();

const defaultHandlers: Record<
  string,
  (args: unknown) => unknown | Promise<unknown>
> = {
  app_meta: () => ({ version: __APP_VERSION__, built_at: 'test' }),
  kernel_status: () => ({
    uptime_ms: 1000,
    llm_adapters: ['volc'],
    primary_adapter: 'volc',
    mcp_servers_installed: 0,
    vault_files: 0,
    stss_bridge_addr: '127.0.0.1:17872',
    warnings: [],
    overall: 'ok',
    hermes_dashboard_url: null,
  }),
  check_for_updates: () => ({
    kind: 'up_to_date',
    available_version: null,
    message: "You're on the latest build.",
  }),
  force_check_for_updates: () => ({
    kind: 'up_to_date',
    available_version: null,
    message: "You're on the latest build.",
  }),
  list_keycaps: () => [
    { id: 'ctrl-chat', name: 'CTRL Chat', keycap_color: 'cobalt', icon: '💬' },
    { id: 'clipboard-ai', name: '改写粘贴', keycap_color: 'amber', icon: '✦' },
    { id: 'ai-translate', name: 'AI 翻译', keycap_color: 'jade', icon: '译' },
    { id: 'ai-ocr', name: 'AI OCR', keycap_color: 'platinum', icon: '◫' },
    { id: 'ai-text', name: '文本处理', keycap_color: 'graphite', icon: 'Aa' },
    { id: 'code-space', name: 'Code Space', keycap_color: 'graphite', icon: '⌨' },
  ],
  chat_stream: (args: unknown) => {
    const innerArgs =
      (args as { args?: { request_id?: string; messages?: unknown } } | undefined)
        ?.args ?? {};
    const requestId = innerArgs.request_id ?? 'unknown';
    // Record every chat_stream invocation so specs can assert on the
    // messages array (e.g. that a system prompt was prepended). Reset
    // explicitly via `__CTRL_TEST.reset` between tests.
    const w = window as unknown as { __CHAT_STREAM_LOG?: unknown[] };
    if (!Array.isArray(w.__CHAT_STREAM_LOG)) w.__CHAT_STREAM_LOG = [];
    w.__CHAT_STREAM_LOG.push(innerArgs);
    const script = chatScript;
    void (async () => {
      for (const delta of script.chunks) {
        await sleep(script.delayMs ?? 5);
        await emit('chat-stream-delta', { request_id: requestId, delta });
      }
      await sleep(script.delayMs ?? 5);
      if (script.error) {
        await emit('chat-stream-delta', {
          request_id: requestId,
          error: script.error,
          done: true,
        });
      } else {
        await emit('chat-stream-delta', { request_id: requestId, done: true });
      }
    })();
    return null;
  },
  // No-op handlers — UI components invoke these on mount but tests
  // don't care about the return values.
  subscribe: () => null,
  publish: () => null,
  list_streams: () => [],
  get_bridge_token: () => 'test-token',
  read_log: () => [],
  query: () => [],
  vault_list: () => [],
  vault_search: () => [],
  // Match the real kernel shape — { path, frontmatter, content }. Specs
  // that wire vault round-trips override this with an in-memory store.
  vault_read: (args: unknown) => ({
    path: (args as { args?: { path?: string } } | undefined)?.args?.path ?? '',
    frontmatter: {},
    content: '',
  }),
  vault_write: (args: unknown) => ({
    absolute_path: '/tmp/test-vault/' + ((args as { args?: { path?: string } } | undefined)?.args?.path ?? ''),
    path: (args as { args?: { path?: string } } | undefined)?.args?.path ?? '',
  }),
  vault_root_path: () => '/tmp/test-vault',
  vault_rebuild_index: () => null,
  hide_window: () => null,
  open_workspace: () => null,
  irisy_init: () => ({
    kernel_llm: { ready: true, primary_adapter: 'volc' },
    hermes: { binary_path: null, version: null, brain_configured: false, plugin_enabled: false },
    app_version: __APP_VERSION__,
  }),
  system_check: () => ({ python: false, pipx: false, hermes: false, plugin: false }),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

mockIPC(
  (cmd, args) => {
    const override = overrides.get(cmd);
    if (override) return override(args);
    const handler = defaultHandlers[cmd];
    if (handler) return handler(args);
    // Unknown command — return null + warn so tests notice they need a mock.
    // eslint-disable-next-line no-console
    console.warn(`[test-harness] no mock for invoke('${cmd}')`);
    return null;
  },
  { shouldMockEvents: true },
);

window.__CTRL_TEST = {
  setChatScript: (script) => {
    chatScript = script;
  },
  overrideInvoke: (cmd, handler) => {
    if (handler === null) {
      overrides.delete(cmd);
    } else {
      overrides.set(cmd, handler);
    }
  },
  reset: () => {
    overrides.clear();
    chatScript = DEFAULT_CHAT_SCRIPT;
    (window as unknown as { __CHAT_STREAM_LOG: unknown[] }).__CHAT_STREAM_LOG = [];
    clearMocks();
    mockWindows('main');
    // Re-install the default mock after clearing.
    mockIPC(
      (cmd, args) => {
        const handler = defaultHandlers[cmd];
        return handler ? handler(args) : null;
      },
      { shouldMockEvents: true },
    );
  },
};
