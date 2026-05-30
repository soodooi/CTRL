// CTRL PWA entry point.
//
// Two render surfaces share this entry:
//   • Main window (default) — renders <App />, the cockpit shell.
//   • Input window (URL has ?surface=input) — renders <InputSurface />,
//     a bare composer / textarea + send. State syncs to main via Tauri
//     events ("irisy:send", "irisy:state"). bao 2026-05-30: 2-window
//     companion design — main = chat history (文本框), input = textarea
//     (对话框); input window's bottom edge grows downward when textarea
//     wraps. The main window's chat history is never asked to shrink.

import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { applyTheme, getStoredTheme } from './lib/theme';

applyTheme(getStoredTheme());

const root = document.getElementById('root');
if (!root) throw new Error('PWA root element missing');

const surface = new URLSearchParams(window.location.search).get('surface');

if (surface === 'input') {
  const { InputSurface } = await import('./surfaces/InputSurface');
  if (import.meta.env.PROD) {
    const { StrictMode } = await import('react');
    createRoot(root).render(<StrictMode><InputSurface /></StrictMode>);
  } else {
    createRoot(root).render(<InputSurface />);
  }
} else if (surface === 'workspace') {
  const { WorkspaceSurface } = await import('./surfaces/WorkspaceSurface');
  if (import.meta.env.PROD) {
    const { StrictMode } = await import('react');
    createRoot(root).render(<StrictMode><WorkspaceSurface /></StrictMode>);
  } else {
    createRoot(root).render(<WorkspaceSurface />);
  }
} else {
  const { App } = await import('./app');
  if (import.meta.env.PROD) {
    const { StrictMode } = await import('react');
    createRoot(root).render(<StrictMode><App /></StrictMode>);
  } else {
    createRoot(root).render(<App />);
  }
}
