// CTRL PWA entry point.
//
// Mounts <App />, registers the service worker via vite-plugin-pwa, and
// applies the dark theme by default (deliberate, not auto-OS).

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import { App } from './app';

document.documentElement.dataset.theme = 'dark';

const root = document.getElementById('root');
if (!root) throw new Error('PWA root element missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
