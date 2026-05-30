// DefaultWorkspace — the `/` route.
//
// 2026-05-29 restructure (bao): Irisy chat is now SHELL-LEVEL, so the
// home route no longer carries its own ChatInput / history. The display
// area on `/` shows the install slot until a workspace instance opens.

import { useEffect, type ReactElement } from 'react';
import { useRail } from '@/components/PrimaryRail';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import styles from './default.module.css';

export const DefaultWorkspace = (): ReactElement => {
  const { setIrisyState } = useRail();

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  // 2026-05-30 shell restructure: Keyboard is now a global shell column
  // (lives at app.tsx in the `keycap` grid slot). The main display
  // surface on `/` is empty — just a paper backdrop until the user
  // opens a workspace instance or navigates to a keycap output.
  const fallback = <div className={styles.emptyHome} aria-hidden="true" />;

  return <WorkspaceShell fallback={fallback} />;
};
