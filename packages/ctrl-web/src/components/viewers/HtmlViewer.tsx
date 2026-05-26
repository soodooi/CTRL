// HtmlViewer — sandboxed preview for `text/html` resources.
//
// Loaded as a separate chunk to keep critical-path tiny; the iframe
// itself is trivial but the surrounding chrome/save plumbing is shared
// with the editable text viewers.
//
// Security:
//   - iframe `sandbox` attribute strips JS execution + form submission
//     + same-origin access from the embedded document. allow-same-origin
//     intentionally OFF so a malicious vault HTML can't read other
//     vault files via fetch().
//   - Content-Security-Policy meta is injected into the iframe document
//     to block external script / iframe loads even when the user pastes
//     `<script src="..."></script>`. Belt-and-braces against the
//     sandbox attribute being overridden by future framework upgrades.
//
// Source editing happens by switching this resource's content-type to
// `application/xml` or by opening the same vault file in a separate
// CodeViewer tab (workspace lets multiple tabs target one file).

import { useMemo, type ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self' 'unsafe-inline' data: blob:; script-src 'none'; object-src 'none'; frame-src 'none';\">";

const wrapWithCsp = (body: string): string => {
  // If user already wrote a full document, slot the CSP in <head>;
  // otherwise build a minimal scaffold around their fragment.
  if (/<html[\s>]/i.test(body)) {
    return body.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n${CSP_META}`);
  }
  return `<!doctype html><html><head>${CSP_META}</head><body>${body}</body></html>`;
};

export const HtmlViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, save, dirty, saving, error, writable } =
    useViewerResource(resource);

  const srcDoc = useMemo(
    () => (content == null ? '' : wrapWithCsp(content)),
    [content],
  );

  return (
    <div className={styles.frame}>
      <ViewerChrome
        resource={resource}
        dirty={dirty}
        saving={saving}
        error={error}
        writable={writable}
        onSave={save}
      />
      <div className={styles.scroll} style={{ padding: 0 }}>
        {content === null && !error ? (
          <pre className={styles.markdownStub}>loading…</pre>
        ) : error && content === null ? (
          <pre className={styles.markdownStub} role="alert">
            {error}
          </pre>
        ) : (
          <iframe
            title={resource.uri}
            sandbox=""
            srcDoc={srcDoc}
            className={styles.htmlFrame}
          />
        )}
      </div>
    </div>
  );
};
