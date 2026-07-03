// CTRL modification (AGPL section 5 notice; ADR-002 section 1.9 v47):
// iframe IPC bridge. When this app is EMBEDDED in the CTRL workspace via a
// same-origin iframe, Tauri does not inject `__TAURI_INTERNALS__` into child
// frames — so we install a shim that proxies every invoke over postMessage to
// the parent (which executes the real Tauri invoke and posts the result
// back). Event callbacks are forwarded by the parent per handler id. In the
// standalone WebviewWindow (real internals present) or a plain browser tab
// (mock layer) this module does nothing.
(function installCtrlBridge() {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI_INTERNALS__) return; // real Tauri window — no bridge needed
  if (window.parent === window) return; // not embedded — upstream mock layer

  let seq = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  const callbacks = new Map<number, (payload: unknown) => void>();

  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.origin !== window.origin) return;
    const d = ev.data as
      | { __ctrlNotesBridge?: boolean; kind?: string; id?: number; ok?: boolean; value?: unknown; error?: unknown; handler?: number; payload?: unknown }
      | null;
    if (!d || d.__ctrlNotesBridge !== true) return;
    if (d.kind === 'invoke-result' && typeof d.id === 'number') {
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d.value);
      else p.reject(new Error(String(d.error)));
    } else if (d.kind === 'event' && typeof d.handler === 'number') {
      callbacks.get(d.handler)?.(d.payload);
    }
  });

  const post = (msg: Record<string, unknown>) =>
    window.parent.postMessage({ ...msg, __ctrlNotesBridge: true }, window.origin);

  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', window: { label: 'main' } },
    },
    transformCallback(cb: (payload: unknown) => void, once = false): number {
      const id = seq++;
      callbacks.set(id, (p) => {
        if (once) callbacks.delete(id);
        cb(p);
      });
      return id;
    },
    convertFileSrc(filePath: string, protocol = 'asset'): string {
      const path = encodeURIComponent(filePath);
      return navigator.userAgent.includes('Windows')
        ? `http://${protocol}.localhost/${path}`
        : `${protocol}://localhost/${path}`;
    },
    invoke(cmd: string, args: unknown = {}, options?: unknown): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const id = seq++;
        pending.set(id, { resolve, reject });
        post({ kind: 'invoke', id, cmd, args, options });
      });
    },
  };
})();

export {};
