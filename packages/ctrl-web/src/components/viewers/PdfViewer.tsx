// PdfViewer — display PDFs via the browser's native PDF.js renderer.
//
// Both Tauri WebView2 (Edge Chromium) and WKWebView on macOS ship a
// built-in PDF viewer; pointing an <iframe src> at the file URL is all
// we need. Avoids bundling pdf.js (~250KB gzip) for a feature the
// platform already provides.
//
// Sidecar companion (CLAUDE.md vault invariant):
//   Every `file.pdf` in the vault has a `file.pdf.md` sidecar holding
//   extracted text + frontmatter (page count, source URL, etc.) so the
//   FTS5 index can search inside PDFs. When the resource carries a
//   `companion` URI, render a small "open companion" button so the user
//   can drop into the sidecar — Irisy citations land there too.

import { type ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const PdfViewer = ({ resource }: ViewerProps): ReactElement => {
  const noopSave = async (): Promise<void> => {
    /* read-only */
  };
  const companion = resource.companion;
  return (
    <div className={styles.frame}>
      <ViewerChrome
        resource={resource}
        dirty={false}
        saving={false}
        error={null}
        writable={false}
        onSave={noopSave}
        rightActions={
          companion ? (
            <span
              className={styles.metaSaving}
              title={`Sidecar markdown: ${companion}`}
            >
              + {displayCompanion(companion)}
            </span>
          ) : undefined
        }
      />
      <div className={styles.scroll} style={{ padding: 0 }}>
        <iframe
          title={resource.uri}
          src={resource.uri}
          className={styles.pdfFrame}
        />
      </div>
    </div>
  );
};

const displayCompanion = (uri: string): string => {
  if (uri.startsWith('vault://')) return uri.slice('vault://'.length);
  return uri;
};
