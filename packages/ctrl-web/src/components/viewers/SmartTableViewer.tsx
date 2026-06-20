// SmartTableViewer — Notion-style structured table rendered from a markdown
// file with a frontmatter schema. Per decision_ctrl_obsidian_philosophy: vim
// test passes because the file is ordinary markdown — the table view is a
// *projection* over the canonical plain-text source.
//
// This wrapper owns the vault resource (load / parse / serialize / save); the
// presentation + §14 query bar live in SmartTableView so they also render in
// the table-lab dev route and stay unit-testable.

import { useMemo, type ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import {
  appendRow,
  deleteRow,
  parseSmartTable,
  serializeSmartTable,
  updateCell,
  type SmartTable,
} from '@/lib/smart-table';
import { SmartTableView } from './SmartTableView';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const SmartTableViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error } = useViewerResource(resource);

  const table: SmartTable = useMemo(
    () => (content ? parseSmartTable(content) : { schema: [], rows: [], views: [], extraFrontmatter: {} }),
    [content],
  );

  const commit = (next: SmartTable): void => setContent(serializeSmartTable(next));

  const rightActions = resource.editable ? (
    <button type="button" className={styles.modeButton} onClick={() => commit(appendRow(table))} title="Add row">
      + Row
    </button>
  ) : null;

  if (content == null && !error) {
    return (
      <div className={styles.frame}>
        <ViewerChrome resource={resource} />
        <div className={styles.scroll}>
          <pre className={styles.markdownStub}>loading…</pre>
        </div>
      </div>
    );
  }

  if (table.schema.length === 0) {
    return (
      <div className={styles.frame}>
        <ViewerChrome resource={resource} error={error} />
        <div className={styles.fallback}>
          <div className={styles.fallbackKind}>schema missing</div>
          <p className={styles.fallbackHint}>
            Add a <code>schema:</code> block to the file's frontmatter to render this markdown table as a smart
            table. See <code>lib/smart-table.ts</code> for the schema shape.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.frame}>
      <ViewerChrome resource={resource} dirty={dirty} saving={saving} error={error} onSave={save} rightActions={rightActions} />
      {table.title && <h2 className={styles.tableTitle}>{table.title}</h2>}
      <SmartTableView
        table={table}
        editable={resource.editable}
        onCellChange={(rowIndex, key, value) => commit(updateCell(table, rowIndex, key, value))}
        onDeleteRow={(rowIndex) => commit(deleteRow(table, rowIndex))}
        onSaveView={resource.editable ? (view) => commit({ ...table, views: [view] }) : undefined}
      />
    </div>
  );
};
