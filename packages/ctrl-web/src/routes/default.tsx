// DefaultWorkspace — cold-start view at `/`. Big Irisy mascot + 3 hint
// cards onboarding the user toward the first action (press a keycap,
// open Pool, summon search). Per bao: 大气上档次 — let the workspace
// breathe.

import { useEffect, type ReactElement } from 'react';
import { IrisyMascot } from '@/components/IrisyMascot';
import { useRail } from '@/components/RightRail';
import styles from './default.module.css';

export const DefaultWorkspace = (): ReactElement => {
  const { setIrisyState } = useRail();
  useEffect(() => {
    setIrisyState('idle');
    return () => setIrisyState('idle');
  }, [setIrisyState]);

  return (
    <div className={styles.wrap}>
      <div className={styles.mascotWrap}>
        <div className={styles.mascotHalo} />
        <IrisyMascot state="idle" size={180} />
      </div>
      <h1 className={styles.headline}>I'm Irisy. What are we doing today?</h1>
      <p className={styles.subhead}>
        Press a key on the left to summon a tool. Hold <code>Ctrl</code> any time to
        bring me up over whatever you're working on.
      </p>
      <div className={styles.hints}>
        <div className={styles.hint}>
          <span className={styles.hintLabel}>Pick a tool</span>
          <span className={styles.hintText}>
            Click a keycap on the left to open its workspace here.
          </span>
        </div>
        <div className={styles.hint}>
          <span className={styles.hintLabel}>Search</span>
          <span className={styles.hintText}>
            Find a keycap by name or intent. <span className={styles.hintShortcut}>⌘ K</span>
          </span>
        </div>
        <div className={styles.hint}>
          <span className={styles.hintLabel}>Pool</span>
          <span className={styles.hintText}>
            Browse and install new keycaps from MCP, OAuth or local sources.
          </span>
        </div>
      </div>
    </div>
  );
};
