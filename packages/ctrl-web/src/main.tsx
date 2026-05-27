// CTRL PWA entry point.
//
// Mounts <App />, registers the service worker via vite-plugin-pwa, and
// applies the user's persisted theme preference at the earliest moment
// (before React renders) so the first paint doesn't flash the wrong
// background.
//
// Per bao 2026-05-25 ("试试明亮色") + 2026-05-26 ("改成白色的主题"):
// light is the product default. Dark is opt-in via Settings → General.
//
// StrictMode is enabled in production builds only — dev mode skips it to
// avoid the double-mount cost on each hotkey-triggered WebView rebuild
// (every keystroke triggers a fresh load while the launcher uses Tauri's
// destroy + rebuild pattern, see src-tauri/src/shell/window.rs header).

import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './app';
import { applyTheme, getStoredTheme } from './lib/theme';

applyTheme(getStoredTheme());

const root = document.getElementById('root');
if (!root) throw new Error('PWA root element missing');

if (import.meta.env.PROD) {
  const { StrictMode } = await import('react');
  createRoot(root).render(<StrictMode><App /></StrictMode>);
} else {
  createRoot(root).render(<App />);
}
