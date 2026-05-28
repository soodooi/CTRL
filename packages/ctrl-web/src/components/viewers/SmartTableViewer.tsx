// SmartTableViewer — Notion-style structured table rendered from a
// markdown file with a frontmatter schema. Per
// decision_ctrl_obsidian_philosophy: vim test passes because the file
// is ordinary markdown — the table view is a *projection* over the
// canonical plain-text source.
//
// Edit flow: parse → render via Tanstack Table → in-cell edit →
// re-serialize → save back to the vault. The kernel's vault_write
// re-renders the YAML frontmatter; we hand back the markdown body
// (frontmatter + table together) and let vault_write split it.
//
// Cell renderers by type:
//   text     — <input type="text">
//   number   — <input type="number"> with min/max
//   date     — <input type="date">
//   checkbox — `x` / empty
//   tags     — comma-separated tokens
//   select   — <select> with options
//   url      — <input type="url"> rendered as link in preview

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactElement } from 'react';
import type { ViewerProps } from '@/lib/viewer-registry';
import {
  appendRow,
  deleteRow,
  parseSmartTable,
  serializeSmartTable,
  updateCell,
  type ColumnSpec,
  type SmartTable,
} from '@/lib/smart-table';
import { listKeycaps, runKeycap, type KeycapSummary } from '@/lib/kernel';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

interface KeycapChipsProps {
  ids: ReadonlyArray<string>;
  rows: ReadonlyArray<Record<string, string>>;
  selectedRowIndices: ReadonlyArray<number>;
  tableTitle?: string;
}

const KeycapChips = ({
  ids,
  rows,
  selectedRowIndices,
  tableTitle,
}: KeycapChipsProps): ReactElement => {
  const { data: catalog = [] } = useQuery({
    queryKey: ['keycaps-installed'],
    queryFn: listKeycaps,
    staleTime: 30_000,
  });
  const byId = useMemo(() => {
    const map = new Map<string, KeycapSummary>();
    for (const k of catalog) map.set(k.id, k);
    return map;
  }, [catalog]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const selectedRows = selectedRowIndices.length > 0
    ? selectedRowIndices.map((i) => rows[i]).filter((r): r is Record<string, string> => Boolean(r))
    : rows;

  const fire = async (id: string): Promise<void> => {
    setBusyId(id);
    setStatus(null);
    try {
      await runKeycap(id, {
        table: tableTitle ?? null,
        rows: selectedRows,
        selection_count: selectedRowIndices.length,
      });
      setStatus(`→ ${byId.get(id)?.name ?? id} invoked on ${selectedRows.length} row${selectedRows.length === 1 ? '' : 's'}`);
    } catch (err) {
      setStatus(`× ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.keycapBar}>
      <div className={styles.keycapBarChips}>
        {ids.map((id) => {
          const summary = byId.get(id);
          const missing = !summary;
          const name = summary?.name ?? id.replace(/^ctrl\.builtin\./, '');
          return (
            <button
              key={id}
              type="button"
              className={`${styles.keycapChip}${missing ? ` ${styles.keycapChipMissing}` : ''}`}
              onClick={() => void fire(id)}
              disabled={missing || busyId === id}
              title={missing ? `${id} not installed` : `Run "${name}" on ${selectedRows.length} row${selectedRows.length === 1 ? '' : 's'}`}
            >
              {busyId === id ? '…' : name}
            </button>
          );
        })}
        <span className={styles.keycapBarHint}>
          {selectedRowIndices.length > 0
            ? `${selectedRowIndices.length} selected`
            : `all ${rows.length}`}
        </span>
      </div>
      {status && <div className={styles.keycapBarStatus}>{status}</div>}
    </div>
  );
};

interface CellProps {
  col: ColumnSpec;
  value: string;
  editable: boolean;
  onChange: (next: string) => void;
}

const Cell = ({ col, value, editable, onChange }: CellProps): ReactElement => {
  const common = {
    className: styles.tableCell,
    disabled: !editable,
  };
  switch (col.type) {
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={value === 'x' || value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'x' : '')}
          disabled={!editable}
          aria-label={col.label}
        />
      );
    case 'number':
      return (
        <input
          {...common}
          type="number"
          value={value}
          min={col.min}
          max={col.max}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'date':
      return (
        <input
          {...common}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'select':
      return (
        <select
          {...common}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value=""></option>
          {col.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'tags':
      return (
        <input
          {...common}
          type="text"
          value={value}
          placeholder="tag, tag, tag"
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'url':
      return editable ? (
        <input
          {...common}
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <a href={value} target="_blank" rel="noreferrer" className={styles.tableLink}>
          {value}
        </a>
      );
    default:
      return (
        <input
          {...common}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
};

export const SmartTableViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error } =
    useViewerResource(resource);
  const [selected, setSelected] = useState<ReadonlyArray<number>>([]);

  const table: SmartTable = useMemo(
    () => (content ? parseSmartTable(content) : { schema: [], rows: [], extraFrontmatter: {} }),
    [content],
  );

  const commit = (next: SmartTable): void => {
    setContent(serializeSmartTable(next));
  };

  const toggleSelected = (i: number): void => {
    setSelected((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]);
  };

  const hasKeycaps = (table.keycaps?.length ?? 0) > 0;

  const columns = useMemo<ColumnDef<Record<string, string>>[]>(() => {
    const editable = resource.editable;
    const selectionCol: ColumnDef<Record<string, string>>[] = hasKeycaps
      ? [
          {
            id: '__select',
            header: '',
            cell: ({ row }) => (
              <input
                type="checkbox"
                checked={selected.includes(row.index)}
                onChange={() => toggleSelected(row.index)}
                aria-label={`Select row ${row.index + 1}`}
              />
            ),
          },
        ]
      : [];
    return [
      ...selectionCol,
      ...table.schema.map<ColumnDef<Record<string, string>>>((col) => ({
        accessorKey: col.key,
        header: col.label,
        cell: ({ row }) => (
          <Cell
            col={col}
            value={row.original[col.key] ?? ''}
            editable={editable}
            onChange={(value) =>
              commit(updateCell(table, row.index, col.key, value))
            }
          />
        ),
      })),
      {
        id: '__actions',
        header: '',
        cell: ({ row }) =>
          editable ? (
            <button
              type="button"
              className={styles.tableRowAction}
              onClick={() => commit(deleteRow(table, row.index))}
              aria-label="Delete row"
              title="Delete row"
            >
              ×
            </button>
          ) : null,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, resource.editable, hasKeycaps, selected]);

  const reactTable = useReactTable({
    data: table.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const rightActions = resource.editable ? (
    <button
      type="button"
      className={styles.modeButton}
      onClick={() => commit(appendRow(table))}
      title="Add row"
    >
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
            Add a <code>schema:</code> block to the file's frontmatter to render
            this markdown table as a smart table. See{' '}
            <code>lib/smart-table.ts</code> for the schema shape.
          </p>
        </div>
      </div>
    );
  }

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
      {table.title && (
        <h2 className={styles.tableTitle}>{table.title}</h2>
      )}
      {hasKeycaps && (
        <KeycapChips
          ids={table.keycaps ?? []}
          rows={table.rows}
          selectedRowIndices={selected}
          tableTitle={table.title}
        />
      )}
      <div className={styles.scroll}>
        <table className={styles.tableEl}>
          <thead>
            {reactTable.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className={styles.tableHeader}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {reactTable.getRowModel().rows.map((row) => (
              <tr key={row.id} className={styles.tableRow}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={styles.tableCellWrap}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
