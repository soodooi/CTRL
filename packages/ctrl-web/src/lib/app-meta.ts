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

import { useEffect, useSyncExternalStore } from 'react';

import webPkg from '../../package.json';

// In dev the vite `define` for __APP_VERSION__ is frozen at server start, so
// a `bump-version` mid-session leaves the window showing a stale number — the
// UI hot-updates but the define does not, which reads as "the build never
// changed" (bao 2026-06-13: this was a real source of confusion). Read the
// version live from package.json in dev so HMR reflects each bump instantly;
// in prod the define stays authoritative and this import is dead-code
// eliminated (DEV is statically false), so package.json is never bundled.
export const APP_VERSION: string = import.meta.env.DEV
  ? (webPkg as { version: string }).version
  : __APP_VERSION__;

export interface UpdateStatus {
  available: boolean;
  latestVersion?: string;
  notes?: string;
  checking: boolean;
  installing: boolean;
  error?: string;
}

// Poll cadence — fast enough that new releases surface within ~1 min
// during active dev (bao 2026-05-30). Once we're shipping less often,
// bump this back to 15 min to be friendlier to GitHub + battery.
const UPDATE_POLL_MS = 60 * 1000;

// Serialize checks and installs across every mounted updater surface. Ambient
// and Settings each poll independently, but only one operation may mutate the
// signed app bundle at a time. (ADR-004 cap §3 v6)
let activeUpdateOperation: 'idle' | 'checking' | 'installing' = 'idle';

const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window;

interface UpdateHandle {
  available: boolean;
  version?: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
}

// One updater truth for every UI surface. Hooks subscribe to this snapshot
// instead of racing with private copies of status/handle state.
// (ADR-004 cap §3 v6)
let sharedUpdateStatus: UpdateStatus = {
  available: false,
  checking: false,
  installing: false,
};
let sharedUpdateHandle: UpdateHandle | null = null;
const updateStatusListeners = new Set<() => void>();

const publishUpdateStatus = (
  next: UpdateStatus | ((current: UpdateStatus) => UpdateStatus),
): void => {
  sharedUpdateStatus = typeof next === 'function' ? next(sharedUpdateStatus) : next;
  updateStatusListeners.forEach((listener) => listener());
};

const subscribeUpdateStatus = (listener: () => void): (() => void) => {
  updateStatusListeners.add(listener);
  return () => updateStatusListeners.delete(listener);
};

const getUpdateStatusSnapshot = (): UpdateStatus => sharedUpdateStatus;

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
  // macOS: skip Tauri's `relaunch()` — it races with the in-place .app
  // replacement and with tauri-plugin-single-instance, leaving the user
  // with a closed window and no new process (bao 2026-05-30 smoking gun:
  // `/Applications/CTRL.app` left empty by a half-finished install). The
  // Rust `safe_relaunch_after_update` command verifies the bundle is
  // intact, spawns a detached `sh` helper that waits for our PID to die
  // and then `open`s the bundle via LaunchServices, then we exit.
  const platform = typeof navigator !== 'undefined'
    ? navigator.platform.toLowerCase()
    : '';
  const isMac = platform.includes('mac');
  if (isMac) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('safe_relaunch_after_update');
    return;
  }
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
};

interface UseUpdateStatusReturn extends UpdateStatus {
  supported: boolean;
  checkNow: () => Promise<void>;
  installAndRestart: () => Promise<void>;
  checkAndInstall: () => Promise<void>;
}

export const useUpdateStatus = (): UseUpdateStatusReturn => {
  const status = useSyncExternalStore(
    subscribeUpdateStatus,
    getUpdateStatusSnapshot,
    getUpdateStatusSnapshot,
  );

  const checkNow = async (): Promise<void> => {
    if (!isTauri() || activeUpdateOperation !== 'idle') return;
    activeUpdateOperation = 'checking';
    publishUpdateStatus((s) => ({ ...s, checking: true, error: undefined }));
    try {
      const result = await checkForUpdate();
      if (result?.available) {
        sharedUpdateHandle = result;
        publishUpdateStatus({
          available: true,
          latestVersion: result.version,
          notes: result.body,
          checking: false,
          installing: false,
        });
      } else {
        sharedUpdateHandle = null;
        publishUpdateStatus({ available: false, checking: false, installing: false });
      }
    } catch (err) {
      // A failed check cannot authorize installation from an older response.
      // Drop both the opaque updater handle and its visible metadata so every
      // install is backed by the latest successful check.
      // (ADR-004 cap § updater v6)
      sharedUpdateHandle = null;
      publishUpdateStatus({
        available: false,
        checking: false,
        installing: false,
        error: err instanceof Error ? err.message : 'check failed',
      });
    } finally {
      activeUpdateOperation = 'idle';
    }
  };

  const installAndRestart = async (): Promise<void> => {
    if (!sharedUpdateHandle?.available || activeUpdateOperation !== 'idle') return;
    activeUpdateOperation = 'installing';
    publishUpdateStatus((s) => ({ ...s, installing: true, error: undefined }));
    try {
      await sharedUpdateHandle.downloadAndInstall();
      await relaunchApp();
    } catch (err) {
      publishUpdateStatus((s) => ({
        ...s,
        installing: false,
        error: err instanceof Error ? err.message : 'install failed',
      }));
    } finally {
      activeUpdateOperation = 'idle';
    }
  };

  // One-click upgrade for the version row: a single click checks AND
  // installs in one shot, so the user never has to click twice (once to
  // discover the update, once to install it). If we already hold a pending
  // update handle we install it directly; otherwise we check, and if one is
  // found we download + relaunch immediately — no second click, no Settings
  // detour. The whole point is "click the version → it upgrades".
  const checkAndInstall = async (): Promise<void> => {
    if (!isTauri() || activeUpdateOperation !== 'idle') return;
    if (sharedUpdateHandle?.available) {
      await installAndRestart();
      return;
    }
    activeUpdateOperation = 'checking';
    publishUpdateStatus((s) => ({ ...s, checking: true, error: undefined }));
    try {
      const result = await checkForUpdate();
      if (!result?.available) {
        sharedUpdateHandle = null;
        publishUpdateStatus({ available: false, checking: false, installing: false });
        return;
      }
      sharedUpdateHandle = result;
      activeUpdateOperation = 'installing';
      publishUpdateStatus({
        available: true,
        latestVersion: result.version,
        notes: result.body,
        checking: false,
        installing: true,
      });
      await result.downloadAndInstall();
      await relaunchApp();
    } catch (err) {
      publishUpdateStatus((s) => ({
        ...s,
        checking: false,
        installing: false,
        error: err instanceof Error ? err.message : 'update failed',
      }));
    } finally {
      activeUpdateOperation = 'idle';
    }
  };

  useEffect(() => {
    void checkNow();
    const id = window.setInterval(() => void checkNow(), UPDATE_POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    ...status,
    supported: isTauri(),
    checkNow,
    installAndRestart,
    checkAndInstall,
  };
};
