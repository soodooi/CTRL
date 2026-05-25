/// <reference types="vite/client" />

// Injected at build time by vite.config.ts (read from package.json).
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Set true by `npm run test:e2e` so main.tsx installs Tauri IPC mocks
   *  before mounting <App />. Production builds + dev mode default false. */
  readonly VITE_PLAYWRIGHT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
