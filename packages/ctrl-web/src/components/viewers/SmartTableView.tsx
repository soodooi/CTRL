// SmartTableView — the presentational smart table: a §14 query bar
// (filter / sort / group, powered by lib/smart-table-query) over a TanStack
// table with per-type cell editors. Pure props in / callbacks out, so it
// renders both from a vault resource (SmartTableViewer) and from sample data
// (the table-lab dev route) and stays unit-testable.
//
// View state (filters/sort/group) is NOT data (ADR-003 §6.2): it lives in
// component state and never mutates the rows. Edits still target the canonical
// row via a preserved original index, so editing a filtered view is correct.

import { useState, type ReactElement } from 'react';
import type {
  AiColumnOp,
  AiColumnSummary,
  SmartTableQueryRequest,
  SmartTableQueryResult,
} from '@/lib/kernel';
import { useTableQuery } from './useTableQuery';
import { SmartTableRecordCard } from './SmartTableRecordCard';
import { SmartTableFieldEditor, type FieldEdit } from './SmartTableFieldEditor';
import {
  baseCellType,
  type BaseCellType,
  type ColumnSpec,
  type SmartTable,
  type ViewSpec,
} from '@/lib/smart-table';
import { SmartTableGrid } from './SmartTableGrid';
import { CalendarView, GalleryView, SummaryView } from './SmartTableViews';
import { ChartView } from './SmartTableChart';
import { TimelineView } from './SmartTableTimeline';
import { type Filter, type Operator, type SortKey } from '@/lib/smart-table-query';
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

export interface SmartTableViewProps {
  table: SmartTable;
  editable: boolean;
  onCellChange: (rowIndex: number, key: string, value: string) => void;
  onDeleteRow?: (rowIndex: number) => void;
  /** Batch-delete the given canonical row indices (checkbox selection). */
  onDeleteRows?: (rowIndexes: number[]) => void;
  /** Manual drag-reorder (canonical from → to). Only offered when rows show in
   *  their natural order (no sort / group / filter / search). */
  onMoveRow?: (from: number, to: number) => void;
  /** Duplicate a record (canonical index) — copy inserted right after it. */
  onDuplicateRow?: (rowIndex: number) => void;
  /** Persist the current view (kind + groupBy) into frontmatter `views`
   *  (ADR-003 §6.2). When set, a "Save view" button appears. */
  onSaveView?: (view: ViewSpec) => void;
  /** Run an AI field shortcut down `field` (ADR-003 §6.5.4). When set, each
   *  column header shows an AI-fill action. The caller runs it through the
   *  kernel, persists, and refreshes; this view just collects op + prompt. */
  onRunAiColumn?: (field: string, op: AiColumnOp, prompt: string) => Promise<AiColumnSummary>;
  /** Schema editing (ADR-003 §6.5 A3). When set, column headers gain an edit
   *  menu and the bar gains "+ Field". */
  onAddColumn?: (col: ColumnSpec) => void;
  onUpdateColumn?: (key: string, patch: Partial<Omit<ColumnSpec, 'key'>>) => void;
  onDeleteColumn?: (key: string) => void;
  /** Replace the whole saved-views list (ADR-003 §6.2 multi-view). When set,
   *  a saved-views tab bar + add/update/delete appear. */
  onReplaceViews?: (views: ViewSpec[]) => void;
  /** Form view submit — append a row pre-filled with the entered values. */
  onSubmitForm?: (values: Record<string, string>) => void;
  /** Route the structured query through the §14 kernel gate (smart_table.query)
   *  instead of the in-process client engine — one engine shared with Irisy +
   *  external brains (ADR-002 §14). When absent (or on error) the view falls
   *  back to the client engine, so local-first / dev contexts still work. */
  runQuery?: (request: SmartTableQueryRequest) => Promise<SmartTableQueryResult>;
  /** Loaded target tables (path → SmartTable) for link / Lookup / Rollup. */
  relations?: Record<string, SmartTable>;
  /** Other smart tables in the vault (link-target picker in the field editor). */
  linkTargets?: Array<{ path: string; title: string }>;
}

