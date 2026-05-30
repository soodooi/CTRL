// InputSurface — the standalone composer rendered in the secondary Tauri
// "input" window. Hosts the textarea + send button + auto-grow logic.
// On submit it emits a Tauri event ("irisy:send" with the text payload);
// the main window listens and routes the text to its existing send flow.
//
// Resize logic: a ResizeObserver tracks the wrapper element. Whenever it
// grows / shrinks, we ask Rust to set the input window's height to match
// (capped at ~half-screen). The top edge of this window stays anchored
// directly below the main window — Rust handles position on spawn; this
// surface only owns its own height.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { invoke } from '../lib/bridge';
import styles from './InputSurface.module.css';

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const MAX_TEXTAREA_PX = 200;
const MIN_TEXTAREA_PX = 36;
const RESIZE_DEBOUNCE_MS = 50;

const autoSizeTextarea = (el: HTMLTextAreaElement | null): void => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_TEXTAREA_PX), MAX_TEXTAREA_PX)}px`;
};

export function InputSurface(): ReactElement {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize this Tauri window to match the wrapper's height as the
  // textarea grows.
  useEffect(() => {
    if (!isTauri()) return;
    const el = wrapRef.current;
    if (!el) return;
    let timer: number | null = null;
    const obs = new ResizeObserver(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void invoke('set_input_window_height', { height: el.offsetHeight }).catch(() => {});
      }, RESIZE_DEBOUNCE_MS);
    });
    obs.observe(el);
    return () => {
      obs.disconnect();
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  // Listen for state events from the main window — disable the send
  // button while a turn is in flight.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<{ busy: boolean }>('irisy:state', (e) => {
        setBusy(Boolean(e.payload?.busy));
      });
    })();
    return () => unlisten?.();
  }, []);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || busy) return;
    if (!isTauri()) {
      setInput('');
      return;
    }
    const { emit } = await import('@tauri-apps/api/event');
    await emit('irisy:send', { text });
    setInput('');
    // Clear textarea height immediately so the window snaps back to one line.
    requestAnimationFrame(() => autoSizeTextarea(textareaRef.current));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <div className={styles.composer}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autoSizeTextarea(e.currentTarget);
          }}
          onKeyDown={onKeyDown}
          placeholder="Talk to Irisy — Enter to send · Shift+Enter newline"
          aria-label="Message Irisy"
          disabled={busy}
        />
        <button
          type="button"
          className={styles.sendBtn}
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          aria-label="Send"
          title="Send (Enter)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
