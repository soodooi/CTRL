// useCompanionWindow — runs once at app root mount in the MAIN window.
// Anchors the main window top-right of the primary monitor and spawns
// the separate Tauri "input" window beneath it. The input window owns
// its own resize logic (see surfaces/InputSurface.tsx).
//
// bao 2026-05-30: two-window companion. Main = chat history (文本框,
// iPhone 15 Pro Max sized). Input = textarea + send (对话框, grows
// downward independently). The two windows are visually stacked but
// each owns its own height.

import { useEffect } from 'react';
import { invoke } from '../lib/bridge';

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const useCompanionWindow = (): void => {
  useEffect(() => {
    if (!isTauri()) return;
    void (async () => {
      try {
        await invoke('position_window_top_right');
      } catch {
        /* browser PWA or window not ready */
      }
      try {
        await invoke('spawn_input_window');
      } catch {
        /* already created or unsupported — silently skip */
      }
    })();
  }, []);
};
