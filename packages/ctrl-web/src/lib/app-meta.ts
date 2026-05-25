// App metadata — PWA-side version + update detection wired to the Rust
// updater. `APP_VERSION` is injected at build time from package.json via
// vite.config.ts (`__APP_VERSION__`). Update status comes from the
// kernel's prewarm cache (populated at boot, refreshed every 15 min) and
// is auto-pushed via the `update-available-changed` Tauri event whenever
// the cache changes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const APP_VERSION: string = __APP_VERSION__;

/** Mirrors `commands::system::UpdateCheck` on the Rust side. */
interface UpdateCheckPayload {
  kind: 'available' | 'up_to_date' | 'no_endpoint' | 'error';
  available_version: string | null;
  message: string;
}

export type UpdateState =
  | 'unknown'
  | 'available'
  | 'up_to_date'
  | 'no_endpoint'
  | 'error'
  | 'installing';

export interface UpdateStatus {
  state: UpdateState;
  /** Convenience flag retained for prior call-sites that only care about the binary. */
  available: boolean;
  latestVersion?: string;
  message?: string;
}

export interface UpdateController {
  status: UpdateStatus;
  /** Hits the kernel for a fresh check, bypassing the cache. */
  forceCheck: () => Promise<void>;
  /** Downloads + installs the latest update if one is available. Kernel
   *  restarts the app on success. */
  install: () => Promise<void>;
}

const POLL_INTERVAL_MS = 15 * 60 * 1000;
const EVENT_NAME = 'update-available-changed';

const toStatus = (payload: UpdateCheckPayload): UpdateStatus => ({
  state: payload.kind,
  available: payload.kind === 'available',
  latestVersion: payload.available_version ?? undefined,
  message: payload.message,
});

const initialStatus: UpdateStatus = { state: 'unknown', available: false };

/**
 * Auto-push update status:
 *  - On mount: invoke `check_for_updates` (returns the cached result instantly)
 *  - Listen for `update-available-changed` events emitted by the kernel
 *    prewarm task whenever the cache state changes (push, not poll)
 *  - Fallback poll every 15 min in case the listener drops
 */
export const useUpdateStatus = (): UpdateStatus => {
  const { status } = useUpdateController();
  return status;
};

export const useUpdateController = (): UpdateController => {
  const [status, setStatus] = useState<UpdateStatus>(initialStatus);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    let unlisten: UnlistenFn | undefined;

    const apply = (payload: UpdateCheckPayload): void => {
      if (!aliveRef.current) return;
      setStatus(toStatus(payload));
    };

    const safeInvoke = async (
      cmd: 'check_for_updates' | 'force_check_for_updates',
    ): Promise<void> => {
      try {
        const payload = await invoke<UpdateCheckPayload>(cmd);
        apply(payload);
      } catch (err) {
        if (!aliveRef.current) return;
        setStatus({
          state: 'error',
          available: false,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    void safeInvoke('check_for_updates');

    void listen<UpdateCheckPayload>(EVENT_NAME, (event) => {
      apply(event.payload);
    }).then((fn) => {
      if (!aliveRef.current) {
        fn();
        return;
      }
      unlisten = fn;
    });

    const intervalId = window.setInterval(() => {
      void safeInvoke('check_for_updates');
    }, POLL_INTERVAL_MS);

    return () => {
      aliveRef.current = false;
      unlisten?.();
      window.clearInterval(intervalId);
    };
  }, []);

  const forceCheck = useCallback(async (): Promise<void> => {
    try {
      const payload = await invoke<UpdateCheckPayload>('force_check_for_updates');
      setStatus(toStatus(payload));
    } catch (err) {
      setStatus({
        state: 'error',
        available: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const install = useCallback(async (): Promise<void> => {
    setStatus((prev) => ({ ...prev, state: 'installing' }));
    try {
      await invoke('install_update');
      // The kernel restarts the app on success; control returns here only
      // when the user is already on the latest build (or on error).
    } catch (err) {
      setStatus({
        state: 'error',
        available: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return { status, forceCheck, install };
};
