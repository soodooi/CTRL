// JsonViewer — CodeMirror 6 + lang-json. Used for application/json
// resources (vault frontmatter dumps, manifest, MCP server descriptors).

import type { ReactElement } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const JsonViewer = ({ resource }: ViewerProps): ReactElement => {
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
          extensions={[json()]}
          basicSetup={{ lineNumbers: true, foldGutter: true, bracketMatching: true }}
          onChange={(value) => setContent(value)}
          readOnly={!resource.editable}
          className={styles.codeMirror}
        />
      </div>
    </div>
  );
};
