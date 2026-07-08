// RemoteLanding — what a plain browser sees at the hosted PWA URL WITHOUT a
// pairing link (ADR-005 §2). CTRL's full app is a desktop Tauri app; the only
// browser purpose of this host is the phone remote view (?remote=…). So a bare
// visit must NOT boot the full app (it calls Tauri APIs that don't exist in a
// browser — the transformCallback crash) — it shows this instead.
import type { ReactElement } from 'react';
import styles from './RemoteLanding.module.css';

export function RemoteLanding(): ReactElement {
  return (
    <div className={styles.wrap}>
      <div className={styles.mark}>CTRL</div>
      <h1 className={styles.title}>Remote Window</h1>
      <p className={styles.body}>
        This page connects your phone to your own desktop CTRL. Open the link from your
        desktop&apos;s <strong>Remote Window</strong> page — it carries the code that pairs this
        phone to your desktop.
      </p>
      <p className={styles.hint}>On the desktop: Remote → turn on “Stay reachable” → open the link here.</p>
    </div>
  );
}
