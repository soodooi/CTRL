// TomlViewer — CodeMirror 6 via @codemirror/legacy-modes (no first-party
// TOML lang ships in CodeMirror 6 core). Used for ~/.ctrl/config.toml
// and mcp `config.toml` files (the Config-tier adjustment surface).

import { useMemo, type ReactElement } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const TomlViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error } =
    useViewerResource(resource);
  const extensions = useMemo(() => [StreamLanguage.define(toml)], []);
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
          extensions={extensions}
          basicSetup={{ lineNumbers: true, foldGutter: true }}
          onChange={(value) => setContent(value)}
          readOnly={!resource.editable}
          className={styles.codeMirror}
        />
      </div>
    </div>
  );
};
