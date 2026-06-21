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
  type CustomCell,
  type CustomRenderer,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type Item,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { baseCellType, type ColumnSpec, type SmartTable } from '@/lib/smart-table';
import { relationalDisplay } from '@/lib/smart-table-relations';
import { evalFormula } from '@/lib/smart-table-formula';
import styles from './Viewer.module.css';

// Deterministic pill colour (matches the HTML cells' pillStyle).
const tokenHue = (token: string): number => {
  let h = 0;
  for (let i = 0; i < token.length; i += 1) h = (h * 31 + token.charCodeAt(i)) % 360;
  return h;
};

// Custom canvas cell: coloured pills for select / tags — the Feishu-style chip
// the built-in glide cells don't give (Bubble has no per-tag colour). Display
// only; editing happens in the field editor / record card.
interface PillData {
  readonly kind: 'pill-cell';
  readonly tags: readonly string[];
}
type PillCell = CustomCell<PillData>;

const pillRenderer: CustomRenderer<PillCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is PillCell => (c.data as Partial<PillData>)?.kind === 'pill-cell',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const padX = theme.cellHorizontalPadding;
    const chipH = 20;
    const chipY = rect.y + (rect.height - chipH) / 2;
    let x = rect.x + padX;
    ctx.save();
    ctx.font = `12px ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    for (const tag of cell.data.tags) {
      if (!tag) continue;
      const w = ctx.measureText(tag).width + 14;
      if (x + w > rect.x + rect.width - padX) break;
      const hue = tokenHue(tag);
      const r = chipH / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, chipY);
      ctx.arcTo(x + w, chipY, x + w, chipY + chipH, r);
      ctx.arcTo(x + w, chipY + chipH, x, chipY + chipH, r);
      ctx.arcTo(x, chipY + chipH, x, chipY, r);
      ctx.arcTo(x, chipY, x + w, chipY, r);
      ctx.closePath();
      ctx.fillStyle = `hsl(${hue} 70% 90%)`;
      ctx.fill();
      ctx.fillStyle = `hsl(${hue} 55% 32%)`;
      ctx.fillText(tag, x + 7, chipY + chipH / 2 + 1);
      x += w + 4;
    }
    ctx.restore();
    return true;
  },
};

interface SmartTableGridProps {
  schema: ColumnSpec[];
  /** Already-queried rows; each carries `__idx` = canonical row index. */
  rows: Array<Record<string, string>>;
  editable: boolean;
  /** Loaded target tables for link / Lookup / Rollup display resolution. */
  relations?: Record<string, SmartTable>;
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
  relations = {},
  onCellChange,
  onExpandRow,
  onHeaderMenu,
}: SmartTableGridProps): ReactElement => {
  const [widths, setWidths] = useState<Record<string, number>>({});
  // Hide system columns (record id, …) from the grid — col indices below are
  // into this visible list, so getCellContent/onCellEdited use it too.
  const cols = useMemo(() => schema.filter((c) => !c.system), [schema]);

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
      cols.map((c) => ({
        title: c.label,
        id: c.key,
        width: widths[c.key] ?? 160,
        hasMenu: Boolean(onHeaderMenu),
      })),
    [cols, widths, onHeaderMenu],
  );

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      const spec = cols[col];
      if (!spec) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false };
      const value = rows[row]?.[spec.key] ?? '';
      const ro = !editable;
      if (spec.type === 'link' || spec.type === 'lookup' || spec.type === 'rollup') {
        // Relational display is derived from the linked table(s), not the raw
        // cell (which holds target ids). Read-only here; edit links in the card.
        const disp = relationalDisplay(rows[row] ?? {}, spec, schema, relations) ?? value;
        return { kind: GridCellKind.Text, data: disp, displayData: disp, allowOverlay: false };
      }
      if (spec.type === 'formula') {
        const disp = evalFormula(spec.expression ?? '', rows[row] ?? {});
        return { kind: GridCellKind.Text, data: disp, displayData: disp, allowOverlay: false };
      }
      if (spec.type === 'checkbox') {
        return {
          kind: GridCellKind.Boolean,
          data: value === 'x' || value === 'true',
          allowOverlay: false,
          readonly: ro,
        };
      }
      if (spec.type === 'tags' || spec.type === 'select') {
        const tags =
          spec.type === 'tags'
            ? value.split(',').map((t) => t.trim()).filter(Boolean)
            : value
              ? [value]
              : [];
        return {
          kind: GridCellKind.Custom,
          data: { kind: 'pill-cell', tags },
          copyData: value,
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
    [cols, schema, rows, editable, relations],
  );

  const onCellEdited = useCallback(
    (cell: Item, newVal: EditableGridCell): void => {
      const [col, row] = cell;
      const spec = cols[col];
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
    [cols, rows, onCellChange],
  );

  return (
    <div className={styles.glideWrap} data-testid="smart-table-glide">
      <DataEditor
        columns={columns}
        rows={rows.length}
        getCellContent={getCellContent}
        onCellEdited={editable ? onCellEdited : undefined}
        customRenderers={[pillRenderer]}
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
