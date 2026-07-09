// CTRL PWA entry point.
//
// Renders <App /> — the cockpit shell — in the main window. The legacy
// input-companion window surface (?surface=input → <InputSurface />) was
// retired 2026-05-31; the composer now lives inside the Irisy chat
// column. The workspace surface (?surface=workspace) is similarly
// inlined into App now that workspace expansion is a main-window resize
// rather than an OS-level second window.

import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { applyTheme, getStoredTheme } from './lib/theme';

applyTheme(getStoredTheme());

// The desktop Tauri webview must NEVER run a service worker — the SW exists only
// for the phone PWA (app.ctrlapplab.com), where offline caching matters. Inside
// the desktop shell a cached SW is pure harm: it serves a stale bundle across
// app restarts (living in the WKWebView data dir, not cleared by relaunch),
// which shows up as old code calling retired gate tools + stale kernel tokens.
// So on the desktop, proactively unregister any SW + drop its caches on boot.
// Do NOT reload here: in dev the plugin re-registers the SW on every load, so a
// reload-on-found would loop forever (blank screen). Unregistering is enough —
// vite already serves fresh modules, and the SW won't control the next load.
if ('__TAURI_INTERNALS__' in window) {
  void (async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      if (regs?.length) await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches?.keys?.();
      if (keys?.length) await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      /* best-effort — never block boot on cache cleanup */
    }
  })();
}

// ⌘R / Ctrl+R reloads the PWA. Tauri 2 doesn't bind this by default
// (unlike a normal browser), so without this the user has no way to
// recover from a stale bundle short of quitting. Tray menu "Reload PWA"
// is the always-available fallback; this listener is the fast path
// when the window is focused. Skip in prod-build browser preview where
// ⌘R is already the browser's reload.
if (!import.meta.env.PROD || '__TAURI_INTERNALS__' in window) {
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      window.location.reload();
    }
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('PWA root element missing');

// bao 2026-06-01: mcp page (WorkspaceSurface) retired. Cockpit now
// hosts the workspace tab area inline (L1 + L2 + Tab + Irisy 4-col
// shell). The `?surface=workspace` branch is removed; any URL surface
// param is ignored. Toggling the main window 430 ↔ 1600 still works
// via the existing `toggle_workspace_window` Tauri command (the `>`
// chevron at the top of L1).
const { App } = await import('./app');
if (import.meta.env.PROD) {
  const { StrictMode } = await import('react');
  createRoot(root).render(<StrictMode><App /></StrictMode>);
} else {
  createRoot(root).render(<App />);
}
