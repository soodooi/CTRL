// MarkdownViewer — stub that renders raw markdown as preformatted text
// until Tiptap is wired in (daedalus to-do, gated on viewer-bundle work).
// Ships now so the registry contract is testable end-to-end and tabs
// pointing at `text/markdown` resources don't fall into Fallback.

import { useEffect, useState, type ReactElement } from 'react';
import { isCtrlAssetUri } from '@/lib/asset-uri';
import type { ViewerProps } from '@/lib/viewer-registry';
import styles from './Viewer.module.css';

const fetchAsText = async (uri: string): Promise<string> => {
  // `ctrl-asset://` URIs round-trip through the Tauri protocol handler.
  // Until zeus lands the handler (gap D2) these will fail; show the
  // error rather than a silent empty document.
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`fetch ${uri} → ${res.status}`);
  return res.text();
};

export const MarkdownViewer = ({ resource }: ViewerProps): ReactElement => {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    fetchAsText(resource.uri)
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'failed to load';
        const hint = isCtrlAssetUri(resource.uri)
          ? `${msg} — ctrl-asset:// handler not yet registered`
          : msg;
        setError(hint);
      });
    return () => {
      cancelled = true;
    };
  }, [resource.uri]);

  return (
    <div className={styles.frame}>
      <div className={styles.meta}>
        <span className={styles.metaLocation}>{resource.location}</span>
        <span className={styles.metaPath}>{resource.uri}</span>
        {!resource.editable && (
          <span className={styles.metaReadOnly}>read-only</span>
        )}
      </div>
      <div className={styles.scroll}>
        {error ? (
          <pre className={styles.markdownStub} role="alert">
            {error}
          </pre>
        ) : content === null ? (
          <pre className={styles.markdownStub}>loading…</pre>
        ) : (
          <pre className={styles.markdownStub}>{content}</pre>
        )}
      </div>
    </div>
  );
};
