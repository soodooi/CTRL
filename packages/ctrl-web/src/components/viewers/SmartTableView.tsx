// SmartTableView — the presentational smart table: a §14 query bar
// (filter / sort / group, powered by lib/smart-table-query) over a TanStack
// table with per-type cell editors. Pure props in / callbacks out, so it
// renders both from a vault resource (SmartTableViewer) and from sample data
// (the table-lab dev route) and stays unit-testable.
//
// View state (filters/sort/group) is NOT data (ADR-003 §6.2): it lives in
// component state and never mutates the rows. Edits still target the canonical
// row via a preserved original index, so editing a filtered view is correct.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  AiColumnOp,
  AiColumnSummary,
  SmartTableQueryRequest,
  SmartTableQueryResult,
} from '@/lib/kernel';
import { attachCanonicalIdx, buildGateRequest } from '@/lib/smart-table-gate-bridge';
import {
  baseCellType,
  columnKeyFromLabel,
  type BaseCellType,
  type CellType,
  type ColorOp,
  type ColumnSpec,
  type SmartTable,
  type ViewSpec,
} from '@/lib/smart-table';
import { relationalDisplay } from '@/lib/smart-table-relations';
import { evalFormula } from '@/lib/smart-table-formula';
import { Cell, LinkPicker } from './SmartTableCells';
import { SmartTableGrid } from './SmartTableGrid';
import { CalendarView, GalleryView, SummaryView } from './SmartTableViews';
import { ChartView } from './SmartTableChart';
import { TimelineView } from './SmartTableTimeline';

