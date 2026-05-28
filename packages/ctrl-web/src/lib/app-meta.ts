// App metadata — PWA-side version + update detection.
//
// Version is injected at build time from package.json via vite.config.ts
// (`__APP_VERSION__`). Update detection calls Tauri 2 updater plugin
// (`@tauri-apps/plugin-updater`) which fetches the configured `latest.json`
// endpoint (see src-tauri/tauri.conf.json -> plugins.updater.endpoints).
// `installUpdate()` downloads + applies the signed bundle and restarts.
//
// Browser-mode (mobile / dev outside Tauri) falls back to no-op: the
// plugin import throws synchronously when `window.__TAURI_INTERNALS__` is
// absent, so we guard via dynamic import + try/catch.

import { useEffect, useState } from 'react';

export const APP_VERSION: string = __APP_VERSION__;

export interface UpdateStatus {
  available: boolean;
  latestVersion?: string;
  notes?: string;
  checking: boolean;
  installing: boolean;
  error?: string;
}

const UPDATE_POLL_MS = 15 * 60 * 1000;

const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window;

interface UpdateHandle {
  available: boolean;
  version?: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
}

const checkForUpdate = async (): Promise<UpdateHandle | null> => {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update || !update.available) return null;
  return {
    available: true,
    version: update.version,
    body: update.body,
    downloadAndInstall: () => update.downloadAndInstall(),
  };
};

const relaunchApp = async (): Promise<void> => {
  if (!isTauri()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
};

interface UseUpdateStatusReturn extends UpdateStatus {
  checkNow: () => Promise<void>;
  installAndRestart: () => Promise<void>;
}

export const useUpdateStatus = (): UseUpdateStatusReturn => {
  const [status, setStatus] = useState<UpdateStatus>({
    available: false,
    checking: false,
    installing: false,
  });
  const [handle, setHandle] = useState<UpdateHandle | null>(null);

  const checkNow = async (): Promise<void> => {
    if (!isTauri()) return;
    setStatus((s) => ({ ...s, checking: true, error: undefined }));
    try {
      const result = await checkForUpdate();
      if (result?.available) {
        setHandle(result);
        setStatus({
          available: true,
          latestVersion: result.version,
          notes: result.body,
          checking: false,
          installing: false,
        });
      } else {
        setHandle(null);
        setStatus({ available: false, checking: false, installing: false });
      }
    } catch (err) {
      setStatus((s) => ({
        ...s,
        checking: false,
        error: err instanceof Error ? err.message : 'check failed',
      }));
    }
  };

  const installAndRestart = async (): Promise<void> => {
    if (!handle?.available) return;
    setStatus((s) => ({ ...s, installing: true, error: undefined }));
    try {
      await handle.downloadAndInstall();
      await relaunchApp();
    } catch (err) {
      setStatus((s) => ({
        ...s,
        installing: false,
        error: err instanceof Error ? err.message : 'install failed',
      }));
    }
  };

  useEffect(() => {
    void checkNow();
    const id = window.setInterval(() => void checkNow(), UPDATE_POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...status, checkNow, installAndRestart };
};
