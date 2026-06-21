// SmartTableCells — the type-aware HTML cell renderer ("render is the type")
// and the link picker, extracted from SmartTableView so each stays small and
// self-contained (these are used by the record card; the grid uses its own
// canvas renderers in SmartTableGrid).

import { useState, type ReactElement } from 'react';
import { baseCellType, type ColumnSpec, type SmartTable } from '@/lib/smart-table';
import { primaryField } from '@/lib/smart-table-relations';
import styles from './Viewer.module.css';

/** Deterministic pill colour for a select/tag token. */
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

// LinkPicker — token + autocomplete relation editor (borrowed from Grist
// ReferenceListEditor.ts, Apache 2.0): shows selected rows as removable tokens,
// type to search the target table's primary field, click to add (multi-select).
interface LinkPickerProps {
  value: string;
  target: SmartTable | undefined;
  editable: boolean;
  onChange: (ids: string) => void;
}
export const LinkPicker = ({ value, target, editable, onChange }: LinkPickerProps): ReactElement => {
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
export const Cell = ({ col, value, editable, onChange }: CellProps): ReactElement => {
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
