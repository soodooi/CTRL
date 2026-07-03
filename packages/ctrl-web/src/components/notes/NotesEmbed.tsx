// NotesEmbed — the vendored Tolaria notes UI rendered INSIDE the CTRL
// workspace (ADR-002 §1.9 v47; bao 2026-07-02 "放在 ctrl 显示"). Tauri does
// not inject IPC into iframes, so this component is the parent half of the
// bridge: the iframe's shim (ctrl-notes-ui/src/ctrl-bridge.ts) forwards every
// invoke over postMessage; we execute it with the REAL Tauri invoke and post
// the result back. `plugin:event|listen` handlers are substituted with a
// parent-side callback that forwards event payloads to the iframe by the
// iframe's own handler id. Same-origin only (origin-checked both ways).

import { useEffect, useRef, type ReactElement } from 'react';

interface BridgeInvokeMsg {
  __ctrlNotesBridge: true;
  kind: 'invoke';
  id: number;
  cmd: string;
  args?: Record<string, unknown>;
  options?: unknown;
}

export const NotesEmbed = (): ReactElement => {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const onMessage = async (ev: MessageEvent): Promise<void> => {
      if (ev.origin !== window.origin) return;
      if (ev.source !== frameRef.current?.contentWindow) return;
      const d = ev.data as BridgeInvokeMsg | null;
      if (!d || d.__ctrlNotesBridge !== true || d.kind !== 'invoke') return;
      const target = frameRef.current?.contentWindow;
      if (!target) return;
      const reply = (ok: boolean, value: unknown, error?: unknown): void => {
        target.postMessage(
          { __ctrlNotesBridge: true, kind: 'invoke-result', id: d.id, ok, value, error: error != null ? String(error) : undefined },
          window.origin,
        );
      };
      try {
        const core = await import('@tauri-apps/api/core');
        let args: Record<string, unknown> = d.args ?? {};
        // Event subscriptions: the iframe's handler id is meaningless in this
        // frame — substitute a parent callback that forwards the payload back
        // to the iframe under the ORIGINAL id.
        if (
          (d.cmd === 'plugin:event|listen') &&
          typeof args.handler === 'number'
        ) {
          const originalHandler = args.handler as number;
          args = {
            ...args,
            handler: core.transformCallback((payload: unknown) => {
              frameRef.current?.contentWindow?.postMessage(
                { __ctrlNotesBridge: true, kind: 'event', handler: originalHandler, payload },
                window.origin,
              );
            }),
          };
        }
        const value = await core.invoke(d.cmd, args, d.options as never);
        reply(true, value);
      } catch (e) {
        reply(false, undefined, e);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={frameRef}
      src="notes-ui/index.html"
      title="Notes"
      style={{
        width: '100%',
        height: '100%',
        minHeight: 480,
        border: 'none',
        display: 'block',
        background: 'transparent',
      }}
    />
  );
};
