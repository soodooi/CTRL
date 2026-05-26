// CodeViewer — CodeMirror 6 editor for structured-text + code resources.
//
// Picks the language extension off the resource's content-type so JSON
// gets brace-matching, YAML gets indent guides, HTML gets tag folding,
// etc. Unknown content-types fall through to plain text (still syntax-
// highlighted with line numbers, just no language mode).
//
// Single lazy chunk for all code/config languages — splitting per
// language would add HTTP overhead for marginal byte savings since the
// CodeMirror runtime is the bulk of the bundle. The language extension
// modules themselves are small (~5KB each).

import { useMemo, type ReactElement } from 'react';
import CodeMirror, { type Extension } from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { StreamLanguage } from '@codemirror/language';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

const languageForContentType = (contentType: string): Extension[] => {
  // Normalise — accept both `application/json` and `text/json` aliases.
  const ct = contentType.toLowerCase().split(';')[0]!.trim();
  switch (ct) {
    case 'application/json':
    case 'text/json':
      return [json()];
    case 'application/yaml':
    case 'text/yaml':
    case 'application/x-yaml':
      return [yaml()];
    case 'application/toml':
    case 'text/toml':
    case 'application/x-toml':
      return [StreamLanguage.define(toml)];
    case 'application/javascript':
    case 'text/javascript':
    case 'application/typescript':
    case 'text/typescript':
      return [javascript({ typescript: ct.includes('typescript') })];
    case 'text/html':
    case 'application/xhtml+xml':
      return [html()];
    case 'text/markdown':
      return [markdown()];
    case 'text/x-rust':
    case 'application/x-rust':
      return [StreamLanguage.define(rust)];
    case 'text/x-shellscript':
    case 'application/x-sh':
      return [StreamLanguage.define(shell)];
    default:
      return [];
  }
};

export const CodeViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error, writable } =
    useViewerResource(resource);

  const extensions = useMemo(
    () => languageForContentType(resource.contentType),
    [resource.contentType],
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
      <div className={styles.scroll}>
        {content === null && !error ? (
          <pre className={styles.markdownStub}>loading…</pre>
        ) : error && content === null ? (
          <pre className={styles.markdownStub} role="alert">
            {error}
          </pre>
        ) : (
          <CodeMirror
            value={content ?? ''}
            extensions={extensions}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
            onChange={(value) => setContent(value)}
            readOnly={!resource.editable}
            className={styles.codeMirror}
            height="100%"
          />
        )}
      </div>
    </div>
  );
};
