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
import { smartTableRunAiColumn, type AiColumnOp, type AiColumnSummary } from '@/lib/kernel';
import { readVault, writeVault, vaultRelativePath } from '@/lib/viewer-uri';
import {
  addColumn,
  appendRow,
  appendRowWithValues,
  deleteColumn,
  deleteRow,
  deleteRows,
  moveRow,
  smartTableBody,
  smartTableFrontmatter,
  smartTableFromParts,
  updateCell,
  updateColumn,
  type ColumnSpec,
  type SmartTable,
} from '@/lib/smart-table';
import { linkTargets } from '@/lib/smart-table-relations';
import { listSmartTables } from '@/lib/smart-tables';
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

  // Relational: preload the target tables this table's link columns reference,
  // so link display / Lookup / Rollup can resolve foreign rows by id.
  const linkPaths = useMemo(() => linkTargets(table.schema), [table.schema]);
  const { data: relations } = useQuery({
    queryKey: ['smart-table-links', path, linkPaths.join('|')],
    queryFn: async (): Promise<Record<string, SmartTable>> => {
      const out: Record<string, SmartTable> = {};
      for (const lp of linkPaths) {
        try {
          const e = await readVault(lp);
          out[lp] = smartTableFromParts((e.frontmatter ?? {}) as Record<string, unknown>, e.content);
        } catch {
          // target table missing — link cells render as "(missing)".
        }
      }
      return out;
    },
    enabled: linkPaths.length > 0,
  });

  // All smart tables in the vault — for the field editor's link-target picker.
  const { data: allTables } = useQuery({ queryKey: ['smart-tables'], queryFn: listSmartTables });

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

  // AI column (ADR-003 §6.5.4): run the kernel field shortcut, retry past the
  // cost gate on explicit confirmation, then refresh the file so the filled
  // cells render. Reuses the same kernel core the :17873 gate tool does.
  const runAiColumn = async (field: string, op: AiColumnOp, prompt: string): Promise<AiColumnSummary> => {
    const base = { path, target_field: field, op, prompt };
    let summary: AiColumnSummary;
    try {
      summary = await smartTableRunAiColumn(base);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('needs_confirmation') && window.confirm(`${msg}\n\nRun it anyway?`)) {
        summary = await smartTableRunAiColumn({ ...base, confirm_over_gate: true });
      } else {
        throw e;
      }
    }
    await qc.invalidateQueries({ queryKey: ['smart-table-file', path] });
    return summary;
  };

  // Add a row, then auto-fill any column whose schema requests it (ADR-003
  // §6.5.4 auto-update). run_ai_column resumes over empty cells, so the new
  // row gets filled; best-effort, the ✦ panel covers manual reruns.
  const addRow = async (): Promise<void> => {
    const next = appendRow(table);
    await commit(next);
    for (const f of next.schema) {
      if (f.aiAutoFill && f.aiOp && f.aiPrompt) {
        try {
          await runAiColumn(f.key, f.aiOp as AiColumnOp, f.aiPrompt);
        } catch {
          // best-effort; user can run the column manually via the ✦ panel.
        }
      }
    }
  };

  const rightActions = resource.editable ? (
    <button type="button" className={styles.modeButton} onClick={() => void addRow()} title="Add row">
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
        relations={relations ?? {}}
        linkTargets={(allTables ?? []).filter((t) => t.path !== path).map((t) => ({ path: t.path, title: t.title }))}
        onCellChange={(rowIndex, key, value) => void commit(updateCell(table, rowIndex, key, value))}
        onDeleteRow={(rowIndex) => void commit(deleteRow(table, rowIndex))}
        onDeleteRows={resource.editable ? (idxs) => void commit(deleteRows(table, idxs)) : undefined}
        onMoveRow={resource.editable ? (from, to) => void commit(moveRow(table, from, to)) : undefined}
        onSaveView={resource.editable ? (view) => void commit({ ...table, views: [view] }) : undefined}
        onRunAiColumn={resource.editable ? runAiColumn : undefined}
        onAddColumn={resource.editable ? (col: ColumnSpec) => void commit(addColumn(table, col)) : undefined}
        onUpdateColumn={
          resource.editable ? (key, patch) => void commit(updateColumn(table, key, patch)) : undefined
        }
        onDeleteColumn={resource.editable ? (key) => void commit(deleteColumn(table, key)) : undefined}
        onReplaceViews={resource.editable ? (views) => void commit({ ...table, views }) : undefined}
        onSubmitForm={resource.editable ? (values) => void commit(appendRowWithValues(table, values)) : undefined}
      />
    </div>
  );
};
