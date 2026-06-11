// CodingArtifactPane — left half of the Coding L1 split layout
// (routes/coding.tsx), paired with <OpencodeChat /> on the right.
//
// ADR-002 substrate §1 v19 (2026-06-09, 3-agent aggregator): the v16
// data source — Pi `getMessages` RPC projected into Write/Edit tool
// calls — retired with Pi. opencode owns /coding now; surfacing the
// files it touches needs its HTTP event API (file-edit events), which
// is not wired yet. Until then the pane renders its empty state and
// keeps the split-layout shell (bao 2026-06-07 ask) stable.

import { type ReactElement } from 'react';
import styles from './CodingArtifactPane.module.css';

export function CodingArtifactPane(): ReactElement {
  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>artifacts</span>
        <span className={styles.headerCount}>0</span>
      </div>
      <div className={styles.empty}>
        <span className={styles.emptyTitle}>no files yet</span>
        <span className={styles.emptyHint}>
          Files opencode writes or edits will show up here once its
          file-event wire lands. For now, open the project folder to see
          changes on disk.
        </span>
      </div>
    </div>
  );
}
