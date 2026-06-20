// SmartTableViewer — Notion-style structured table over a markdown file whose
// frontmatter declares a `schema:` block (vim test: the file is ordinary
// markdown; this view is a projection).
//
// IMPORTANT: it loads via `vault_read` directly (frontmatter + body) and builds
// the table from BOTH parts. The generic viewer pipeline (`useViewerResource`
// → `vault://`) returns the BODY ONLY — the frontmatter is stripped — so it can
// never see the schema. Saves go back through `vault_write` (body + frontmatter
// separately; the kernel re-emits the YAML).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import { readVault, writeVault, vaultRelativePath } from '@/lib/viewer-uri';
import {
  appendRow,
  deleteRow,
  smartTableBody,
  smartTableFrontmatter,
  smartTableFromParts,
  updateCell,
  type SmartTable,
} from '@/lib/smart-table';
import { SmartTableView } from './SmartTableView';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

export const SmartTableViewer = ({ resource }: ViewerProps): ReactElement => {
  const qc = useQueryClient();
  const path = vaultRelativePath(resource.uri);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const { data: entry, isLoading } = useQuery({
    queryKey: ['smart-table-file', path],
    queryFn: () => readVault(path),
  });

  const table: SmartTable = useMemo(
    () =>
      entry
        ? smartTableFromParts((entry.frontmatter ?? {}) as Record<string, unknown>, entry.content)
        : { schema: [], rows: [], views: [], extraFrontmatter: {} },
    [entry],
  );

  const commit = async (next: SmartTable): Promise<void> => {
    setSaving(true);
    setError(undefined);
    try {
      await writeVault(path, smartTableBody(next), smartTableFrontmatter(next));
      await qc.invalidateQueries({ queryKey: ['smart-table-file', path] });
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const rightActions = resource.editable ? (
    <button type="button" className={styles.modeButton} onClick={() => void commit(appendRow(table))} title="Add row">
      + Row
    </button>
  ) : null;

  if (isLoading && !entry) {
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
      <ViewerChrome resource={resource} saving={saving} error={error} rightActions={rightActions} />
      {table.title && <h2 className={styles.tableTitle}>{table.title}</h2>}
      <SmartTableView
        table={table}
        editable={resource.editable}
        onCellChange={(rowIndex, key, value) => void commit(updateCell(table, rowIndex, key, value))}
        onDeleteRow={(rowIndex) => void commit(deleteRow(table, rowIndex))}
        onSaveView={resource.editable ? (view) => void commit({ ...table, views: [view] }) : undefined}
      />
    </div>
  );
};
