// ImageViewer — render bitmap + SVG assets via plain <img>.
//
// Trivial render, but kept as its own lazy module so the registry can
// dispatch without conditional logic in shared code, and so future
// additions (EXIF panel, zoom controls, alt-text editor for sidecar
// .md companions) don't bloat critical-path.
//
// SVG note: rendered via <img> rather than inline parse — browser
// sandbox isolates SVG <script> when loaded as image source. If the
// resource explicitly opts into editable SVG, fall back to CodeViewer
// over the same URI (registry handles content-type override).

import { type ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const ImageViewer = ({ resource }: ViewerProps): ReactElement => {
  // Images are read-only in this viewer; no useViewerResource (no need
  // to fetch the bytes through JS — the <img> tag handles it natively
  // for any URI scheme the browser already supports).
  const noopSave = async (): Promise<void> => {
    /* read-only */
  };
  return (
    <div className={styles.frame}>
      <ViewerChrome
        resource={resource}
        dirty={false}
        saving={false}
        error={null}
        writable={false}
        onSave={noopSave}
      />
      <div className={styles.scroll} style={{ padding: 0 }}>
        <div className={styles.imageWrap}>
          <img src={resource.uri} alt={resource.uri} />
        </div>
      </div>
    </div>
  );
};
