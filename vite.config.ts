import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        // Three independent windows: each one is its own HTML entry, its own
        // React tree, its own Tauri webview. They communicate via Tauri events.
        main: resolve(__dirname, 'index.html'),
        pool: resolve(__dirname, 'pool.html'),
        workspace: resolve(__dirname, 'workspace.html'),
      },
    },
  },
});
