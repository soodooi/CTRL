// SmartTableGrid — the grid view rendered on glide-data-grid (MIT, canvas),
// the Excel-class network so the smart table feels like Feishu Bitable /
// Airtable: keyboard navigation, range select, copy/paste, fill, resizable
// columns, and millions-of-rows virtual scroll — none of which the old HTML
// table had (ADR-002 §14 v30 — bao picked glide-data-grid).
//
// Controlled + pull-based: the grid never holds data; getCellContent reads by
// [col,row] from the already-queried rows (each carries its canonical __idx so
// edits target the right underlying row even under filter/sort). Writes flow
// back through onCellChange — same contract the HTML cells used, so the kernel
// / vault round-trip is unchanged ("local is truth").

import {
  DataEditor,
  GridCellKind,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type Item,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { baseCellType, type ColumnSpec } from '@/lib/smart-table';
import styles from './Viewer.module.css';

interface SmartTableGridProps {
  schema: ColumnSpec[];
  /** Already-queried rows; each carries `__idx` = canonical row index. */
  rows: Array<Record<string, string>>;
  editable: boolean;
  onCellChange: (rowIndex: number, key: string, value: string) => void;
  /** Open the record detail card for a canonical row index. */
  onExpandRow?: (rowIndex: number) => void;
  /** Column-header menu (Airtable/Feishu style — the glide canvas header can't
   *  hold React buttons): open the field editor for this field key. */
  onHeaderMenu?: (fieldKey: string) => void;
}

const canonicalIdx = (row: Record<string, string> | undefined, fallback: number): number =>
  row && row.__idx !== undefined ? Number(row.__idx) : fallback;

export const SmartTableGrid = ({
  schema,
  rows,
  editable,
  onCellChange,
  onExpandRow,
  onHeaderMenu,
}: SmartTableGridProps): ReactElement => {
  const [widths, setWidths] = useState<Record<string, number>>({});

  // glide renders its edit overlay into a #portal element; create it once.
  useEffect(() => {
    if (!document.getElementById('portal')) {
      const el = document.createElement('div');
      el.id = 'portal';
      el.style.cssText = 'position:fixed;left:0;top:0;z-index:9999';
      document.body.appendChild(el);
    }
  }, []);

  const columns = useMemo<GridColumn[]>(
    () =>
      schema.map((c) => ({
        title: c.label,
        id: c.key,
        width: widths[c.key] ?? 160,
        hasMenu: Boolean(onHeaderMenu),
      })),
    [schema, widths, onHeaderMenu],
  );

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      const spec = schema[col];
      if (!spec) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      const value = rows[row]?.[spec.key] ?? '';
      const ro = !editable;
      if (spec.type === 'checkbox') {
        return {
          kind: GridCellKind.Boolean,
          data: value === 'x' || value === 'true',
          allowOverlay: false,
          readonly: ro,
        };
      }
      if (spec.type === 'tags') {
        // Bubble has no built-in overlay editor; show chips here, edit via the
        // record detail card.
        return {
          kind: GridCellKind.Bubble,
          data: value.split(',').map((t) => t.trim()).filter(Boolean),
          allowOverlay: false,
        };
      }
      if (spec.type === 'url' || spec.type === 'email' || spec.type === 'phone') {
        return { kind: GridCellKind.Uri, data: value, allowOverlay: editable, readonly: ro };
      }
      if (baseCellType(spec.type) === 'number') {
        const n = value === '' ? undefined : Number(value);
        const num = typeof n === 'number' && !Number.isNaN(n) ? n : undefined;
        // Lightweight "render is the type" via displayData (no custom canvas
        // cell yet): currency $-formatted, rating as stars, progress as %.
        let display = value;
        if (num !== undefined) {
          if (spec.type === 'currency') display = `${spec.symbol ?? '$'}${num.toLocaleString()}`;
          else if (spec.type === 'rating') display = '★'.repeat(Math.max(0, Math.min(spec.max ?? 5, Math.round(num))));
          else if (spec.type === 'progress') display = `${Math.round(num * (100 / (spec.max ?? 100)))}%`;
        }
        return {
          kind: GridCellKind.Number,
          data: num,
          displayData: display,
          allowOverlay: editable,
          readonly: ro,
        };
      }
      return { kind: GridCellKind.Text, data: value, displayData: value, allowOverlay: editable, readonly: ro };
    },
    [schema, rows, editable],
  );

  const onCellEdited = useCallback(
    (cell: Item, newVal: EditableGridCell): void => {
      const [col, row] = cell;
      const spec = schema[col];
      if (!spec) return;
      const idx = canonicalIdx(rows[row], row);
      let v = '';
      if (newVal.kind === GridCellKind.Boolean) v = newVal.data ? 'x' : '';
      else if (newVal.kind === GridCellKind.Number)
        v = newVal.data === undefined || newVal.data === null ? '' : String(newVal.data);
      else if (newVal.kind === GridCellKind.Uri || newVal.kind === GridCellKind.Text)
        v = newVal.data ?? '';
      onCellChange(idx, spec.key, v);
    },
    [schema, rows, onCellChange],
  );

  return (
    <div className={styles.glideWrap} data-testid="smart-table-glide">
      <DataEditor
        columns={columns}
        rows={rows.length}
        getCellContent={getCellContent}
        onCellEdited={editable ? onCellEdited : undefined}
        onColumnResize={(c, w) => setWidths((p) => ({ ...p, [String(c.id)]: w }))}
        onHeaderMenuClick={onHeaderMenu ? (col) => onHeaderMenu(String(columns[col]?.id)) : undefined}
        getCellsForSelection
        rowMarkers={onExpandRow ? 'both' : 'number'}
        onRowMoved={undefined}
        smoothScrollX
        smoothScrollY
        fillHandle={editable}
        keybindings={{ search: true }}
        width="100%"
        height="100%"
        onCellActivated={(cell) => {
          // Activating the leftmost marker area is handled by rowMarkers; expose
          // a row-open affordance via double-activation on the first column.
          if (onExpandRow && cell[0] === 0) onExpandRow(canonicalIdx(rows[cell[1]], cell[1]));
        }}
      />
    </div>
  );
};
