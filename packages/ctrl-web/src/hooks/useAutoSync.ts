// useAutoSync — auto-commit the vault to git when the user enabled it.
//
// Compose, don't reinvent (notes-module-plan §7): this just runs the git helper
// on a timer + when the app is backgrounded. vault_git_sync no-ops when nothing
// changed, so a periodic call is cheap. Mounted once at the app root.

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultGetConfig, vaultGitSync } from '@/lib/kernel';

const INTERVAL_MS = 5 * 60_000;

export const useAutoSync = (): void => {
  const { data: config } = useQuery({
    queryKey: ['vault-config'],
    queryFn: vaultGetConfig,
    staleTime: Infinity,
  });
  const enabled = config?.auto_sync ?? false;

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const sync = (): void => {
      if (running) return;
      running = true;
      void vaultGitSync()
        .catch(() => {
          /* best-effort; surfaced explicitly only via the manual button */
        })
        .finally(() => {
          running = false;
        });
    };
    const id = window.setInterval(sync, INTERVAL_MS);
    // Commit when the user switches away (the "I'm done editing" moment).
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') sync();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
};
