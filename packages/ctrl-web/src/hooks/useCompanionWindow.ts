// useCompanionWindow — runs once at app root mount in the MAIN window.
// Anchors the main window top-right of the primary monitor.
//
// 2026-05-31 (bao "输入框和对话框可以合二为一"): the separate Tauri
// "input" window is RETIRED. The composer now lives at the bottom of
// the Irisy chat column inside the main window (see IrisyChat.tsx).
// We still call `destroy_input_window` here so any persisted input
// window from a previous launch is closed; the spawn call is gone.
//
// Tauri-side: `spawn_input_window` / `destroy_input_window` /
// `position_window_top_right` are kernel commands. Removing the
// underlying Rust command + InputSurface.tsx is a separate (zeus-lane)
// PR — this hook just stops the frontend from invoking the spawn.

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
        await invoke('destroy_input_window');
      } catch {
        /* command may not exist on older kernels; silently skip */
      }
    })();
  }, []);
};
