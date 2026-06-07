// CodeViewer — generic code viewer for content types not covered by a
// dedicated module. Uses CodeMirror 6 with no language extension; the
// editor still gets line numbers + fold gutter + bracket matching but
// no syntax highlight. Lighter than per-language packs when a mcp
// returns a one-off file type (e.g. text/rust, text/python).

import type { ReactElement } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const CodeViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error } =
    useViewerResource(resource);
  return (
    <div className={styles.frame}>
      <ViewerChrome
        resource={resource}
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={save}
      />
      <div className={styles.scroll}>
        <CodeMirror
          value={content ?? ''}
          theme="light"
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
          onChange={(value) => setContent(value)}
          readOnly={!resource.editable}
          className={styles.codeMirror}
        />
      </div>
    </div>
  );
};
