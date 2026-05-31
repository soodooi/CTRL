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

const { App } = await import('./app');
if (import.meta.env.PROD) {
  const { StrictMode } = await import('react');
  createRoot(root).render(<StrictMode><App /></StrictMode>);
} else {
  createRoot(root).render(<App />);
}