const FIELD_TYPES: CellType[] = [
  'text',
  'multiline',
  'number',
  'currency',
  'rating',
  'progress',
  'date',
  'checkbox',
  'tags',
  'select',
  'url',
  'email',
  'phone',
  'link',
  'lookup',
  'rollup',
  'formula',
  'attachment',
  'user',
  'percent',
  'duration',
  'auto_number',
  'created_at',
  'modified_at',
];
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
  const [fieldsMenu, setFieldsMenu] = useState(false);
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

  // AI column (ADR-003 §6.5.4): which field's AI-fill panel is open + its draft.
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResult, setAiResult] = useState<AiColumnSummary | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  // Immediate AI run for a column (invoked from the field editor's "Run AI now"
  // — the glide canvas header has no room for a per-column ✦ button, so the AI
  // op/prompt live in the field editor reached via the column-header menu).
  const runAiNow = async (field: string, op: AiColumnOp, prompt: string): Promise<void> => {
    if (!onRunAiColumn || !prompt.trim()) return;
    setAiRunning(true);
    setAiError(null);
    setAiResult(null);
    try {
      setAiResult(await onRunAiColumn(field, op, prompt));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiRunning(false);
    }
  };

  // Field (schema) editor: null = closed; {key:string} = editing; {key:null} = new.
  const editsSchema = Boolean(onAddColumn && onUpdateColumn && onDeleteColumn);
  const [fieldEdit, setFieldEdit] = useState<{ key: string | null } | null>(null);
  const [feLabel, setFeLabel] = useState('');
  const [feType, setFeType] = useState<CellType>('text');
  const [feOptions, setFeOptions] = useState('');
  const [feSymbol, setFeSymbol] = useState('$');
  const [feAiOp, setFeAiOp] = useState('');
  const [feAiPrompt, setFeAiPrompt] = useState('');
  const [feAiAutoFill, setFeAiAutoFill] = useState(false);
  const [feForeignTable, setFeForeignTable] = useState('');
  const [feLinkField, setFeLinkField] = useState('');
  const [feLookupField, setFeLookupField] = useState('');
  const [feRollupFn, setFeRollupFn] = useState('count');
  const [feExpression, setFeExpression] = useState('');
  const [feColorOp, setFeColorOp] = useState('');
  const [feColorValue, setFeColorValue] = useState('');
  const [feColorBg, setFeColorBg] = useState(48);
  const openFieldEditor = (col?: ColumnSpec): void => {
    if (col) {
      setFieldEdit({ key: col.key });
      setFeLabel(col.label);
      setFeType(col.type);
      setFeOptions((col.options ?? []).join(', '));
      setFeSymbol(col.symbol ?? '$');
      setFeAiOp(col.aiOp ?? '');
      setFeAiPrompt(col.aiPrompt ?? '');
      setFeAiAutoFill(Boolean(col.aiAutoFill));
      setFeForeignTable(col.foreignTable ?? '');
      setFeLinkField(col.linkField ?? '');
      setFeLookupField(col.lookupField ?? '');
      setFeRollupFn(col.rollupFn ?? 'count');
      setFeExpression(col.expression ?? '');
      setFeColorOp(col.colorOp ?? '');
      setFeColorValue(col.colorValue ?? '');
      setFeColorBg(col.colorBg ?? 48);
    } else {
      setFieldEdit({ key: null });
      setFeLabel('');
      setFeType('text');
      setFeOptions('');
      setFeSymbol('$');
      setFeAiOp('');
      setFeAiPrompt('');
      setFeAiAutoFill(false);
      setFeForeignTable('');
      setFeLinkField('');
      setFeLookupField('');
      setFeRollupFn('count');
      setFeExpression('');
      setFeColorOp('');
      setFeColorValue('');
      setFeColorBg(48);
    }
  };
  const saveField = (): void => {
    const opts = feOptions.split(',').map((s) => s.trim()).filter(Boolean);
    const label = feLabel.trim() || 'Field';
    const patch: Partial<Omit<ColumnSpec, 'key'>> = {
      label,
      type: feType,
      options: feType === 'select' || feType === 'tags' ? (opts.length ? opts : undefined) : undefined,
      symbol: feType === 'currency' ? feSymbol : undefined,
      aiOp: feAiOp || undefined,
      aiPrompt: feAiOp && feAiPrompt.trim() ? feAiPrompt : undefined,
      aiAutoFill: feAiOp && feAiAutoFill ? true : undefined,
      foreignTable: feType === 'link' ? feForeignTable || undefined : undefined,
      linkField: feType === 'lookup' || feType === 'rollup' ? feLinkField || undefined : undefined,
      lookupField: feType === 'lookup' || feType === 'rollup' ? feLookupField || undefined : undefined,
      rollupFn: feType === 'rollup' ? feRollupFn : undefined,
      expression: feType === 'formula' ? feExpression || undefined : undefined,
      colorOp: feColorOp ? (feColorOp as ColorOp) : undefined,
      colorValue: feColorOp && feColorValue.trim() ? feColorValue : undefined,
      colorBg: feColorOp ? feColorBg : undefined,
    };
    if (fieldEdit?.key) {
      onUpdateColumn?.(fieldEdit.key, patch);
    } else {
      const key = columnKeyFromLabel(label, table.schema.map((c) => c.key));
      onAddColumn?.({ key, label, type: feType, ...patch } as ColumnSpec);
    }
    setFieldEdit(null);
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
  const clientQueried = useMemo(
    () =>
      queryTable(indexed, {
        filters,
        conjunction,
        sort: sort ? [sort] : [],
        groupBy: [groupBy, groupBy2].filter((g): g is string => Boolean(g)),
      }),
    [indexed, filters, conjunction, sort, groupBy, groupBy2],
  );
  // §14: route the same structured query through the kernel gate when the host
  // provides `runQuery`. The kernel keys on the stable record id, so we re-attach
  // each row's canonical __idx. We stamp the result with the `table` it was
  // computed from and only trust it while that ref is current — so an in-flight
  // response can never render against a since-edited table (the client result,
  // always in sync, covers the gap). Any error → client fallback (local-first).
  const [kernelResult, setKernelResult] = useState<{
    rows: Array<Record<string, string>>;
    matchCount: number;
    forTable: SmartTable;
  } | null>(null);
  useEffect(() => {
    if (!runQuery) {
      setKernelResult(null);
      return;
    }
    let live = true;
    const request = buildGateRequest(filters, conjunction, sort, [groupBy, groupBy2]);
    runQuery(request)
      .then((res) => {
        if (!live) return;
        setKernelResult({
          rows: attachCanonicalIdx(res.rows, table),
          matchCount: res.match_count,
          forTable: table,
        });
      })
      .catch(() => {
        if (live) setKernelResult(null);
      });
    return () => {
      live = false;
    };
  }, [runQuery, filters, conjunction, sort, groupBy, groupBy2, table]);
  const queried =
    runQuery && kernelResult && kernelResult.forTable === table
      ? { rows: kernelResult.rows, matchCount: kernelResult.matchCount }
      : clientQueried;
  // Quick search narrows the queried rows by a case-insensitive substring match
  // across every cell (composes on top of the structured filters). Downstream
  // views consume `result`, so search applies everywhere uniformly.
  const result = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return queried;
    return {
      ...queried,
      rows: queried.rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q))),
    };
  }, [queried, search]);
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
        <input
          className={styles.querySearch}
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="smart-table-search"
        />
        {viewMode === 'grid' && (
          <>
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
          </>
        )}
        <div className={styles.fieldsWrap}>
          <button
            type="button"
            className={styles.queryToggle}
            data-active={hiddenFields.size > 0}
            onClick={() => setFieldsMenu((m) => !m)}
            title="Show / hide fields"
            data-testid="smart-table-fields"
          >
            ⊟ Fields{hiddenFields.size > 0 ? ` (${hiddenFields.size})` : ''}
          </button>
          {fieldsMenu && (
            <div className={styles.fieldsMenu} data-testid="fields-menu">
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

        <span className={styles.queryLabel}>Group</span>
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
        {groupBy && (
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
        )}

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
            onClick={() => openFieldEditor()}
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

      {fieldEdit && editsSchema && (
        <div className={styles.aiPanel} data-testid="field-edit-panel">
          <span className={styles.aiPanelTitle}>{fieldEdit.key ? 'Edit field' : 'New field'}</span>
          <input
            className={styles.fieldName}
            value={feLabel}
            placeholder="Field name"
            autoFocus
            onChange={(e) => setFeLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && feLabel.trim()) saveField();
            }}
          />
          <select className={styles.querySelect} value={feType} onChange={(e) => setFeType(e.target.value as CellType)} aria-label="Field type">
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {(feType === 'select' || feType === 'tags') && (
            <input
              className={styles.aiPanelPrompt}
              value={feOptions}
              placeholder="options: lead, won, lost"
              onChange={(e) => setFeOptions(e.target.value)}
            />
          )}
          {feType === 'currency' && (
            <input className={styles.fieldSymbol} value={feSymbol} aria-label="Currency symbol" onChange={(e) => setFeSymbol(e.target.value)} />
          )}
          {feType === 'link' && (
            <select
              className={styles.querySelect}
              value={feForeignTable}
              onChange={(e) => setFeForeignTable(e.target.value)}
              aria-label="Link target table"
              data-testid="fe-foreign-table"
            >
              <option value="">— target table —</option>
              {linkTargets.map((t) => (
                <option key={t.path} value={t.path}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
          {(feType === 'lookup' || feType === 'rollup') && (
            <>
              <select className={styles.querySelect} value={feLinkField} onChange={(e) => setFeLinkField(e.target.value)} aria-label="Via link field">
                <option value="">— via link —</option>
                {visibleSchema.filter((c) => c.type === 'link').map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <select className={styles.querySelect} value={feLookupField} onChange={(e) => setFeLookupField(e.target.value)} aria-label="Foreign field">
                <option value="">— foreign field —</option>
                {(() => {
                  const lc = table.schema.find((c) => c.key === feLinkField);
                  const tgt = lc?.foreignTable ? relations[lc.foreignTable] : undefined;
                  return (tgt?.schema ?? []).filter((c) => !c.system).map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ));
                })()}
              </select>
              {feType === 'rollup' && (
                <select className={styles.querySelect} value={feRollupFn} onChange={(e) => setFeRollupFn(e.target.value)} aria-label="Rollup function">
                  {['count', 'sum', 'avg', 'min', 'max'].map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          {feType === 'formula' && (
            <input
              className={styles.aiPanelPrompt}
              value={feExpression}
              placeholder="Formula — e.g. {price} * {qty}  or  ROUND({score}, 1)"
              onChange={(e) => setFeExpression(e.target.value)}
              data-testid="fe-expression"
            />
          )}
          {onRunAiColumn && (
            <>
              <select
                className={styles.querySelect}
                value={feAiOp}
                onChange={(e) => setFeAiOp(e.target.value)}
                aria-label="AI op"
                data-testid="field-ai-op"
              >
                <option value="">no AI</option>
                <option value="generate">AI: generate</option>
                <option value="classify">AI: classify</option>
                <option value="extract">AI: extract</option>
                <option value="summarize">AI: summarize</option>
                <option value="translate">AI: translate</option>
              </select>
              {feAiOp && (
                <input
                  className={styles.aiPanelPrompt}
                  value={feAiPrompt}
                  placeholder="AI prompt — reference columns with {field}"
                  onChange={(e) => setFeAiPrompt(e.target.value)}
                />
              )}
              {feAiOp && (
                <label className={styles.aiPanelMsg}>
                  <input type="checkbox" checked={feAiAutoFill} onChange={(e) => setFeAiAutoFill(e.target.checked)} /> auto-fill new
                  rows
                </label>
              )}
              {feAiOp && fieldEdit.key && feAiPrompt.trim() && (
                <button
                  type="button"
                  className={styles.queryAdd}
                  disabled={aiRunning}
                  onClick={() => void runAiNow(fieldEdit.key as string, feAiOp as AiColumnOp, feAiPrompt)}
                  data-testid="ai-col-run"
                >
                  {aiRunning ? 'Running…' : '✦ Run AI now'}
                </button>
              )}
              {aiResult && (
                <span className={styles.aiPanelMsg}>
                  wrote {aiResult.rows_written}/{aiResult.rows_planned}
                  {aiResult.errors.length > 0 ? ` · ${aiResult.errors.length} failed` : ''}
                </span>
              )}
              {aiError && <span className={styles.aiPanelErr}>{aiError}</span>}
            </>
          )}
          <span className={styles.aiPanelTitle}>Conditional format</span>
          <select
            className={styles.querySelect}
            value={feColorOp}
            onChange={(e) => setFeColorOp(e.target.value)}
            data-testid="field-color-op"
          >
            <option value="">no colour rule</option>
            <option value="eq">equals</option>
            <option value="ne">not equals</option>
            <option value="contains">contains</option>
            <option value="gt">greater than</option>
            <option value="lt">less than</option>
            <option value="empty">is empty</option>
            <option value="not_empty">is not empty</option>
          </select>
          {feColorOp && feColorOp !== 'empty' && feColorOp !== 'not_empty' && (
            <input
              className={styles.aiPanelPrompt}
              value={feColorValue}
              placeholder="value to compare"
              onChange={(e) => setFeColorValue(e.target.value)}
              data-testid="field-color-value"
            />
          )}
          {feColorOp && (
            <label className={styles.aiPanelMsg}>
              colour
              <input
                type="range"
                min={0}
                max={359}
                value={feColorBg}
                onChange={(e) => setFeColorBg(Number(e.target.value))}
                data-testid="field-color-bg"
              />
              <span
                className={styles.colorSwatch}
                style={{ background: `hsl(${feColorBg} 80% 86%)` }}
              />
            </label>
          )}
          <button type="button" className={styles.queryAdd} onClick={saveField} disabled={!feLabel.trim()} data-testid="field-save">
            Save
          </button>
          {fieldEdit.key && (
            <button
              type="button"
              className={styles.queryChip}
              onClick={() => {
                onDeleteColumn?.(fieldEdit.key as string);
                setFieldEdit(null);
              }}
              data-testid="field-delete"
            >
              Delete
            </button>
          )}
          <button type="button" className={styles.queryChip} onClick={() => setFieldEdit(null)}>
            Cancel
          </button>
        </div>
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
            onHeaderMenu={editsSchema ? (key) => openFieldEditor(table.schema.find((c) => c.key === key)) : undefined}
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
        <div className={styles.recordOverlay} onClick={() => setExpandedRow(null)} data-testid="record-card">
          <div className={styles.recordCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.recordHead}>
              <span className={styles.recordTitle}>Record</span>
              <button type="button" className={styles.tableRowAction} onClick={() => setExpandedRow(null)} aria-label="Close">
                ×
              </button>
            </div>
            {visibleSchema.map((c) => (
              <div key={c.key} className={styles.recordField}>
                <span className={styles.recordLabel}>{c.label}</span>
                <span className={styles.recordValue}>
                  {c.type === 'link' ? (
                    <span data-testid={`link-picker-${c.key}`}>
                      <LinkPicker
                        value={table.rows[expandedRow]?.[c.key] ?? ''}
                        target={c.foreignTable ? relations[c.foreignTable] : undefined}
                        editable={editable}
                        onChange={(ids) => onCellChange(expandedRow, c.key, ids)}
                      />
                    </span>
                  ) : c.type === 'lookup' || c.type === 'rollup' ? (
                    <span className={styles.cellText}>
                      {relationalDisplay(table.rows[expandedRow] ?? {}, c, table.schema, relations) || '—'}
                    </span>
                  ) : c.type === 'formula' ? (
                    <span className={styles.cellText}>
                      {evalFormula(c.expression ?? '', table.rows[expandedRow] ?? {}) || '—'}
                    </span>
                  ) : (
                    <Cell
                      col={c}
                      value={table.rows[expandedRow]?.[c.key] ?? ''}
                      editable={editable}
                      onChange={(v) => onCellChange(expandedRow, c.key, v)}
                    />
                  )}
                </span>
              </div>
            ))}
            {editable && (onDuplicateRow || onDeleteRow) && (
              <div className={styles.recordActions}>
                {onDuplicateRow && (
                  <button
                    type="button"
                    className={styles.queryToggle}
                    data-testid="record-duplicate"
                    onClick={() => {
                      onDuplicateRow(expandedRow);
                      setExpandedRow(null);
                    }}
                  >
                    ⧉ Duplicate
                  </button>
                )}
                {onDeleteRow && (
                  <button
                    type="button"
                    className={styles.batchDelete}
                    data-testid="record-delete"
                    onClick={() => {
                      onDeleteRow(expandedRow);
                      setExpandedRow(null);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
