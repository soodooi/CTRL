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
