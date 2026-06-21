// SmartTableView — the presentational smart table: a §14 query bar
// (filter / sort / group, powered by lib/smart-table-query) over a TanStack
// table with per-type cell editors. Pure props in / callbacks out, so it
// renders both from a vault resource (SmartTableViewer) and from sample data
// (the table-lab dev route) and stays unit-testable.
//
// View state (filters/sort/group) is NOT data (ADR-003 §6.2): it lives in
// component state and never mutates the rows. Edits still target the canonical
// row via a preserved original index, so editing a filtered view is correct.

import { useMemo, useState, type ReactElement } from 'react';
import type { AiColumnOp, AiColumnSummary } from '@/lib/kernel';
import {
  baseCellType,
  columnKeyFromLabel,
  type BaseCellType,
  type CellType,
  type ColumnSpec,
  type SmartTable,
  type ViewSpec,
} from '@/lib/smart-table';
import { primaryField, relationalDisplay } from '@/lib/smart-table-relations';
import { evalFormula } from '@/lib/smart-table-formula';
import { SmartTableGrid } from './SmartTableGrid';

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

// LinkPicker — token + autocomplete relation editor (borrowed from Grist
// ReferenceListEditor.ts, Apache 2.0): shows selected rows as removable tokens,
// type to search the target table's primary field, click to add (multi-select).
interface LinkPickerProps {
  value: string;
  target: SmartTable | undefined;
  editable: boolean;
  onChange: (ids: string) => void;
}
const LinkPicker = ({ value, target, editable, onChange }: LinkPickerProps): ReactElement => {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const pf = target ? primaryField(target) : 'id';
  const rows = target?.rows ?? [];
  const selectedIds = value.split(',').map((s) => s.trim()).filter(Boolean);
  const label = (id: string): string => rows.find((r) => r.id === id)?.[pf] ?? id;
  const matches = rows
    .filter((r) => !selectedIds.includes(r.id ?? '') && (r[pf] ?? '').toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8);
  return (
    <div className={styles.linkPicker}>
      <div className={styles.linkTokens}>
        {selectedIds.map((id) => (
          <span key={id} className={styles.linkToken}>
            {label(id)}
            {editable && (
              <button type="button" onClick={() => onChange(selectedIds.filter((x) => x !== id).join(', '))}>
                ×
              </button>
            )}
          </span>
        ))}
        {editable && (
          <input
            className={styles.linkInput}
            value={search}
            placeholder={selectedIds.length ? '' : 'link a record…'}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
        )}
      </div>
      {editable && open && matches.length > 0 && (
        <div className={styles.linkSuggest} data-testid="link-suggest">
          {matches.map((r) => (
            <button
              key={r.id ?? ''}
              type="button"
              className={styles.linkSuggestItem}
              onMouseDown={() => {
                onChange([...selectedIds, r.id ?? ''].join(', '));
                setSearch('');
              }}
            >
              {r[pf] || r.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

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
  /** Batch-delete the given canonical row indices (checkbox selection). */
  onDeleteRows?: (rowIndexes: number[]) => void;
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
  onSaveView,
  onRunAiColumn,
  onAddColumn,
  onUpdateColumn,
  onDeleteColumn,
  onReplaceViews,
  onSubmitForm,
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
    'grid' | 'kanban' | 'gallery' | 'calendar' | 'form' | 'summary'
  >(savedView?.kind ?? 'grid');
  const [formDraft, setFormDraft] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<number | null>(savedView ? 0 : null);
  const editsViews = Boolean(onReplaceViews);
  // Record detail card (ADR-003 §6 D6): canonical row index, or null = closed.
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
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
  const result = useMemo(
    () =>
      queryTable(indexed, {
        filters,
        conjunction,
        sort: sort ? [sort] : [],
        groupBy: [groupBy, groupBy2].filter((g): g is string => Boolean(g)),
      }),
    [indexed, filters, conjunction, sort, groupBy, groupBy2],
  );
  const groupLabel = (key: string) => table.schema.find((c) => c.key === key)?.label ?? key;
  // Fields shown to the user (system fields like the record id stay in the data
  // but never appear in pickers / cards / non-grid views).
  const visibleSchema = table.schema.filter((c) => !c.system);

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
          {(['grid', 'kanban', 'gallery', 'calendar', 'form', 'summary'] as const).map((m) => (
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
            schema={table.schema}
            rows={result.rows}
            editable={editable}
            relations={relations}
            onCellChange={onCellChange}
            onExpandRow={(idx) => setExpandedRow(idx)}
            onSelectedRowsChange={editable && onDeleteRows ? setSelectedRows : undefined}
            onHeaderMenu={editsSchema ? (key) => openFieldEditor(table.schema.find((c) => c.key === key)) : undefined}
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

      {viewMode === 'gallery' && (
        <div className={styles.gallery} data-testid="smart-table-gallery">
          {result.rows.map((row, i) => (
            <div key={i} className={styles.kanbanCard}>
              {visibleSchema.map((c) => (
                <div key={c.key} className={styles.kanbanCardRow}>
                  <span className={styles.kanbanCardLabel}>{c.label}</span>
                  <span className={styles.kanbanCardValue}>{row[c.key] || '—'}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {viewMode === 'calendar' &&
        (() => {
          const dateField = table.schema.find((c) => baseCellType(c.type) === 'date')?.key;
          if (!dateField) {
            return <div className={styles.kanbanEmpty}>Add a date field to use the calendar.</div>;
          }
          const titleKey = visibleSchema.find((c) => c.key !== dateField)?.key;
          const groups = new Map<string, Array<Record<string, string>>>();
          for (const row of [...result.rows].sort((a, b) =>
            (a[dateField] ?? '').localeCompare(b[dateField] ?? ''),
          )) {
            const d = row[dateField] || '(no date)';
            const bucket = groups.get(d);
            if (bucket) bucket.push(row);
            else groups.set(d, [row]);
          }
          return (
            <div className={styles.scroll} data-testid="smart-table-calendar">
              {[...groups.entries()].map(([d, rows]) => (
                <div key={d} className={styles.calGroup}>
                  <div className={styles.calDate}>{d}</div>
                  {rows.map((row, i) => (
                    <div key={i} className={styles.calItem}>
                      {titleKey ? row[titleKey] || '—' : '—'}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })()}

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

      {viewMode === 'summary' &&
        (() => {
          const groupField = groupBy ?? visibleSchema.find((c) => c.type === 'select' || c.type === 'checkbox')?.key;
          if (!groupField) {
            return <div className={styles.kanbanEmpty}>Group by a field (or add a select column) to summarize.</div>;
          }
          const numCols = visibleSchema.filter((c) => baseCellType(c.type) === 'number');
          const groups = new Map<string, Array<Record<string, string>>>();
          for (const row of result.rows) {
            const g = row[groupField] ?? '';
            const bucket = groups.get(g);
            if (bucket) bucket.push(row);
            else groups.set(g, [row]);
          }
          const sumCol = (rs: Array<Record<string, string>>, key: string): number =>
            rs.reduce((a, r) => a + (Number(r[key]) || 0), 0);
          return (
            <div className={styles.scroll} data-testid="smart-table-summary">
              <table className={styles.summaryTable}>
                <thead>
                  <tr>
                    <th>{groupLabel(groupField)}</th>
                    <th>Count</th>
                    {numCols.map((c) => (
                      <th key={c.key}>{c.label} Σ</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...groups.entries()].map(([g, rs]) => (
                    <tr key={g}>
                      <td>{g || '—'}</td>
                      <td>{rs.length}</td>
                      {numCols.map((c) => (
                        <td key={c.key}>{sumCol(rs, c.key).toLocaleString()}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

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
          </div>
        </div>
      )}
    </div>
  );
};
