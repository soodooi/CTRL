// HtmlViewer — sandboxed iframe rendering rich vault HTML (incl. frontend-slides
// decks with inline JS + an in-page editor). Source-mode toggle drops to a
// CodeMirror buffer for editing.
//
// Per `.kiro/steering/development-philosophy.md` Design Philosophy: viewers
// cover content type, not platform. HTML is rendered locally — no third-party
// preview service.

import { useMemo, useState, type ReactElement } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

// ADR-004 §1 sandbox: rich vault HTML (e.g. frontend-slides decks) needs inline
// JS for animations + the in-page editor, so the preview iframe runs with
// `allow-scripts` (and `allow-downloads` so a deck's "Export HTML" works) — but
// NOT `allow-same-origin`: the frame keeps a null origin and can never reach the
// cockpit, its cookies, or its storage. A strict CSP injected at render time
// blocks script network egress entirely: NO `connect-src` (so fetch / XHR /
// WebSocket / beacon are dead) and `default-src 'none'`, so an inline script can
// render and edit but can never carry user data off the machine — CTRL's data
// sovereignty holds while matching the "controlled sandbox" best practice
// (Claude Artifacts / ChatGPT Canvas). The ONE allowance is read-only web fonts
// from known typography providers (Fontshare / Google Fonts) so designed decks
// keep their look; a font GET carries no user data, and offline it degrades to
// system fonts (derived rule #1). The CSP is injected only into the rendered
// srcDoc, never into the saved file, so the user's HTML stays clean.
const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com; " +
  'font-src data: https://*.fontshare.com https://fonts.gstatic.com; ' +
  'img-src data: blob:; media-src data: blob:; ' +
  "object-src 'none'; base-uri 'none'";

function withSandboxCsp(content: string): string {
  if (content.trim() === '') return content;
  const meta = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`;
  if (/<head[^>]*>/i.test(content)) {
    return content.replace(/<head[^>]*>/i, (m) => `${m}${meta}`);
  }
  if (/<html[^>]*>/i.test(content)) {
    return content.replace(/<html[^>]*>/i, (m) => `${m}<head>${meta}</head>`);
  }
  return `<head>${meta}</head>${content}`;
}

export const HtmlViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error } =
    useViewerResource(resource);
  const [mode, setMode] = useState<'preview' | 'source'>('preview');

  const srcDoc = useMemo(() => withSandboxCsp(content ?? ''), [content]);

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
          <iframe
            title={resource.uri}
            className={styles.htmlSandbox}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-downloads"
          />
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
