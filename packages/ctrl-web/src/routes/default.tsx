// DefaultWorkspace — the `/` route.
//
// 2026-05-29 restructure (bao): Irisy chat is now SHELL-LEVEL, so the
// home route no longer carries its own ChatInput / history. The display
// area on `/` shows the install slot until a workspace instance opens.

import { useEffect, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { InstallKeycapTile, type InstallKeycapTilePayload } from '@/components/primitives';
import { useRail } from '@/components/RightRail';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import styles from './default.module.css';

export const DefaultWorkspace = (): ReactElement => {
  const { setIrisyState } = useRail();
  const navigate = useNavigate();

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  const handleInstall = (_payload: InstallKeycapTilePayload): void => {
    void navigate({ to: '/pool' });
  };

  const fallback = (
    <div className={styles.cockpit}>
      <div className={styles.stage} aria-hidden="true" />
      <div className={styles.bottomDock}>
        <InstallKeycapTile onActivate={handleInstall} />
      </div>
    </div>
  );

  return <WorkspaceShell fallback={fallback} />;
};
