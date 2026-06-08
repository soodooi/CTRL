// MermaidViewer — render mermaid.js diagrams in the workspace.
//
// Bundle weight: mermaid.js + its deps ≈ 200KB gzip. The lazy boundary
// in viewer-registry.ts ensures this only loads on first text/mermaid
// resource. Initialize is idempotent — first viewer pays init cost,
// subsequent ones are free.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

// Initialize once for the lifetime of the page; tone the theme to match
// CTRL light-default neutrals. `securityLevel: 'strict'` opts out of
// raw HTML in diagram labels.
let mermaidReady = false;
const initMermaid = (): void => {
  if (mermaidReady) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict',
    fontFamily: 'var(--font-sans)',
  });
  mermaidReady = true;
};

let renderCounter = 0;

export const MermaidViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error } =
    useViewerResource(resource);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const [svg, setSvg] = useState<string>('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderId = useRef(`mermaid-${++renderCounter}`);

  useEffect(() => {
    initMermaid();
  }, []);

  useEffect(() => {
    if (mode !== 'preview' || content == null) return;
    let cancelled = false;
    const id = `${renderId.current}-${Math.random().toString(36).slice(2, 8)}`;
    mermaid
      .render(id, content)
      .then(({ svg: out }) => {
        if (!cancelled) {
          // securityLevel:'strict' already strips HTML labels, but the
          // rendered SVG is still injected via dangerouslySetInnerHTML
          // into the invoke()-capable WebView — defense in depth via
          // DOMPurify's SVG profile before it reaches the DOM.
          setSvg(DOMPurify.sanitize(out, { USE_PROFILES: { svg: true } }));
          setRenderError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'mermaid render failed';
        setRenderError(msg);
        setSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [content, mode]);

  const rightActions = (
    <div className={styles.modeToggle}>
      <button
        type="button"
        className={styles.modeButton}
        data-active={mode === 'preview'}
        onClick={() => setMode('preview')}
      >
        Preview
      </button>
      <button
        type="button"
        className={styles.modeButton}
        data-active={mode === 'source'}
        onClick={() => setMode('source')}
      >
        Source
      </button>
    </div>
  );

  return (
    <div className={styles.frame}>
      <ViewerChrome
        resource={resource}
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={save}
        rightActions={rightActions}
      />
      <div className={mode === 'preview' ? styles.scroll : styles.scroll}>
        {mode === 'preview' ? (
          renderError ? (
            <pre className={styles.markdownStub} role="alert">
              {renderError}
            </pre>
          ) : (
            <div
              className={styles.mermaidStage}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )
        ) : (
          <CodeMirror
            value={content ?? ''}
            theme="light"
            basicSetup={{ lineNumbers: true, foldGutter: true }}
            onChange={(value) => setContent(value)}
            readOnly={!resource.editable}
            className={styles.codeMirror}
          />
        )}
      </div>
    </div>
  );
};
