// PdfViewer — browser-native PDF embed. WebView2 + WKWebView both
// ship a PDF viewer; <embed> is the lightest path. When the resource
// carries a companion (e.g. `file.pdf` + `file.pdf.md`), the sidecar
// link surfaces so Irisy / search can drill into the extracted text.

import type { ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const PdfViewer = ({ resource }: ViewerProps): ReactElement => {
  const rightActions = resource.companion ? (
    <a
      href={resource.companion}
      target="_blank"
      rel="noopener noreferrer"
      className={styles.companionLink}
      title="Open extracted text sidecar"
    >
      Sidecar
    </a>
  ) : null;

  return (
    <div className={styles.frame}>
      <ViewerChrome resource={resource} rightActions={rightActions} />
      <div className={styles.frameBody}>
        <embed
          src={resource.uri}
          type="application/pdf"
          className={styles.pdfEmbed}
        />
      </div>
    </div>
  );
};
