// SmartTableViewer — spreadsheet-like viewer for CSV / JSON-array /
// markdown-table resources.
//
// Why TanStack Table (v8): headless library (~14KB gzip), already in
// the workspace dependency family (Router + Query), gives us sort +
// filter + pagination + column-resizing primitives without dictating
// markup. The cell-edit UX is our own (contentEditable cells with a
// type-aware editor) so it matches CTRL design tokens.
//
// Save round-trip preserves source format:
//   - CSV → text/csv (Papa.unparse, original delimiter)
//   - JSON → JSON.stringify pretty 2-space
//   - Markdown table → padded markdown table (Obsidian-style)
//
// Bundle: own lazy chunk; CSS lives in Viewer.module.css alongside the
// other viewers so the table styles ride in only when this viewer first
// instantiates.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import {
  formatForContentType,
  inferColumnType,
  parseCsv,
  parseJson,
  parseMarkdownTable,
  serialiseCsv,
  serialiseJson,
  serialiseMarkdownTable,
  type CellValue,
  type ColumnType,
  type RowData,
  type TableData,
  type TableFormat,
} from './tableFormat';
import styles from './Viewer.module.css';

// Map source content-type to parse/serialise pair so the viewer stays
// format-agnostic for everything else.
interface FormatHandlers {
  parse: (text: string) => TableData;
  serialise: (data: TableData) => string;
}
const HANDLERS: Record<TableFormat, FormatHandlers> = {
  csv: { parse: parseCsv, serialise: serialiseCsv },
  json: { parse: parseJson, serialise: serialiseJson },
  markdown: { parse: parseMarkdownTable, serialise: serialiseMarkdownTable },
};

const detectFormat = (
  contentType: string,
  text: string | null,
): TableFormat => {
  // Explicit content-type wins
  const fromCt = formatForContentType(contentType);
  if (fromCt) return fromCt;
  // Markdown table block inside a `.md` file — sniff the first line
  if (text && text.trimStart().startsWith('|')) return 'markdown';
  return 'csv';
};

