// SmartTableView — the presentational smart table: a §14 query bar
// (filter / sort / group, powered by lib/smart-table-query) over a TanStack
// table with per-type cell editors. Pure props in / callbacks out, so it
// renders both from a vault resource (SmartTableViewer) and from sample data
// (the table-lab dev route) and stays unit-testable.
//
// View state (filters/sort/group) is NOT data (ADR-003 §6.2): it lives in
// component state and never mutates the rows. Edits still target the canonical
// row via a preserved original index, so editing a filtered view is correct.

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useMemo, useState, type ReactElement } from 'react';
import type { ColumnSpec, SmartTable } from '@/lib/smart-table';
import {
  queryTable,
  type Filter,
  type Operator,
  type SortKey,
} from '@/lib/smart-table-query';
import styles from './Viewer.module.css';

const OPERATORS_BY_TYPE: Record<string, Operator[]> = {
  text: ['contains', 'eq', 'neq'],
  url: ['contains', 'eq', 'neq'],
  select: ['eq', 'neq'],
  number: ['gt', 'lt', 'gte', 'lte', 'eq', 'neq'],
  date: ['within', 'before', 'after', 'eq'],
  checkbox: ['is'],
  tags: ['has_tag', 'neq'],
};

const VALUE_HINT: Partial<Record<Operator, string>> = {
  within: 'today / this_week / this_month / past_7_days',
  is: 'true / false',
  has_tag: 'tag',
};

interface CellProps {
  col: ColumnSpec;
  value: string;
  editable: boolean;
  onChange: (next: string) => void;
}

const Cell = ({ col, value, editable, onChange }: CellProps): ReactElement => {
  const common = { className: styles.tableCell, disabled: !editable };
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
      return <input {...common} type="number" value={value} min={col.min} max={col.max} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input {...common} type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select {...common} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value=""></option>
          {col.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case 'tags':
      return <input {...common} type="text" value={value} placeholder="tag, tag, tag" onChange={(e) => onChange(e.target.value)} />;
    case 'url':
      return editable ? (
        <input {...common} type="url" value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <a href={value} target="_blank" rel="noreferrer" className={styles.tableLink}>
          {value}
        </a>
      );
    default:
      return <input {...common} type="text" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
};

export interface SmartTableViewProps {
  table: SmartTable;
  editable: boolean;
  onCellChange: (rowIndex: number, key: string, value: string) => void;
  onDeleteRow?: (rowIndex: number) => void;
}

export const SmartTableView = ({ table, editable, onCellChange, onDeleteRow }: SmartTableViewProps): ReactElement => {
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<SortKey | null>(null);
  const [draft, setDraft] = useState<Filter>({
    field: table.schema[0]?.key ?? '',
    op: 'contains',
    value: '',
  });

  const typeOf = (key: string) => table.schema.find((c) => c.key === key)?.type ?? 'text';
  const draftOps = OPERATORS_BY_TYPE[typeOf(draft.field)] ?? ['contains', 'eq'];

  // Run the §14 query, preserving each row's canonical index in `__idx` so
  // edits on a filtered/sorted view still target the right underlying row.
  const indexed = useMemo(
    () => ({ ...table, rows: table.rows.map((r, i) => ({ ...r, __idx: String(i) })) }),
    [table],
  );
  const result = useMemo(
    () => queryTable(indexed, { filters, sort: sort ? [sort] : [] }),
    [indexed, filters, sort],
  );

  const columns = useMemo<ColumnDef<Record<string, string>>[]>(() => {
    return [
      ...table.schema.map<ColumnDef<Record<string, string>>>((col) => ({
        accessorKey: col.key,
        header: col.label,
        cell: ({ row }) => (
          <Cell
            col={col}
            value={row.original[col.key] ?? ''}
            editable={editable}
            onChange={(value) => onCellChange(Number(row.original.__idx), col.key, value)}
          />
        ),
      })),
      {
        id: '__actions',
        header: '',
        cell: ({ row }) =>
          editable && onDeleteRow ? (
            <button
              type="button"
              className={styles.tableRowAction}
              onClick={() => onDeleteRow(Number(row.original.__idx))}
              aria-label="Delete row"
              title="Delete row"
            >
              ×
            </button>
          ) : null,
      },
    ];
  }, [table.schema, editable, onCellChange, onDeleteRow]);

  const reactTable = useReactTable({ data: result.rows, columns, getCoreRowModel: getCoreRowModel() });

  const addFilter = (): void => {
    if (!draft.field) return;
    setFilters((fs) => [...fs, draft]);
    setDraft({ field: draft.field, op: draft.op, value: '' });
  };

  return (
    <div>
      <div className={styles.queryBar} data-testid="smart-table-query-bar">
        <span className={styles.queryLabel}>Filter</span>
        <select
          className={styles.querySelect}
          value={draft.field}
          onChange={(e) => {
            const field = e.target.value;
            const ops = OPERATORS_BY_TYPE[typeOf(field)] ?? ['contains'];
            setDraft({ field, op: ops[0] ?? 'contains', value: '' });
          }}
        >
          {table.schema.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          className={styles.querySelect}
          value={draft.op}
          onChange={(e) => setDraft((d) => ({ ...d, op: e.target.value as Operator }))}
        >
          {draftOps.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        <input
          className={styles.queryInput}
          value={draft.value}
          placeholder={VALUE_HINT[draft.op] ?? 'value'}
          onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && addFilter()}
        />
        <button type="button" className={styles.queryAdd} onClick={addFilter} title="Add filter">
          + Filter
        </button>

        <span className={styles.querySpacer} />

        <span className={styles.queryLabel}>Sort</span>
        <select
          className={styles.querySelect}
          value={sort?.field ?? ''}
          onChange={(e) =>
            setSort(e.target.value ? { field: e.target.value, desc: sort?.desc ?? false } : null)
          }
        >
          <option value="">none</option>
          {table.schema.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        {sort && (
          <button
            type="button"
            className={styles.querySort}
            onClick={() => setSort({ field: sort.field, desc: !sort.desc })}
            title="Toggle direction"
          >
            {sort.desc ? '↓' : '↑'}
          </button>
        )}

        <span className={styles.queryCount} data-testid="smart-table-count">
          {result.matchCount} / {table.rows.length}
        </span>
      </div>

      {filters.length > 0 && (
        <div className={styles.queryChips}>
          {filters.map((f, i) => (
            <button
              key={`${f.field}-${f.op}-${i}`}
              type="button"
              className={styles.queryChip}
              onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}
              title="Remove filter"
            >
              {f.field} {f.op} {f.value || '—'} ×
            </button>
          ))}
        </div>
      )}

      <div className={styles.scroll}>
        <table className={styles.tableEl}>
          <thead>
            {reactTable.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th key={header.id} className={styles.tableHeader}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
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
