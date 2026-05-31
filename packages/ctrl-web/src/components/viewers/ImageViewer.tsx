// ImageViewer — browser-native <img> + zoom toggle. For vault images
// the sidecar markdown is the search index; this viewer just shows the
// pixels. Display name + size metadata pull from the URL itself.

import { useState, type ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

const basenameFromUri = (uri: string): string => {
  const last = uri.split('/').pop() ?? '';
  return decodeURIComponent(last.split('?')[0] ?? '');
};

export const ImageViewer = ({ resource }: ViewerProps): ReactElement => {
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit');
  const altText = basenameFromUri(resource.uri);

  const rightActions = (
    <div className={styles.modeToggle}>
      <button
        type="button"
        className={styles.modeButton}
        data-active={zoom === 'fit'}
        onClick={() => setZoom('fit')}
      >
        Fit
      </button>
      <button
        type="button"
        className={styles.modeButton}
        data-active={zoom === 'actual'}
        onClick={() => setZoom('actual')}
      >
        100%
      </button>
    </div>
  );

  return (
    <div className={styles.frame}>
      <ViewerChrome resource={resource} rightActions={rightActions} />
      <div className={styles.imageStage} data-zoom={zoom}>
        <img
          src={resource.uri}
          alt={altText}
          className={styles.imageEl}
          decoding="async"
          loading="lazy"
        />
      </div>
    </div>
  );
};
