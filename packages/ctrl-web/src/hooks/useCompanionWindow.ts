// useCompanionWindow — anchors the Tauri main window at the top-right
// edge on first mount, then resizes its height to match the shell's
// content as Irisy gathers messages and the composer grows.
//
// bao 2026-05-30: "整个窗口往下流" — not just text, the whole window
// flows downward as chat grows. Implemented by observing the shell's
// scrollHeight and asking Rust to set_window_height; the top edge stays
// fixed so the bottom edge grows toward the screen floor.
//
// Only active in COMPANION (window inner width < 960) — in EXPANDED the
// user wants a stable working canvas, not a window that jumps.

import { useEffect } from 'react';
import { invoke } from '../lib/bridge';

const COMPANION_BREAKPOINT_PX = 960;
const RESIZE_DEBOUNCE_MS = 80;

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const useCompanionWindow = (shellRef: React.RefObject<HTMLElement | null>): void => {
  // Anchor top-right once on mount.
  useEffect(() => {
    if (!isTauri()) return;
    void invoke('position_window_top_right').catch(() => {
      /* browser PWA or window-not-ready — silently skip */
    });
  }, []);

  // Watch content height; resize the Tauri window to match (capped by
  // the monitor on the Rust side). Skip in EXPANDED mode.
  useEffect(() => {
    if (!isTauri()) return;
    const el = shellRef.current;
    if (!el) return;

    let timer: number | null = null;
    const requestResize = (): void => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (window.innerWidth >= COMPANION_BREAKPOINT_PX) return;
        // Shell is grid-rows: status / 1fr / dialog; in companion the
        // dialog row collapses to 0, so total scrollHeight tracks the
        // status bar + Irisy column content + composer + L1 column.
        const desired = el.scrollHeight;
        void invoke('set_window_height', { height: desired }).catch(() => {
          /* window-not-ready / monitor missing — silently skip */
        });
      }, RESIZE_DEBOUNCE_MS);
    };

    requestResize();
    const observer = new ResizeObserver(requestResize);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [shellRef]);
};
