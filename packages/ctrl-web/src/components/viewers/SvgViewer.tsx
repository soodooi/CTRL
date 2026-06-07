// SvgViewer — inline-render SVG markup directly. Browser-native, zero
// deps. Source-mode toggles to a CodeMirror buffer for editing. Used for
// mcp icon.svg files (~/.ctrl/mcps/<id>/assets/icon.svg) and any
// SVG asset in the vault.

import { useState, type ReactElement } from 'react';
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
            {/* SVG is XML — dangerouslySetInnerHTML is the canonical
                way to inline-render trusted vault content. The vault is
                user-controlled, not arbitrary third-party HTML. */}
            <div
              className={styles.svgFigure}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: content ?? '' }}
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
