// App metadata — PWA-side version + update detection.
//
// Version is injected at build time from package.json via vite.config.ts
// (`__APP_VERSION__`). Native Tauri commands own update check/apply so the
// WebView cannot bypass the canonical app boundary. Browser mode
// (mobile / dev outside Tauri) falls back to no-op.

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
  updating: boolean;
  error?: string;
}

// Poll cadence — fast enough that new releases surface within ~1 min
// during active dev (bao 2026-05-30). Once we're shipping less often,
// bump this back to 15 min to be friendlier to GitHub + battery.
const UPDATE_POLL_MS = 60 * 1000;

// Serialize checks and updates across every mounted updater surface. Ambient
// and Settings each poll independently, but only one operation may mutate the
// signed app bundle at a time. (ADR-004 cap § auto-update v10)
let activeUpdateOperation: 'idle' | 'checking' | 'updating' = 'idle';

const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  '__TAURI_INTERNALS__' in window;

interface UpdateHandle {
  available: boolean;
  version?: string;
  body?: string;
  downloadAndApply: () => Promise<boolean>;
}

// One updater truth for every UI surface. Hooks subscribe to this snapshot
// instead of racing with private copies of status/handle state.
// (ADR-004 cap § auto-update v10)
let sharedUpdateStatus: UpdateStatus = {
  available: false,
  checking: false,
  updating: false,
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

// Tauri commands reject with serializable strings as well as Error objects.
// Preserve the native updater diagnosis instead of collapsing it to a generic
// UI failure, while retaining a stable fallback for unknown rejection values.
// (ADR-004 cap § updater v11)
const updateErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
};

// WebView code receives metadata only; the native command owns endpoint access,
// archive signature verification, canonical in-place transaction, and macOS relaunch.
// (ADR-004 cap § updater v10)
const checkForUpdate = async (): Promise<UpdateHandle | null> => {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const update = await invoke<{ version: string; body?: string } | null>('check_app_update');
  if (!update) return null;
  return {
    available: true,
    version: update.version,
    body: update.body,
    downloadAndApply: () => invoke<boolean>('apply_app_update', {
      expectedVersion: update.version,
    }),
  };
};

const relaunchApp = async (): Promise<void> => {
  if (!isTauri()) return;
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
};

interface UseUpdateStatusReturn extends UpdateStatus {
  supported: boolean;
  checkNow: () => Promise<void>;
  applyAndRestart: () => Promise<void>;
  checkAndUpdate: () => Promise<void>;
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
          updating: false,
        });
      } else {
        sharedUpdateHandle = null;
        publishUpdateStatus({ available: false, checking: false, updating: false });
      }
    } catch (err) {
      // A failed check cannot authorize an update from an older response.
      // Drop both the opaque updater handle and its visible metadata so every
      // apply is backed by the latest successful check.
      // (ADR-004 cap § updater v10)
      sharedUpdateHandle = null;
      publishUpdateStatus({
        available: false,
        checking: false,
        updating: false,
        error: updateErrorMessage(err, 'check failed'),
      });
    } finally {
      activeUpdateOperation = 'idle';
    }
  };

  const applyAndRestart = async (): Promise<void> => {
    if (!sharedUpdateHandle?.available || activeUpdateOperation !== 'idle') return;
    activeUpdateOperation = 'updating';
    publishUpdateStatus((s) => ({ ...s, updating: true, error: undefined }));
    try {
      const relaunchScheduled = await sharedUpdateHandle.downloadAndApply();
      if (!relaunchScheduled) await relaunchApp();
    } catch (err) {
      publishUpdateStatus((s) => ({
        ...s,
        updating: false,
        error: updateErrorMessage(err, 'update failed'),
      }));
    } finally {
      activeUpdateOperation = 'idle';
    }
  };

  // One-click update for the version row: a single click checks AND
  // applies the update in one shot, so the user never has to click twice. If
  // we already hold pending metadata we apply it directly; otherwise we check,
  // then download, atomically update, and relaunch without a Settings detour.
  const checkAndUpdate = async (): Promise<void> => {
    if (!isTauri() || activeUpdateOperation !== 'idle') return;
    if (sharedUpdateHandle?.available) {
      await applyAndRestart();
      return;
    }
    activeUpdateOperation = 'checking';
    publishUpdateStatus((s) => ({ ...s, checking: true, error: undefined }));
    try {
      const result = await checkForUpdate();
      if (!result?.available) {
        sharedUpdateHandle = null;
        publishUpdateStatus({ available: false, checking: false, updating: false });
        return;
      }
      sharedUpdateHandle = result;
      activeUpdateOperation = 'updating';
      publishUpdateStatus({
        available: true,
        latestVersion: result.version,
        notes: result.body,
        checking: false,
        updating: true,
      });
      const relaunchScheduled = await result.downloadAndApply();
      if (!relaunchScheduled) await relaunchApp();
    } catch (err) {
      publishUpdateStatus((s) => ({
        ...s,
        checking: false,
        updating: false,
        error: updateErrorMessage(err, 'update failed'),
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
    applyAndRestart,
    checkAndUpdate,
  };
};
