// FallbackViewer — rendered when no viewer is registered for the
// resource's content-type. Names the missing kind so the user (and dev)
// can see what's not wired up rather than a blank panel.

import type { ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import styles from './Viewer.module.css';

export const FallbackViewer = ({ resource }: ViewerProps): ReactElement => (
  <div className={styles.frame}>
    <div className={styles.meta}>
      <span className={styles.metaLocation}>{resource.location}</span>
      <span className={styles.metaPath}>{resource.uri}</span>
      {!resource.editable && <span className={styles.metaReadOnly}>read-only</span>}
    </div>
    <div className={styles.fallback}>
      <div className={styles.fallbackKind}>{resource.contentType}</div>
      <p className={styles.fallbackHint}>
        No viewer registered for this content-type. Register one in{' '}
        <code>lib/viewer-registry.ts</code> by adding a lazy module under{' '}
        <code>components/viewers/</code>.
      </p>
    </div>
  </div>
);
