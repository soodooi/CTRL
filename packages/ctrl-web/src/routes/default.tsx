// DefaultWorkspace — the `/` route.
//
// 2026-05-29 restructure (bao): Irisy chat is now SHELL-LEVEL, so the
// home route no longer carries its own ChatInput / history. The display
// area on `/` shows the install slot until a workspace instance opens.

import { useEffect, type ReactElement } from 'react';
import { Keyboard } from '@/components/Keyboard';
import { useRail } from '@/components/RightRail';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import styles from './default.module.css';

export const DefaultWorkspace = (): ReactElement => {
  const { setIrisyState } = useRail();

  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  // Home page = the keycap grid. Keyboard used to live in a fixed left
  // rail; after the 2026-05-29 shell restructure it became the canonical
  // `/` route content (bao 2026-05-30 "键帽区以页面形式"). WorkspaceShell
  // still wraps so opening a keycap swaps in its workspace instance.
  const fallback = (
    <div className={styles.keyboardPage}>
      <Keyboard />
    </div>
  );

  return <WorkspaceShell fallback={fallback} />;
};
