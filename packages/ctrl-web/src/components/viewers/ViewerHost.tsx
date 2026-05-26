// ViewerHost — wraps the lazy viewer resolution from the registry in a
// single Suspense boundary so consumers don't repeat the same plumbing.
// Pass a ViewerResource; the right viewer module gets loaded on demand.

import { Suspense, createElement, type ReactElement } from 'react';
import { resolveViewer, type ViewerResource } from '@/lib/viewer-registry';
import styles from './Viewer.module.css';

interface ViewerHostProps {
  resource: ViewerResource;
}

const LoadingFallback = (): ReactElement => (
  <div className={styles.frame}>
    <div className={styles.fallback}>
      <div className={styles.fallbackKind}>loading viewer…</div>
    </div>
  </div>
);

export const ViewerHost = ({ resource }: ViewerHostProps): ReactElement => {
  const Viewer = resolveViewer(resource.contentType);
  return (
    <Suspense fallback={<LoadingFallback />}>
      {createElement(Viewer, { resource })}
    </Suspense>
  );
};
