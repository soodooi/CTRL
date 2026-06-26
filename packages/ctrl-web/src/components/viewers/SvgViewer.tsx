// SvgViewer — render SVG markup as an <img> data-URI. Browser-native,
// zero deps. Source-mode toggles to a CodeMirror buffer for editing.
// Used for mcp icon.svg files (~/.ctrl/mcps/<id>/assets/icon.svg) and
// any SVG asset in the vault.
//
// Security: mcp `icon.svg` ships inside third-party install packages, so
// the markup is NOT user-controlled. Inlining via dangerouslySetInnerHTML
// would execute embedded `onload=` / `<a href="javascript:">` / scripts
// (XSS — live in pure-browser PWA mode, which has no script-src CSP).
// Loading the SVG through an <img> renders it in the browser's
// script-disabled image mode, neutralising those vectors.

import { useMemo, useState, type ReactElement } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html'; // SVG ≈ XML; lang-html covers it
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const SvgViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error } =
    useViewerResource(resource);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');

  // Encode the markup as an SVG data-URI. The browser renders it through
  // the <img> path, which disables scripting / external loads — so the
  // viewer never executes script embedded in a third-party SVG.
  const svgUri = useMemo(
    () => `data:image/svg+xml;utf8,${encodeURIComponent(content ?? '')}`,
    [content],
  );

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
      <div className={mode === 'preview' ? styles.frameBody : styles.scroll}>
        {mode === 'preview' ? (
          <div className={styles.svgStage}>
            {/* Rendered via <img> (not innerHTML) so script embedded in a
                third-party mcp icon.svg can't execute. */}
            <img
              className={styles.svgFigure}
              src={svgUri}
              alt={resource.uri}
            />
          </div>
        ) : (
          <CodeMirror
            value={content ?? ''}
            theme="light"
            extensions={[html()]}
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
