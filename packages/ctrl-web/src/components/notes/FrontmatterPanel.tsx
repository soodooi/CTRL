// FrontmatterPanel — collapsible YAML frontmatter editor above the
// markdown body. Edits a note's frontmatter as a flat list of
// key/value rows (scalar values + comma-separated arrays); commits
// back via `vault_write` while preserving the body verbatim.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-02 — kairo feature
// parity batch.)

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { vaultRead, vaultWrite } from '@/lib/kernel';
import styles from './Notes.module.css';

interface FrontmatterPanelProps {
  path: string;
}

type RowValue = string | number | boolean | string[];

interface Row {
  key: string;
  value: RowValue;
}

const isArrayValue = (v: unknown): v is unknown[] => Array.isArray(v);

const valueToInput = (v: RowValue): string => {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  return v;
};

const inputToValue = (input: string, current: RowValue): RowValue => {
  // Preserve the existing type when possible. Arrays detected via the
  // current value or by the presence of commas.
  if (Array.isArray(current) || input.includes(',')) {
    return input
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (typeof current === 'boolean' || input === 'true' || input === 'false') {
    return input === 'true';
  }
  const n = Number(input);
  if (typeof current === 'number' && !Number.isNaN(n)) return n;
  return input;
};

const rowsFromFrontmatter = (fm: Record<string, unknown>): Row[] => {
  const out: Row[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out.push({ key: k, value: v });
    } else if (isArrayValue(v) && v.every((x) => typeof x === 'string')) {
      out.push({ key: k, value: v as string[] });
    } else {
      // Unsupported nested shape — surface as a JSON-ish string so the
      // user still sees it.
      out.push({ key: k, value: JSON.stringify(v) });
    }
  }
  return out;
};

const frontmatterFromRows = (rows: Row[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (!r.key.trim()) continue;
    out[r.key] = r.value;
  }
  return out;
};

export const FrontmatterPanel = ({ path }: FrontmatterPanelProps): ReactElement => {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const entry = await vaultRead(path);
      setBody(typeof entry.body === 'string' ? entry.body : '');
      const fm = (entry.frontmatter ?? {}) as Record<string, unknown>;
      setRows(rowsFromFrontmatter(fm));
      setDirty(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('frontmatter load failed', err);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleKeyChange = useCallback((idx: number, key: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, key } : r)));
    setDirty(true);
  }, []);

  const handleValueChange = useCallback((idx: number, input: string) => {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, value: inputToValue(input, r.value) } : r)),
    );
    setDirty(true);
  }, []);

  const handleDelete = useCallback((idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setDirty(true);
  }, []);

  const handleAdd = useCallback(() => {
    setRows((prev) => [...prev, { key: '', value: '' }]);
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const fm = frontmatterFromRows(rows);
      await vaultWrite({ path, content: body, frontmatter: fm });
      setDirty(false);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('frontmatter save failed', err);
    } finally {
      setSaving(false);
    }
  }, [body, path, rows]);

  const visibleRows = useMemo(() => rows, [rows]);

  return (
    <section className={styles.fmPanel} aria-label="Frontmatter">
      <header className={styles.fmHeader}>
        <button
          type="button"
          className={styles.fmToggle}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className={styles.fmChevron}>{open ? '▾' : '▸'}</span>
          <span className={styles.fmLabel}>Frontmatter</span>
          {dirty ? <span className={styles.fmDirty}>•</span> : null}
        </button>
        {open ? (
          <div className={styles.fmHeaderActions}>
            <button type="button" className={styles.fmAdd} onClick={handleAdd}>
              + Field
            </button>
            <button
              type="button"
              className={styles.fmSave}
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : null}
      </header>
      {open ? (
        <div className={styles.fmRows}>
          {visibleRows.length === 0 ? (
            <p className={styles.fmEmpty}>No frontmatter. Click + Field to add one.</p>
          ) : (
            visibleRows.map((row, idx) => (
              <div className={styles.fmRow} key={`${idx}-${row.key}`}>
                <input
                  className={styles.fmKey}
                  type="text"
                  value={row.key}
                  placeholder="key"
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    handleKeyChange(idx, e.target.value)
                  }
                />
                <input
                  className={styles.fmValue}
                  type="text"
                  value={valueToInput(row.value)}
                  placeholder={Array.isArray(row.value) ? 'tag1, tag2' : 'value'}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    handleValueChange(idx, e.target.value)
                  }
                />
                <button
                  type="button"
                  className={styles.fmDel}
                  onClick={() => handleDelete(idx)}
                  title="Delete field"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
};
