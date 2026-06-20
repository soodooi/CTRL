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
import type { AiColumnOp, AiColumnSummary } from '@/lib/kernel';
import { baseCellType, type BaseCellType, type ColumnSpec, type SmartTable, type ViewSpec } from '@/lib/smart-table';
import {
  queryTable,
  type Filter,
  type Operator,
  type SortKey,
} from '@/lib/smart-table-query';
import styles from './Viewer.module.css';

const OPERATORS_BY_TYPE: Record<BaseCellType, Operator[]> = {
  text: ['contains', 'eq', 'neq'],
  url: ['contains', 'eq', 'neq'],
  select: ['eq', 'neq'],
  number: ['gt', 'lt', 'gte', 'lte', 'eq', 'neq'],
  date: ['within', 'before', 'after', 'eq'],
  checkbox: ['is'],
  tags: ['has_tag', 'neq'],
};

/** Deterministic pill colour for a select/tag token — stable across renders,
 *  zero config (no per-option colour stored in schema). */
const tokenHue = (token: string): number => {
  let h = 0;
  for (let i = 0; i < token.length; i += 1) h = (h * 31 + token.charCodeAt(i)) % 360;
  return h;
};
const pillStyle = (token: string): { background: string; color: string; borderColor: string } => {
  const h = tokenHue(token);
  return {
    background: `hsl(${h} 70% 92%)`,
    color: `hsl(${h} 60% 30%)`,
    borderColor: `hsl(${h} 60% 80%)`,
  };
};