export const SmartTableViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error, writable } =
    useViewerResource(resource);

  // Parsed table state — held separately from `content` so cell edits
  // don't re-serialise on every keystroke. We re-serialise only on save
  // (or on explicit "sync source" if we ever add a split view).
  const [data, setData] = useState<TableData | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  // (Re)parse whenever the loaded content changes.
  useEffect(() => {
    if (content === null) {
      setData(null);
      setParseError(null);
      return;
    }
    try {
      const format = detectFormat(resource.contentType, content);
      const parsed = HANDLERS[format].parse(content);
      setData(parsed);
      setParseError(null);
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'parse failed');
      setData(null);
    }
  }, [content, resource.contentType]);

  // Push table edits back into the buffer (and mark dirty for save).
  const reserialise = useCallback(
    (next: TableData): void => {
      setData(next);
      const text = HANDLERS[next.format].serialise(next);
      setContent(text);
    },
    [setContent],
  );

  // Column type inference for type-aware rendering. Memoised so we don't
  // re-scan every keystroke.
  const columnTypes = useMemo(() => {
    if (!data) return new Map<string, ColumnType>();
    const map = new Map<string, ColumnType>();
    for (const col of data.columns) {
      const samples = data.rows.slice(0, 50).map((r) => r[col] ?? null);
      map.set(col, inferColumnType(samples));
    }
    return map;
  }, [data]);

  const columns = useMemo<ColumnDef<RowData>[]>(() => {
    if (!data) return [];
    return data.columns.map<ColumnDef<RowData>>((col) => ({
      accessorKey: col,
      header: col,
      cell: ({ row, getValue }) => (
        <EditableCell
          value={getValue() as CellValue}
          columnType={columnTypes.get(col) ?? 'string'}
          editable={writable}
          onCommit={(next) => {
            const newRows = data.rows.map((r, i) =>
              i === row.index ? { ...r, [col]: next } : r,
            );
            reserialise({ ...data, rows: newRows });
          }}
        />
      ),
    }));
  }, [data, columnTypes, writable, reserialise]);

  const table = useReactTable<RowData>({
    data: data?.rows ?? [],
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const addRow = useCallback(() => {
    if (!data) return;
    const blank: RowData = {};
    for (const col of data.columns) blank[col] = '';
    reserialise({ ...data, rows: [...data.rows, blank] });
  }, [data, reserialise]);

  const addColumn = useCallback(() => {
    if (!data) return;
    const name = window.prompt('New column name')?.trim();
    if (!name || data.columns.includes(name)) return;
    const newCols = [...data.columns, name];
    const newRows = data.rows.map((r) => ({ ...r, [name]: '' }));
    reserialise({ ...data, columns: newCols, rows: newRows });
  }, [data, reserialise]);

  return (
    <div className={styles.frame}>
      <ViewerChrome
        resource={resource}
        dirty={dirty}
        saving={saving}
        error={error}
        writable={writable}
        onSave={save}
      />
      <div className={styles.tableWrap}>
        {content === null && !error ? (
          <pre className={styles.markdownStub}>loading…</pre>
        ) : error && content === null ? (
          <pre className={styles.markdownStub} role="alert">
            {error}
          </pre>
        ) : parseError ? (
          <pre className={styles.markdownStub} role="alert">
            parse error: {parseError}
          </pre>
        ) : data === null ? (
          <pre className={styles.markdownStub}>parsing…</pre>
        ) : (
          <>
            <div className={styles.tableToolbar}>
              <input
                className={styles.tableFilter}
                placeholder="filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {writable && (
                <>
                  <button
                    className={styles.tableButton}
                    onClick={addRow}
                    type="button"
                  >
                    + row
                  </button>
                  <button
                    className={styles.tableButton}
                    onClick={addColumn}
                    type="button"
                  >
                    + col
                  </button>
                </>
              )}
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.dataTable}>
                <thead>
                  {table.getHeaderGroups().map((group) => (
                    <tr key={group.id}>
                      {group.headers.map((header) => {
                        const sortDir = header.column.getIsSorted();
                        return (
                          <th
                            key={header.id}
                            data-sorted={sortDir || undefined}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.tableStatus}>
              <span>format: {data.format}</span>
              <span>
                {table.getFilteredRowModel().rows.length} / {data.rows.length} rows
              </span>
              <span>{data.columns.length} cols</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ───── EditableCell ──────────────────────────────────────────────────────

interface EditableCellProps {
  value: CellValue;
  columnType: ColumnType;
  editable: boolean;
  onCommit: (next: CellValue) => void;
}

const EditableCell = ({
  value,
  columnType,
  editable,
  onCommit,
}: EditableCellProps): ReactElement => {
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value));
  const lastValueRef = useRef<string>(value == null ? '' : String(value));

  // Sync external changes (e.g. row delete shifting indices) without
  // wiping a half-typed edit.
  useEffect(() => {
    const incoming = value == null ? '' : String(value);
    if (incoming !== lastValueRef.current && incoming !== draft) {
      setDraft(incoming);
      lastValueRef.current = incoming;
    }
  }, [value, draft]);

  const commit = useCallback((): void => {
    if (draft === lastValueRef.current) return;
    lastValueRef.current = draft;
    onCommit(coerce(draft, columnType));
  }, [draft, columnType, onCommit]);

  if (!editable) {
    return (
      <span className={cellClassForType(columnType)}>
        {renderReadOnly(value, columnType)}
      </span>
    );
  }

  if (columnType === 'boolean') {
    const checked = draft === 'true';
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          const next = String(e.target.checked);
          setDraft(next);
          lastValueRef.current = next;
          onCommit(e.target.checked);
        }}
      />
    );
  }

  return (
    <input
      className={`${styles.cellEditor} ${cellClassForType(columnType)}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(lastValueRef.current);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      inputMode={
        columnType === 'number'
          ? 'decimal'
          : columnType === 'date'
            ? 'numeric'
            : undefined
      }
    />
  );
};

const cellClassForType = (type: ColumnType): string => {
  if (type === 'number') return styles.cellTypeNum ?? '';
  if (type === 'boolean') return styles.cellTypeBool ?? '';
  if (type === 'link') return styles.cellTypeLink ?? '';
  return '';
};

const coerce = (input: string, type: ColumnType): CellValue => {
  if (input === '') return '';
  if (type === 'number') {
    const n = Number(input);
    return Number.isFinite(n) ? n : input;
  }
  if (type === 'boolean') return input === 'true';
  return input;
};

const renderReadOnly = (value: CellValue, type: ColumnType): ReactElement | string => {
  if (value == null || value === '') return '';
  const text = String(value);
  if (type === 'link') {
    return (
      <a href={text} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    );
  }
  if (type === 'boolean') {
    return value === true || value === 'true' ? '✓' : '–';
  }
  return text;
};
