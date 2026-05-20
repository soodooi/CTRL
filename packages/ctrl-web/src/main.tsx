// CTRL PWA entry point.
//
// Mounts <App />, registers the service worker via vite-plugin-pwa, and
// applies the dark theme by default (deliberate, not auto-OS).
//
// StrictMode is enabled in production builds only — dev mode skips it to
// avoid the double-mount cost on each hotkey-triggered WebView rebuild
// (every keystroke triggers a fresh load while the launcher uses Tauri's
// destroy + rebuild pattern, see src-tauri/src/shell/window.rs header).

import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './app';

document.documentElement.dataset.theme = 'dark';

const root = document.getElementById('root');
if (!root) throw new Error('PWA root element missing');

if (import.meta.env.PROD) {
  const { StrictMode } = await import('react');
  createRoot(root).render(<StrictMode><App /></StrictMode>);
} else {
  createRoot(root).render(<App />);
}
