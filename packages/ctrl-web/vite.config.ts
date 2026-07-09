import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as { version: string };

// ADR-003 frontend §5 stack lock: React 18 + Vite 5 + TanStack Router/Query +
// Zustand + vite-plugin-pwa. CSS modules + design tokens (no Tailwind by
// default — protects against template look). framer-motion stayed in the
// stack lock for future surfaces but is currently removed from the bundle
// — McpCard is pure CSS, ClockStrip is static text.
// The PWA service worker ships ONLY in production builds (the phone PWA at
// app.ctrlapplab.com). In dev the Tauri webview must never register a SW: it
// persists in the WKWebView data dir across restarts and serves a stale/blank
// shell, which no amount of restarting clears. So gate VitePWA on `build`.
export default defineConfig(({ command }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'tanstack': ['@tanstack/react-router', '@tanstack/react-query'],
        },
      },
    },
  },
  plugins: [
    react(),
    ...(command === 'build'
      ? [VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CTRL',
        short_name: 'CTRL',
        description: 'Press Ctrl to summon · one key, one AI tool',
        theme_color: '#1E3FB0',
        background_color: '#131517',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Skip the kernel WS bridge (different origin/scheme in production tunnels)
        navigateFallbackDenylist: [/^\/ws/],
        // Heavy, on-demand chunks must NOT be precached — they load over the
        // network only when their surface is opened, keeping the critical-path
        // shell small (ADR-003 ≤200KB). The vendored notes-ui (BlockNote + wasm)
        // and the Univer spreadsheet engine (~5.6MB) are the offenders; without
        // this, workbox errors on the 2MB precache limit at build time.
        globIgnores: ['**/notes-ui/**', '**/UniverSheetViewer-*.js'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    })]
      : []),
  ],
}));
