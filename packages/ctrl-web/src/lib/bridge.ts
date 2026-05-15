// @ctrl/web — kernel bridge: Tauri 2 invoke on desktop, WS fallback on mobile.
//
// Per ADR-002 §5 + spec.md §3 + spec.md §3 transport row. One API surface,
// two transports underneath. App code never branches on platform; the bridge
// picks the right transport when the module first loads.
//
// Detect Tauri context by checking `window.__TAURI_INTERNALS__` (Tauri 2
// injection). If absent, fall back to the WS bridge URL (defaults to the
// localhost dev port; production wires a tunnel URL on first run setup).

import type { InvokeArgs } from '@tauri-apps/api/core';

const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  // @ts-expect-error — Tauri injects this at runtime
  Boolean(window.__TAURI_INTERNALS__);

let wsBridgeUrl: string | null = null;
export const configureWsBridge = (url: string): void => {
  wsBridgeUrl = url;
};

/**
 * Generic kernel invocation. On desktop (Tauri WebView) it's a direct IPC
 * to Rust; on mobile (browser) it serializes a request/response envelope
 * over WebSocket against the same handler names.
 *
 * Handler names align with `src-tauri/src/commands/*.rs` and
 * `pwa_invoke_handler!` macro.
 */
export const invoke = async <T = unknown>(
  command: string,
  args?: InvokeArgs,
): Promise<T> => {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(command, args);
  }
  return wsInvoke<T>(command, args);
};

// --- WS transport ---

let wsConn: WebSocket | null = null;
let wsConnPromise: Promise<WebSocket> | null = null;
let nextRequestId = 0;
const pending = new Map<number, (value: unknown) => void>();
const rejected = new Map<number, (reason: unknown) => void>();

/** Per-invoke timeout. Mobile networks routinely stall mid-roundtrip; without
 *  a deadline, dead promises and their map entries accumulate forever. */
const WS_INVOKE_TIMEOUT_MS = 15_000;

const openWs = async (): Promise<WebSocket> => {
  if (wsConn && wsConn.readyState === WebSocket.OPEN) return wsConn;
  if (wsConnPromise) return wsConnPromise;
  const url = wsBridgeUrl ?? 'ws://127.0.0.1:17872';
  wsConnPromise = new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      wsConn = ws;
      // Clear the promise so a future CLOSING transition forces a fresh
      // connection attempt instead of reusing a stale resolved Promise.
      wsConnPromise = null;
      resolve(ws);
    };
    ws.onerror = (e) => {
      wsConn = null;
      wsConnPromise = null;
      reject(e);
    };
    ws.onclose = () => {
      wsConn = null;
      wsConnPromise = null;
    };
    ws.onmessage = (ev) => {
      // Minimal JSON envelope for invoke; the cell/op stream uses CBOR on a
      // separate channel handled by useStream().
      try {
        const text = typeof ev.data === 'string'
          ? ev.data
          : new TextDecoder().decode(ev.data as ArrayBuffer);
        const msg = JSON.parse(text) as { id?: number; result?: unknown; error?: string };
        if (typeof msg.id !== 'number') return;
        if (msg.error !== undefined) {
          rejected.get(msg.id)?.(new Error(msg.error));
        } else {
          pending.get(msg.id)?.(msg.result);
        }
        pending.delete(msg.id);
        rejected.delete(msg.id);
      } catch {
        // ignore: cell stream frames are CBOR binary, handled elsewhere.
      }
    };
  });
  return wsConnPromise;
};

const wsInvoke = async <T>(command: string, args?: InvokeArgs): Promise<T> => {
  const ws = await openWs();
  const id = nextRequestId++;
  const payload = JSON.stringify({ id, command, args: args ?? {} });
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      rejected.delete(id);
      reject(new Error(`ws invoke timeout (${WS_INVOKE_TIMEOUT_MS}ms): ${command}`));
    }, WS_INVOKE_TIMEOUT_MS);
    pending.set(id, (v) => {
      window.clearTimeout(timer);
      resolve(v as T);
    });
    rejected.set(id, (e) => {
      window.clearTimeout(timer);
      reject(e);
    });
    ws.send(payload);
  });
};

export const platform = (): 'tauri' | 'web' => (isTauri() ? 'tauri' : 'web');

// Best-effort cleanup so mobile browsers (and Tauri WebView reloads) don't
// accumulate WebSocket connections on tab close / hide. Tauri intra-process
// invoke does not go through this path, so the listener is a no-op on
// desktop apart from a single close() call at shutdown.
if (typeof window !== 'undefined') {
  const closeWs = (): void => {
    if (wsConn && wsConn.readyState !== WebSocket.CLOSED) {
      try {
        wsConn.close(1000, 'pwa shutdown');
      } catch {
        // ignore: socket may already be closing.
      }
    }
    wsConn = null;
    wsConnPromise = null;
  };
  window.addEventListener('beforeunload', closeWs);
  window.addEventListener('pagehide', closeWs);
}