export const SmartTableView = ({
  table,
  editable,
  onCellChange,
  onDeleteRow,
  onDeleteRows,
  onMoveRow,
  onDuplicateRow,
  onSaveView,
  onRunAiColumn,
  onAddColumn,
  onUpdateColumn,
  onDeleteColumn,
  onReplaceViews,
  onSubmitForm,
  runQuery,
  relations = {},
  linkTargets = [],
}: SmartTableViewProps): ReactElement => {
  // Initialize from the saved view (ADR-003 §6.2): the kernel's add_view writes
  // frontmatter `views`, and the viewer reads it back so the two paths stay in
  // sync (closes the §6.2 read/write loop).
  const savedView: ViewSpec | undefined = table.views[0];
  const [filters, setFilters] = useState<Filter[]>([]);
  const [conjunction, setConjunction] = useState<'and' | 'or'>('and');
  const [sort, setSort] = useState<SortKey | null>(savedView?.sort ?? null);
  const [groupBy, setGroupBy] = useState<string | null>(savedView?.groupBy ?? null);
  const [groupBy2, setGroupBy2] = useState<string | null>(null);
  // Bottom statistic bar (borrowed from Grist's SelectionSummary aggregation):
  // per number column, click to cycle sum / avg / count / min / max.
  const [colStat, setColStat] = useState<Record<string, 'sum' | 'avg' | 'count' | 'min' | 'max'>>({});
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<
    'grid' | 'kanban' | 'gallery' | 'calendar' | 'form' | 'summary' | 'chart' | 'timeline'
  >(savedView?.kind ?? 'grid');
  const [formDraft, setFormDraft] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<number | null>(savedView ? 0 : null);
  const editsViews = Boolean(onReplaceViews);
  // Record detail card (ADR-003 §6 D6): canonical row index, or null = closed.
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  // Grid UX (view-local, not persisted): quick text search across all cells,
  // row density, and whether the primary column is frozen on horizontal scroll.
  const [search, setSearch] = useState('');
  const [density, setDensity] = useState<'compact' | 'cozy' | 'comfortable'>('cozy');
  const [freezePrimary, setFreezePrimary] = useState(false);
  const [hiddenFields, setHiddenFields] = useState<Set<string>>(new Set());
  // Which toolbar popover is open (Grist-minimal: Filter/Sort/Group/Fields live
  // in popovers; the bar shows only flat trigger buttons, never inline selects).
  // (ADR-003 frontend §6 v20, 2026-06-21 — smart-table minimal UI.)
  const [openMenu, setOpenMenu] = useState<'filter' | 'sort' | 'group' | 'fields' | null>(null);
  const toggleMenu = (m: 'filter' | 'sort' | 'group' | 'fields') =>
    setOpenMenu((cur) => (cur === m ? null : m));
  const applyView = (v: ViewSpec, i: number): void => {
    setViewMode(v.kind);
    setGroupBy(v.groupBy ?? null);
    setSort(v.sort ?? null);
    setActiveView(i);
  };
  const currentViewSpec = (): ViewSpec => ({
    kind: viewMode,
    groupBy,
    sort: sort ? { field: sort.field, desc: sort.desc ?? false } : null,
  });
  const saveCurrentView = (): void => {
    if (!onReplaceViews) {
      onSaveView?.(currentViewSpec());
      return;
    }
    if (activeView != null && table.views[activeView]) {
      const next = table.views.slice();
      next[activeView] = { ...currentViewSpec(), name: table.views[activeView].name };
      onReplaceViews(next);
    } else {
      const name = `View ${table.views.length + 1}`;
      onReplaceViews([...table.views, { ...currentViewSpec(), name }]);
      setActiveView(table.views.length);
    }
  };
  const deleteCurrentView = (): void => {
    if (!onReplaceViews || activeView == null) return;
    onReplaceViews(table.views.filter((_, i) => i !== activeView));
    setActiveView(null);
  };
  // Kanban columns by a select/checkbox field; falls back to the active group.
  const kanbanField =
    groupBy ?? table.schema.find((c) => c.type === 'select' || c.type === 'checkbox')?.key ?? null;
  const [draft, setDraft] = useState<Filter>({
    field: (table.schema.find((c) => !c.system)?.key ?? ''),
    op: 'contains',
    value: '',
  });

  // Field (schema) editor: null = closed; { col } = editing; {} = new field. The
  // editor component owns its own form state; the parent only tracks which field.
  const editsSchema = Boolean(onAddColumn && onUpdateColumn && onDeleteColumn);
  const [fieldEdit, setFieldEdit] = useState<FieldEdit>(null);

  const typeOf = (key: string): BaseCellType =>
    baseCellType(table.schema.find((c) => c.key === key)?.type ?? 'text');
  const draftOps = OPERATORS_BY_TYPE[typeOf(draft.field)] ?? ['contains', 'eq'];

  // §14 query orchestration (client engine + kernel gate with consistency
  // fallback + quick search) lives in a hook so this component stays presentational.
  const result = useTableQuery(table, { filters, conjunction, sort, groupBy, groupBy2, search }, runQuery);
  const rowHeight = density === 'compact' ? 28 : density === 'comfortable' ? 46 : 34;
  // Drag-reorder is only meaningful when the visible rows are in their natural
  // markdown order — once sorted / grouped / filtered / searched, a visible
  // index no longer maps to a canonical row, so disable it.
  const naturalOrder =
    filters.length === 0 && !sort && !groupBy && !groupBy2 && search.trim() === '';
  const groupLabel = (key: string) => table.schema.find((c) => c.key === key)?.label ?? key;
  // Fields shown to the user (system fields like the record id stay in the data
  // but never appear in pickers / cards / non-grid views).
  const visibleSchema = table.schema.filter((c) => !c.system && !hiddenFields.has(c.key));

  const addFilter = (): void => {
    if (!draft.field) return;
    setFilters((fs) => [...fs, draft]);
    setDraft({ field: draft.field, op: draft.op, value: '' });
  };

  return (
    <div>
      {editsViews && table.views.length > 0 && (
        <div className={styles.viewTabs} data-testid="view-tabs">
          {table.views.map((v, i) => (
            <button
              key={i}
              type="button"
              className={styles.viewTab}
              data-active={activeView === i}
              onClick={() => applyView(v, i)}
            >
              {v.name || v.kind}
            </button>
          ))}
          {activeView != null && (
            <button type="button" className={styles.viewTabDel} title="Delete this view" onClick={deleteCurrentView}>
              ×
            </button>
          )}
        </div>
      )}
      <div className={styles.queryBar} data-testid="smart-table-query-bar">
        <div className={styles.viewToggle}>
          {(['grid', 'kanban', 'gallery', 'calendar', 'form', 'summary', 'chart', 'timeline'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={styles.viewToggleBtn}
              data-active={viewMode === m}
              onClick={() => setViewMode(m)}
              data-testid={m === 'kanban' ? 'smart-table-kanban-toggle' : `view-${m}`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className={styles.querySpacer} />
        <input
          className={styles.querySearch}
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="smart-table-search"
        />

        {/* Filter — popover (Grist-minimal: no inline selects in the bar). */}
        <div className={styles.fieldsWrap}>
          <button
            type="button"
            className={styles.queryToggle}
            data-active={filters.length > 0}
            onClick={() => toggleMenu('filter')}
            title="Filter rows"
            data-testid="smart-table-filter"
          >
            ⚲ Filter{filters.length > 0 ? ` (${filters.length})` : ''}
          </button>
          {openMenu === 'filter' && (
            <div className={styles.fieldsMenu} data-testid="filter-menu">
              <div className={styles.menuRow}>
                <select
                  className={styles.querySelect}
                  value={draft.field}
                  onChange={(e) => {
                    const field = e.target.value;
                    const ops = OPERATORS_BY_TYPE[typeOf(field)] ?? ['contains'];
                    setDraft({ field, op: ops[0] ?? 'contains', value: '' });
                  }}
                >
                  {visibleSchema.map((c) => (
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
              </div>
              <div className={styles.menuRow}>
                <input
                  className={styles.queryInput}
                  value={draft.value}
                  placeholder={VALUE_HINT[draft.op] ?? 'value'}
                  onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && addFilter()}
                />
                <button type="button" className={styles.queryAdd} onClick={addFilter} title="Add filter">
                  + Add
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sort — popover */}
        <div className={styles.fieldsWrap}>
          <button
            type="button"
            className={styles.queryToggle}
            data-active={Boolean(sort)}
            onClick={() => toggleMenu('sort')}
            title="Sort rows"
            data-testid="smart-table-sort"
          >
            ⤓ Sort
          </button>
          {openMenu === 'sort' && (
            <div className={styles.fieldsMenu}>
              <div className={styles.menuRow}>
                <select
                  className={styles.querySelect}
                  value={sort?.field ?? ''}
                  onChange={(e) =>
                    setSort(e.target.value ? { field: e.target.value, desc: sort?.desc ?? false } : null)
                  }
                >
                  <option value="">none</option>
                  {visibleSchema.map((c) => (
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
              </div>
            </div>
          )}
        </div>

        {/* Group — popover */}
        <div className={styles.fieldsWrap}>
          <button
            type="button"
            className={styles.queryToggle}
            data-active={Boolean(groupBy)}
            onClick={() => toggleMenu('group')}
            title="Group rows"
            data-testid="smart-table-group-btn"
          >
            ⊞ Group
          </button>
          {openMenu === 'group' && (
            <div className={styles.fieldsMenu}>
              <div className={styles.menuRow}>
                <select
                  className={styles.querySelect}
                  value={groupBy ?? ''}
                  onChange={(e) => {
                    setGroupBy(e.target.value || null);
                    if (!e.target.value) setGroupBy2(null);
                  }}
                  data-testid="smart-table-group"
                >
                  <option value="">none</option>
                  {visibleSchema.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              {groupBy && (
                <div className={styles.menuRow}>
                  <select
                    className={styles.querySelect}
                    value={groupBy2 ?? ''}
                    onChange={(e) => setGroupBy2(e.target.value || null)}
                    aria-label="Second group level"
                    data-testid="smart-table-group2"
                  >
                    <option value="">then…</option>
                    {visibleSchema
                      .filter((c) => c.key !== groupBy)
                      .map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fields & layout — popover (visibility always; density/freeze grid-only) */}
        <div className={styles.fieldsWrap}>
          <button
            type="button"
            className={styles.queryToggle}
            data-active={hiddenFields.size > 0 || freezePrimary}
            onClick={() => toggleMenu('fields')}
            title="Show / hide fields, density, freeze"
            data-testid="smart-table-fields"
          >
            ⚙ Fields{hiddenFields.size > 0 ? ` (${hiddenFields.size})` : ''}
          </button>
          {openMenu === 'fields' && (
            <div className={styles.fieldsMenu} data-testid="fields-menu">
              {viewMode === 'grid' && (
                <div className={styles.menuRow}>
                  <select
                    className={styles.querySelect}
                    value={density}
                    onChange={(e) => setDensity(e.target.value as typeof density)}
                    title="Row density"
                    data-testid="smart-table-density"
                  >
                    <option value="compact">Compact</option>
                    <option value="cozy">Cozy</option>
                    <option value="comfortable">Comfortable</option>
                  </select>
                  <button
                    type="button"
                    className={styles.queryToggle}
                    data-active={freezePrimary}
                    onClick={() => setFreezePrimary((f) => !f)}
                    title="Freeze the first column"
                    data-testid="smart-table-freeze"
                  >
                    ⇥ Freeze
                  </button>
                </div>
              )}
              {table.schema
                .filter((c) => !c.system)
                .map((c) => (
                  <label key={c.key} className={styles.fieldsItem}>
                    <input
                      type="checkbox"
                      checked={!hiddenFields.has(c.key)}
                      onChange={(e) =>
                        setHiddenFields((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(c.key);
                          else next.add(c.key);
                          return next;
                        })
                      }
                    />
                    {c.label}
                  </label>
                ))}
            </div>
          )}
        </div>

        {(onSaveView || onReplaceViews) && (
          <button
            type="button"
            className={styles.queryAdd}
            onClick={saveCurrentView}
            title="Save the current view (kind / group / sort) to the table's frontmatter"
            data-testid="smart-table-save-view"
          >
            {activeView != null ? 'Update view' : 'Save view'}
          </button>
        )}

        {editsSchema && (
          <button
            type="button"
            className={styles.queryAdd}
            onClick={() => setFieldEdit({})}
            title="Add a field"
            data-testid="add-field"
          >
            + Field
          </button>
        )}

        <span className={styles.queryCount} data-testid="smart-table-count">
          {result.matchCount} / {table.rows.length}
        </span>
      </div>

      {filters.length > 0 && (
        <div className={styles.queryChips}>
          {filters.length > 1 && (
            <button
              type="button"
              className={styles.queryChip}
              onClick={() => setConjunction((c) => (c === 'and' ? 'or' : 'and'))}
              title="Toggle AND / OR across filters"
              data-testid="smart-table-conjunction"
            >
              {conjunction === 'and' ? 'ALL (and)' : 'ANY (or)'}
            </button>
          )}
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

      {editsSchema && (
        <SmartTableFieldEditor
          editing={fieldEdit}
          table={table}
          visibleSchema={visibleSchema}
          relations={relations}
          linkTargets={linkTargets}
          onAddColumn={onAddColumn}
          onUpdateColumn={onUpdateColumn}
          onDeleteColumn={onDeleteColumn}
          onRunAiColumn={onRunAiColumn}
          onClose={() => setFieldEdit(null)}
        />
      )}

      {viewMode === 'grid' && (
        <>
          {editable && onDeleteRows && selectedRows.length > 0 && (
            <div className={styles.batchBar} data-testid="batch-bar">
              <span>{selectedRows.length} selected</span>
              <button
                type="button"
                className={styles.batchDelete}
                data-testid="batch-delete"
                onClick={() => {
                  onDeleteRows(selectedRows);
                  setSelectedRows([]);
                }}
              >
                Delete {selectedRows.length}
              </button>
            </div>
          )}
          <SmartTableGrid
            schema={table.schema.filter((c) => !hiddenFields.has(c.key))}
            rows={result.rows}
            editable={editable}
            relations={relations}
            onCellChange={onCellChange}
            onExpandRow={(idx) => setExpandedRow(idx)}
            onSelectedRowsChange={editable && onDeleteRows ? setSelectedRows : undefined}
            onHeaderMenu={editsSchema ? (key) => setFieldEdit({ col: table.schema.find((c) => c.key === key) }) : undefined}
            rowHeight={rowHeight}
            freezeColumns={freezePrimary ? 1 : 0}
            onRowMove={
              editable && onMoveRow && naturalOrder
                ? (from, to) => {
                    // Canonical indices shift on reorder — drop stale selection /
                    // open card so they can't point at the wrong row.
                    setSelectedRows([]);
                    setExpandedRow(null);
                    onMoveRow(from, to);
                  }
                : undefined
            }
          />
          <div className={styles.statBar} data-testid="smart-table-stats">
            <span className={styles.statCount}>{result.rows.length} records</span>
            {visibleSchema
              .filter((c) => baseCellType(c.type) === 'number')
              .map((c) => {
                const fn = colStat[c.key] ?? 'sum';
                const nums = result.rows
                  .map((r) => Number(r[c.key]))
                  .filter((n) => !Number.isNaN(n));
                const sum = nums.reduce((a, n) => a + n, 0);
                const value =
                  fn === 'sum'
                    ? sum.toLocaleString()
                    : fn === 'avg'
                      ? nums.length
                        ? (Math.round((sum / nums.length) * 100) / 100).toLocaleString()
                        : '0'
                      : fn === 'count'
                        ? String(result.rows.filter((r) => (r[c.key] ?? '') !== '').length)
                        : fn === 'min'
                          ? nums.length
                            ? Math.min(...nums).toLocaleString()
                            : '—'
                          : nums.length
                            ? Math.max(...nums).toLocaleString()
                            : '—';
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={styles.statChip}
                    title="Click to change the aggregate"
                    onClick={() => {
                      const order = ['sum', 'avg', 'count', 'min', 'max'] as const;
                      const next = order[(order.indexOf(fn) + 1) % order.length] as typeof fn;
                      setColStat((s) => ({ ...s, [c.key]: next }));
                    }}
                  >
                    {c.label} <strong>{fn}</strong> {value}
                  </button>
                );
              })}
          </div>
        </>
      )}

      {viewMode === 'kanban' && (
        <div className={styles.kanban} data-testid="smart-table-kanban">
          {kanbanField == null ? (
            <div className={styles.kanbanEmpty}>Pick a select or checkbox field to columnize.</div>
          ) : (
            kanbanColumns(result.rows, kanbanField).map(([value, rows]) => (
              <div
                key={value || '—'}
                className={styles.kanbanCol}
                onDragOver={editable ? (e) => e.preventDefault() : undefined}
                onDrop={
                  editable
                    ? (e) => {
                        e.preventDefault();
                        const idx = e.dataTransfer.getData('text/idx');
                        if (idx !== '') onCellChange(Number(idx), kanbanField, value);
                      }
                    : undefined
                }
              >
                <div className={styles.kanbanColHead}>
                  <span>{value || '—'}</span>
                  <span className={styles.kanbanColCount}>{rows.length}</span>
                </div>
                {rows.map((row, i) => (
                  <div
                    key={i}
                    className={styles.kanbanCard}
                    draggable={editable}
                    data-draggable={editable}
                    onDragStart={editable ? (e) => e.dataTransfer.setData('text/idx', row.__idx ?? '') : undefined}
                  >
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

      {viewMode === 'gallery' && <GalleryView rows={result.rows} schema={visibleSchema} />}

      {viewMode === 'calendar' && (
        <CalendarView rows={result.rows} schema={visibleSchema} allSchema={table.schema} />
      )}

      {viewMode === 'form' && (
        <div className={styles.formView} data-testid="smart-table-form">
          {visibleSchema
            .filter((c) => c.type !== 'lookup' && c.type !== 'rollup' && c.type !== 'formula' && c.type !== 'link')
            .map((c) => (
              <div key={c.key} className={styles.formField}>
                <label className={styles.formLabel}>{c.label}</label>
                {c.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={formDraft[c.key] === 'x'}
                    onChange={(e) => setFormDraft((d) => ({ ...d, [c.key]: e.target.checked ? 'x' : '' }))}
                  />
                ) : c.type === 'select' ? (
                  <select
                    className={styles.querySelect}
                    value={formDraft[c.key] ?? ''}
                    onChange={(e) => setFormDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                  >
                    <option value="">—</option>
                    {c.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={styles.formInput}
                    type={baseCellType(c.type) === 'number' ? 'number' : baseCellType(c.type) === 'date' ? 'date' : 'text'}
                    value={formDraft[c.key] ?? ''}
                    onChange={(e) => setFormDraft((d) => ({ ...d, [c.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          <button
            type="button"
            className={styles.queryAdd}
            disabled={!onSubmitForm}
            data-testid="form-submit"
            onClick={() => {
              if (onSubmitForm) {
                onSubmitForm(formDraft);
                setFormDraft({});
              }
            }}
          >
            Add record
          </button>
        </div>
      )}

      {viewMode === 'summary' && (
        <SummaryView rows={result.rows} schema={visibleSchema} allSchema={table.schema} groupBy={groupBy} />
      )}

      {viewMode === 'chart' && <ChartView rows={result.rows} schema={visibleSchema} />}

      {viewMode === 'timeline' && (
        <TimelineView
          rows={result.rows}
          schema={visibleSchema}
          onExpandRow={(i) => setExpandedRow(Number(result.rows[i]?.__idx ?? i))}
        />
      )}

      {expandedRow != null && table.rows[expandedRow] && (
        <SmartTableRecordCard
          table={table}
          rowIndex={expandedRow}
          visibleSchema={visibleSchema}
          editable={editable}
          relations={relations}
          onCellChange={onCellChange}
          onClose={() => setExpandedRow(null)}
          onDuplicateRow={onDuplicateRow}
          onDeleteRow={onDeleteRow}
        />
      )}
    </div>
  );
};
