// MermaidViewer — render a `.mmd` / `text/mermaid` resource as SVG.
//
// Mermaid is a sizeable dep (~180KB gzip), so this lives in its own
// lazy chunk; instantiating the viewer once per tab is the only thing
// that pulls Mermaid into memory.
//
// Read-only by design today: editing Mermaid source is rare enough that
// users live with "open in source mode" (drop into CodeViewer over the
// same file when content-type override is added). If demand surfaces,
// add a Source toggle here matching MarkdownViewer.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import mermaid from 'mermaid';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

// Initialise once per page-load. Mermaid stores its config globally;
// re-initing on every viewer instance would race when two tabs render
// the same diagram simultaneously.
let initialised = false;
const ensureMermaid = (): void => {
  if (initialised) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    fontFamily: 'var(--font-mono, monospace)',
  });
  initialised = true;
};

export const MermaidViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, save, dirty, saving, error, writable } =
    useViewerResource(resource);
  const containerRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (content == null) return;
    ensureMermaid();
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    // Generate a stable id per source — mermaid throws on duplicates
    // when two viewers happen to share content. Salt with random suffix.
    const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
    mermaid
      .render(id, content)
      .then(({ svg }) => {
        if (cancelled) return;
        container.innerHTML = svg;
        setRenderError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        container.innerHTML = '';
        setRenderError(err instanceof Error ? err.message : 'render failed');
      });
    return () => {
      cancelled = true;
    };
  }, [content]);

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
      <div className={styles.scroll}>
        {content === null && !error ? (
          <pre className={styles.markdownStub}>loading…</pre>
        ) : error && content === null ? (
          <pre className={styles.markdownStub} role="alert">
            {error}
          </pre>
        ) : renderError ? (
          <pre className={styles.mermaidError} role="alert">
            mermaid render error:{'\n'}
            {renderError}
          </pre>
        ) : (
          <div ref={containerRef} className={styles.mermaidWrap} />
        )}
      </div>
    </div>
  );
};
