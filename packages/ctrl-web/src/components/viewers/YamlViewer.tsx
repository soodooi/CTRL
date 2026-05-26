// YamlViewer — CodeMirror 6 + lang-yaml. Used for keycap manifests
// (the YAML frontmatter block exported on its own) and *.yaml config.

import type { ReactElement } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const YamlViewer = ({ resource }: ViewerProps): ReactElement => {
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
          extensions={[yaml()]}
          basicSetup={{ lineNumbers: true, foldGutter: true }}
          onChange={(value) => setContent(value)}
          readOnly={!resource.editable}
          className={styles.codeMirror}
        />
      </div>
    </div>
  );
};
