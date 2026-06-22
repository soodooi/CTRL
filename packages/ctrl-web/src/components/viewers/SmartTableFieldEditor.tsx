// SmartTableFieldEditor — the schema (field) editor panel, extracted from
// SmartTableView. Owns its own form state; the parent only says WHICH field is
// being edited (or that a new one is being added) via `editing`, and the editor
// initializes its form from that. Handles field type config (select/currency/
// link/lookup/rollup/formula), the AI-column shortcut (+ immediate run), and the
// conditional-format colour rule. Writes back through the schema callbacks.

import { useEffect, useState, type ReactElement } from 'react';
import type { AiColumnOp, AiColumnSummary } from '@/lib/kernel';
import {
  columnKeyFromLabel,
  type CellType,
  type ColorOp,
  type ColumnSpec,
  type SmartTable,
} from '@/lib/smart-table';
import styles from './Viewer.module.css';

const FIELD_TYPES: CellType[] = [
  'text',
  'multiline',
  'number',
  'integer',
  'currency',
  'rating',
  'progress',
  'date',
  'datetime',
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

/** What the editor is open on: a column to edit, or `{}` for a brand-new field;
 *  `null` = closed. */
export type FieldEdit = { col?: ColumnSpec } | null;

interface FieldEditorProps {
  editing: FieldEdit;
  table: SmartTable;
  visibleSchema: ColumnSpec[];
  relations: Record<string, SmartTable>;
  linkTargets: Array<{ path: string; title: string }>;
  onAddColumn?: (col: ColumnSpec) => void;
  onUpdateColumn?: (key: string, patch: Partial<Omit<ColumnSpec, 'key'>>) => void;
  onDeleteColumn?: (key: string) => void;
  onRunAiColumn?: (field: string, op: AiColumnOp, prompt: string) => Promise<AiColumnSummary>;
  onClose: () => void;
}

export const SmartTableFieldEditor = ({
  editing,
  table,
  visibleSchema,
  relations,
  linkTargets,
  onAddColumn,
  onUpdateColumn,
  onDeleteColumn,
  onRunAiColumn,
  onClose,
}: FieldEditorProps): ReactElement | null => {
  const editingKey = editing?.col?.key ?? null;

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
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResult, setAiResult] = useState<AiColumnSummary | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Initialize the form whenever the editor opens on a (different) field.
  useEffect(() => {
    setAiResult(null);
    setAiError(null);
    const col = editing?.col;
    setFeLabel(col?.label ?? '');
    setFeType(col?.type ?? 'text');
    setFeOptions((col?.options ?? []).join(', '));
    setFeSymbol(col?.symbol ?? '$');
    setFeAiOp(col?.aiOp ?? '');
    setFeAiPrompt(col?.aiPrompt ?? '');
    setFeAiAutoFill(Boolean(col?.aiAutoFill));
    setFeForeignTable(col?.foreignTable ?? '');
    setFeLinkField(col?.linkField ?? '');
    setFeLookupField(col?.lookupField ?? '');
    setFeRollupFn(col?.rollupFn ?? 'count');
    setFeExpression(col?.expression ?? '');
    setFeColorOp(col?.colorOp ?? '');
    setFeColorValue(col?.colorValue ?? '');
    setFeColorBg(col?.colorBg ?? 48);
  }, [editing]);

  if (!editing) return null;

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
    if (editingKey) {
      onUpdateColumn?.(editingKey, patch);
    } else {
      const key = columnKeyFromLabel(label, table.schema.map((c) => c.key));
      onAddColumn?.({ key, label, type: feType, ...patch } as ColumnSpec);
    }
    onClose();
  };

  return (
    <div className={styles.aiPanel} data-testid="field-edit-panel">
      <span className={styles.aiPanelTitle}>{editingKey ? 'Edit field' : 'New field'}</span>
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
          {feAiOp && editingKey && feAiPrompt.trim() && (
            <button
              type="button"
              className={styles.queryAdd}
              disabled={aiRunning}
              onClick={() => void runAiNow(editingKey, feAiOp as AiColumnOp, feAiPrompt)}
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
          <span className={styles.colorSwatch} style={{ background: `hsl(${feColorBg} 80% 86%)` }} />
        </label>
      )}
      <button type="button" className={styles.queryAdd} onClick={saveField} disabled={!feLabel.trim()} data-testid="field-save">
        Save
      </button>
      {editingKey && (
        <button
          type="button"
          className={styles.queryChip}
          onClick={() => {
            onDeleteColumn?.(editingKey);
            onClose();
          }}
          data-testid="field-delete"
        >
          Delete
        </button>
      )}
      <button type="button" className={styles.queryChip} onClick={onClose}>
        Cancel
      </button>
    </div>
  );
};
