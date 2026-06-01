// /irisy — Irisy run-output surface.
//
// 2026-05-30 ADR-003 frontend amendment (Irisy-as-sole-entry): The dedicated
// `?intent=create-keycap` CreatorShell is gone. Keycap creation is now
// an internal Irisy skill dispatched from the regular chat ("帮我做个 …"),
// so the route no longer hosts a chat or a manifest editor of its own.
// Irisy chat itself is SHELL-LEVEL (lives in app.tsx's Irisy column);
// this route only renders the workspace-pane output for an in-flight
// keycap run, exactly the same way as visiting `/` does. An idle visit
// shows a one-line hint pointing the user at the right column.

import type { ReactElement } from 'react';
import { KeycapOutputPane } from '@/components/workspace/KeycapOutputPane';
import { useKeycapOutputStore } from '@/lib/keycap-output-store';
import styles from './irisy.module.css';

export const IrisyRoute = (): ReactElement => {
  const hasRun = useKeycapOutputStore((s) => s.running || s.keycapId !== null);

  if (!hasRun) {
    return (
      <div className={styles.fallback}>
        <span className={styles.fallbackMuted}>
          Talk to Irisy on the right — output appears here when a keycap runs.
        </span>
      </div>
    );
  }

  return (
    <div className={styles.runOutput}>
      <KeycapOutputPane />
    </div>
  );
};
