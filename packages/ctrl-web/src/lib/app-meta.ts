// App metadata — PWA-side version + update detection.
//
// Today the version is injected at build time from package.json via
// vite.config.ts (`__APP_VERSION__`). Update detection is a stub —
// once zeus wires `app_meta.update_available` into the kernel_status
// command (or a dedicated channel), swap the stub for a real poll.

import { useEffect, useState } from 'react';

export const APP_VERSION: string = __APP_VERSION__;

export interface UpdateStatus {
  available: boolean;
  latestVersion?: string;
}

const UPDATE_POLL_MS = 15 * 60 * 1000;

/**
 * `available` flips to true when a newer build has been published on
 * the update channel. The current implementation always returns
 * `false` — kernel-side detection (`app_meta.update_available`) hooks
 * up in a follow-up. The shape is fixed now so consuming surfaces
 * (rail version footer green dot, settings → Update Log) don't change.
 */
export const useUpdateStatus = (): UpdateStatus => {
  const [status, setStatus] = useState<UpdateStatus>({ available: false });

  useEffect(() => {
    // Placeholder: no-op until the kernel signal lands. The interval is
    // kept so future wiring just swaps in the real fetcher.
    const tick = (): void => {
      // void detectUpdate(setStatus);
    };
    tick();
    const id = window.setInterval(tick, UPDATE_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  return status;
};