const formatCurrency = (raw: string, symbol: string): string => {
  const n = Number(raw);
  if (raw.trim() === '' || Number.isNaN(n)) return raw;
  return `${symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const VALUE_HINT: Partial<Record<Operator, string>> = {
  within: 'today / this_week / this_month / past_7_days',
  is: 'true / false',
  has_tag: 'tag',
};

/** Group rows into kanban columns by a field's value, preserving first-seen
 *  column order. */
const kanbanColumns = (
  rows: Array<Record<string, string>>,
  field: string,
): Array<[string, Array<Record<string, string>>]> => {
  const map = new Map<string, Array<Record<string, string>>>();
  for (const row of rows) {
    const key = row[field] ?? '';
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return [...map.entries()];
};

interface CellProps {
  col: ColumnSpec;
  value: string;
  editable: boolean;
  onChange: (next: string) => void;
}

// "Render is the type" (Feishu/Teable): checkbox / rating / select / progress /
// currency / link render distinctly; click a plain cell to edit it. The editor
// is chosen by the SEMANTIC base type (baseCellType), the display by the
// render-level type.
const Cell = ({ col, value, editable, onChange }: CellProps): ReactElement => {
  const [editing, setEditing] = useState(false);
  const base = baseCellType(col.type);

  // Always-interactive displays (no separate edit mode needed).
  if (col.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={value === 'x' || value === 'true'}
        onChange={(e) => onChange(e.target.checked ? 'x' : '')}
        disabled={!editable}
        aria-label={col.label}
      />
    );
  }
  if (col.type === 'rating') {
    const max = col.max ?? 5;
    const filled = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    return (
      <span className={styles.rating} role="img" aria-label={`${filled} of ${max}`}>
        {Array.from({ length: max }, (_, i) => (
          <button
            key={i}
            type="button"
            className={styles.star}
            data-on={i < filled}
            disabled={!editable}
            onClick={() => onChange(String(i + 1 === filled ? i : i + 1))}
            tabIndex={-1}
          >
            {i < filled ? '★' : '☆'}
          </button>
        ))}
      </span>
    );
  }

  // Edit mode: a type-appropriate editor, committed on blur / Enter.
  if (editing && editable) {
    const commit = (v: string): void => {
      onChange(v);
      setEditing(false);
    };
    if (col.type === 'multiline') {
      return (
        <textarea
          autoFocus
          className={styles.cellEditorArea}
          defaultValue={value}
          onBlur={(e) => commit(e.target.value)}
        />
      );
    }
    if (col.type === 'select') {
      return (
        <select
          autoFocus
          className={styles.tableCell}
          value={value}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setEditing(false)}
        >
          <option value=""></option>
          {col.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    }
    const inputType =
      base === 'number' ? 'number' : base === 'date' ? 'date' : col.type === 'email' ? 'email' : col.type === 'phone' ? 'tel' : col.type === 'url' ? 'url' : 'text';
    return (
      <input
        autoFocus
        className={styles.tableCell}
        type={inputType}
        defaultValue={value}
        min={base === 'number' ? col.min : undefined}
        max={base === 'number' ? col.max : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && base !== 'text') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={(e) => commit(e.target.value)}
      />
    );
  }

  // Display mode (rich render per type).
  const activate = editable ? () => setEditing(true) : undefined;
  if (col.type === 'select') {
    return value ? (
      <button type="button" className={styles.pill} style={pillStyle(value)} onClick={activate}>
        {value}
      </button>
    ) : (
      <span className={styles.cellEmpty} onClick={activate}>
        —
      </span>
    );
  }
  if (col.type === 'tags') {
    const tags = value.split(',').map((t) => t.trim()).filter(Boolean);
    return (
      <span className={styles.tags} onClick={activate}>
        {tags.length === 0 ? <span className={styles.cellEmpty}>—</span> : tags.map((t) => (
          <span key={t} className={styles.pill} style={pillStyle(t)}>
            {t}
          </span>
        ))}
      </span>
    );
  }
  if (col.type === 'progress') {
    const max = col.max ?? 100;
    const pct = Math.max(0, Math.min(100, (Number(value) || 0) * (100 / max)));
    return (
      <span className={styles.progressWrap} onClick={activate}>
        <span className={styles.progressBar}>
          <span className={styles.progressFill} style={{ width: `${pct}%` }} />
        </span>
        <span className={styles.progressText}>{value === '' ? '—' : `${Math.round(pct)}%`}</span>
      </span>
    );
  }
  if (col.type === 'currency') {
    return (
      <span className={styles.cellNumber} onClick={activate}>
        {value === '' ? <span className={styles.cellEmpty}>—</span> : formatCurrency(value, col.symbol ?? '$')}
      </span>
    );
  }
  if (col.type === 'url' && value) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className={styles.tableLink}>
        {value}
      </a>
    );
  }
  if (col.type === 'email' && value) {
    return (
      <a href={`mailto:${value}`} className={styles.tableLink}>
        {value}
      </a>
    );
  }
  if (col.type === 'phone' && value) {
    return (
      <a href={`tel:${value}`} className={styles.tableLink}>
        {value}
      </a>
    );
  }
  return (
    <span
      className={base === 'number' ? styles.cellNumber : styles.cellText}
      data-multiline={col.type === 'multiline'}
      onClick={activate}
    >
      {value === '' ? <span className={styles.cellEmpty}>—</span> : value}
    </span>
  );
};

export interface SmartTableViewProps {
  table: SmartTable;
  editable: boolean;
  onCellChange: (rowIndex: number, key: string, value: string) => void;
  onDeleteRow?: (rowIndex: number) => void;
  /** Persist the current view (kind + groupBy) into frontmatter `views`
   *  (ADR-003 §6.2). When set, a "Save view" button appears. */
  onSaveView?: (view: ViewSpec) => void;
  /** Run an AI field shortcut down `field` (ADR-003 §6.5.4). When set, each
   *  column header shows an AI-fill action. The caller runs it through the
   *  kernel, persists, and refreshes; this view just collects op + prompt. */
  onRunAiColumn?: (field: string, op: AiColumnOp, prompt: string) => Promise<AiColumnSummary>;
}

export const SmartTableView = ({
  table,
  editable,
  onCellChange,
  onDeleteRow,
  onSaveView,
  onRunAiColumn,
}: SmartTableViewProps): ReactElement => {
  // Initialize from the saved view (ADR-003 §6.2): the kernel's add_view writes
  // frontmatter `views`, and the viewer reads it back so the two paths stay in
  // sync (closes the §6.2 read/write loop).
  const savedView: ViewSpec | undefined = table.views[0];
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<SortKey | null>(null);
  const [groupBy, setGroupBy] = useState<string | null>(savedView?.groupBy ?? null);
  const [viewMode, setViewMode] = useState<'grid' | 'kanban'>(savedView?.kind ?? 'grid');
  // Kanban columns by a select/checkbox field; falls back to the active group.
  const kanbanField =
    groupBy ?? table.schema.find((c) => c.type === 'select' || c.type === 'checkbox')?.key ?? null;
  const [draft, setDraft] = useState<Filter>({
    field: table.schema[0]?.key ?? '',
    op: 'contains',
    value: '',
  });

  // AI column (ADR-003 §6.5.4): which field's AI-fill panel is open + its draft.
  const [aiField, setAiField] = useState<string | null>(null);
  const [aiOp, setAiOp] = useState<AiColumnOp>('generate');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResult, setAiResult] = useState<AiColumnSummary | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const runAi = async (): Promise<void> => {
    if (!aiField || !onRunAiColumn || !aiPrompt.trim()) return;
    setAiRunning(true);
    setAiError(null);
    setAiResult(null);
    try {
      setAiResult(await onRunAiColumn(aiField, aiOp, aiPrompt));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiRunning(false);
    }
  };

  const typeOf = (key: string): BaseCellType =>
    baseCellType(table.schema.find((c) => c.key === key)?.type ?? 'text');
  const draftOps = OPERATORS_BY_TYPE[typeOf(draft.field)] ?? ['contains', 'eq'];

  // Run the §14 query, preserving each row's canonical index in `__idx` so
  // edits on a filtered/sorted view still target the right underlying row.
  const indexed = useMemo(
    () => ({ ...table, rows: table.rows.map((r, i) => ({ ...r, __idx: String(i) })) }),
    [table],
  );
  const result = useMemo(
    () => queryTable(indexed, { filters, sort: sort ? [sort] : [], groupBy }),
    [indexed, filters, sort, groupBy],
  );
  const groupLabel = (key: string) => table.schema.find((c) => c.key === key)?.label ?? key;

  const columns = useMemo<ColumnDef<Record<string, string>>[]>(() => {
    return [
      ...table.schema.map<ColumnDef<Record<string, string>>>((col) => ({
        accessorKey: col.key,
        header: () => (
          <span className={styles.headerCell}>
            {col.label}
            {editable && onRunAiColumn && (
              <button
                type="button"
                className={styles.aiColBtn}
                title={`AI fill ${col.label}`}
                data-testid={`ai-col-${col.key}`}
                onClick={() => {
                  setAiField(col.key);
                  setAiResult(null);
                  setAiError(null);
                  setAiPrompt('');
                }}
              >
                ✦
              </button>
            )}
          </span>
        ),
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
  }, [table.schema, editable, onCellChange, onDeleteRow, onRunAiColumn]);

  const reactTable = useReactTable({ data: result.rows, columns, getCoreRowModel: getCoreRowModel() });

  const addFilter = (): void => {
    if (!draft.field) return;
    setFilters((fs) => [...fs, draft]);
    setDraft({ field: draft.field, op: draft.op, value: '' });
  };

  return (
    <div>
      <div className={styles.queryBar} data-testid="smart-table-query-bar">
        <div className={styles.viewToggle}>
          <button
            type="button"
            className={styles.viewToggleBtn}
            data-active={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
          >
            Grid
          </button>
          <button
            type="button"
            className={styles.viewToggleBtn}
            data-active={viewMode === 'kanban'}
            onClick={() => setViewMode('kanban')}
            data-testid="smart-table-kanban-toggle"
          >
            Kanban
          </button>
        </div>
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

        <span className={styles.queryLabel}>Group</span>
        <select
          className={styles.querySelect}
          value={groupBy ?? ''}
          onChange={(e) => setGroupBy(e.target.value || null)}
          data-testid="smart-table-group"
        >
          <option value="">none</option>
          {table.schema.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>

        {onSaveView && (
          <button
            type="button"
            className={styles.queryAdd}
            onClick={() => onSaveView({ kind: viewMode, groupBy })}
            title="Save this view to the table's frontmatter"
            data-testid="smart-table-save-view"
          >
            Save view
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

      {aiField && onRunAiColumn && (
        <div className={styles.aiPanel} data-testid="ai-col-panel">
          <span className={styles.aiPanelTitle}>
            ✦ AI fill: {table.schema.find((c) => c.key === aiField)?.label ?? aiField}
          </span>
          <select
            className={styles.querySelect}
            value={aiOp}
            onChange={(e) => setAiOp(e.target.value as AiColumnOp)}
            aria-label="AI operation"
          >
            <option value="generate">generate</option>
            <option value="classify">classify</option>
            <option value="extract">extract</option>
            <option value="summarize">summarize</option>
            <option value="translate">translate</option>
          </select>
          <input
            className={styles.aiPanelPrompt}
            value={aiPrompt}
            placeholder="Instruction — reference columns with {field}, e.g. Summarize {notes} in one line"
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !aiRunning && aiPrompt.trim()) void runAi();
            }}
          />
          <button
            type="button"
            className={styles.queryAdd}
            disabled={aiRunning || !aiPrompt.trim()}
            onClick={() => void runAi()}
            data-testid="ai-col-run"
          >
            {aiRunning ? 'Running…' : 'Run'}
          </button>
          <button type="button" className={styles.queryChip} onClick={() => setAiField(null)}>
            Close
          </button>
          {aiResult && (
            <span className={styles.aiPanelMsg}>
              wrote {aiResult.rows_written}/{aiResult.rows_planned}
              {aiResult.errors.length > 0 ? ` · ${aiResult.errors.length} failed` : ''}
            </span>
          )}
          {aiError && <span className={styles.aiPanelErr}>{aiError}</span>}
        </div>
      )}

      {viewMode === 'grid' ? (
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
            {(() => {
              const rows = reactTable.getRowModel().rows;
              const colspan = table.schema.length + 1;
              const out: ReactElement[] = [];
              let prev: string | null = null;
              for (const row of rows) {
                if (groupBy) {
                  const g = row.original[groupBy] ?? '';
                  if (g !== prev) {
                    prev = g;
                    out.push(
                      <tr key={`group-${g}`} className={styles.groupHeader}>
                        <td colSpan={colspan} className={styles.groupHeaderCell}>
                          {groupLabel(groupBy)}: {g || '—'}
                        </td>
                      </tr>,
                    );
                  }
                }
                out.push(
                  <tr key={row.id} className={styles.tableRow}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={styles.tableCellWrap}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>,
                );
              }
              return out;
            })()}
          </tbody>
        </table>
      </div>
      ) : (
        <div className={styles.kanban} data-testid="smart-table-kanban">
          {kanbanField == null ? (
            <div className={styles.kanbanEmpty}>Pick a select or checkbox field to columnize.</div>
          ) : (
            kanbanColumns(result.rows, kanbanField).map(([value, rows]) => (
              <div key={value || '—'} className={styles.kanbanCol}>
                <div className={styles.kanbanColHead}>
                  <span>{value || '—'}</span>
                  <span className={styles.kanbanColCount}>{rows.length}</span>
                </div>
                {rows.map((row, i) => (
                  <div key={i} className={styles.kanbanCard}>
                    {table.schema
                      .filter((c) => c.key !== kanbanField)
                      .map((c) => (
                        <div key={c.key} className={styles.kanbanCardRow}>
                          <span className={styles.kanbanCardLabel}>{c.label}</span>
                          <span className={styles.kanbanCardValue}>{row[c.key] || '—'}</span>
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
