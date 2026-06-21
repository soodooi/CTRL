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
  CompactSelection,
  DataEditor,
  GridCellKind,
  GridColumnIcon,
  type CustomCell,
  type CustomRenderer,
  type EditableGridCell,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { baseCellType, type CellType, type ColumnSpec, type SmartTable } from '@/lib/smart-table';

// Field-type header icon (Feishu/Airtable style — glide ships the sprites).
const iconFor = (t: CellType): GridColumnIcon => {
  switch (t) {
    case 'number':
    case 'currency':
    case 'progress':
    case 'percent':
    case 'duration':
      return GridColumnIcon.HeaderNumber;
    case 'attachment':
      return GridColumnIcon.HeaderImage;
    case 'user':
      return GridColumnIcon.HeaderSingleValue;
    case 'rating':
      return GridColumnIcon.HeaderEmoji;
    case 'date':
    case 'created_at':
    case 'modified_at':
      return GridColumnIcon.HeaderDate;
    case 'auto_number':
      return GridColumnIcon.HeaderRowID;
    case 'checkbox':
      return GridColumnIcon.HeaderBoolean;
    case 'select':
      return GridColumnIcon.HeaderSingleValue;
    case 'tags':
      return GridColumnIcon.HeaderArray;
    case 'url':
      return GridColumnIcon.HeaderUri;
    case 'email':
      return GridColumnIcon.HeaderEmail;
    case 'phone':
      return GridColumnIcon.HeaderPhone;
    case 'link':
      return GridColumnIcon.HeaderReference;
    case 'lookup':
      return GridColumnIcon.HeaderLookup;
    case 'rollup':
      return GridColumnIcon.HeaderRollup;
    case 'formula':
      return GridColumnIcon.HeaderMath;
    case 'multiline':
      return GridColumnIcon.HeaderMarkdown;
    default:
      return GridColumnIcon.HeaderString;
  }
};
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

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// Interactive star rating cell (click a star to set the value).
interface StarData {
  readonly kind: 'star-cell';
  readonly rating: number;
  readonly max: number;
}
type StarCell = CustomCell<StarData>;
const STAR_SIZE = 17;
const starRenderer: CustomRenderer<StarCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is StarCell => (c.data as Partial<StarData>)?.kind === 'star-cell',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const { rating, max } = cell.data;
    ctx.save();
    ctx.font = `16px ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    let x = rect.x + theme.cellHorizontalPadding;
    const y = rect.y + rect.height / 2;
    for (let i = 0; i < max; i += 1) {
      ctx.fillStyle = i < rating ? '#f5a623' : '#d8d8d8';
      ctx.fillText('★', x, y);
      x += STAR_SIZE;
    }
    ctx.restore();
    return true;
  },
  onClick: (args) => {
    const i = Math.floor((args.posX - 8) / STAR_SIZE);
    const rating = Math.max(0, Math.min(args.cell.data.max, i + 1));
    return { ...args.cell, data: { ...args.cell.data, rating } };
  },
};

// Interactive progress bar cell (click along the bar to set the value).
interface RangeData {
  readonly kind: 'range-cell';
  readonly value: number;
  readonly max: number;
}
type RangeCell = CustomCell<RangeData>;
const rangeRenderer: CustomRenderer<RangeCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is RangeCell => (c.data as Partial<RangeData>)?.kind === 'range-cell',
  draw: (args, cell) => {
    const { ctx, rect, theme } = args;
    const pct = Math.max(0, Math.min(1, cell.data.value / (cell.data.max || 100)));
    const pad = theme.cellHorizontalPadding;
    const barH = 6;
    const barW = Math.max(20, rect.width - pad * 2 - 40);
    const barX = rect.x + pad;
    const barY = rect.y + rect.height / 2 - barH / 2;
    ctx.save();
    ctx.fillStyle = '#e5e5e5';
    roundRect(ctx, barX, barY, barW, barH, 3);
    ctx.fill();
    ctx.fillStyle = '#6aa3ff';
    roundRect(ctx, barX, barY, barW * pct, barH, 3);
    ctx.fill();
    ctx.fillStyle = theme.textDark;
    ctx.font = `11px ${theme.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(pct * 100)}%`, barX + barW + 6, rect.y + rect.height / 2);
    ctx.restore();
    return true;
  },
  onClick: (args) => {
    const pad = 8;
    const barW = Math.max(20, args.bounds.width - pad * 2 - 40);
    const pct = Math.max(0, Math.min(1, (args.posX - pad) / barW));
    return { ...args.cell, data: { ...args.cell.data, value: Math.round(pct * (args.cell.data.max || 100)) } };
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
  /** Checkbox row selection → canonical row indices (for batch actions). */
  onSelectedRowsChange?: (canonicalIdxs: number[]) => void;
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
  onSelectedRowsChange,
}: SmartTableGridProps): ReactElement => {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [gridSelection, setGridSelection] = useState<GridSelection>({
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty(),
  });
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

  // Column 0 is a narrow expand-record affordance (Airtable-style ⤢ at the row
  // head) — glide's canvas header can't host a React button, and onCellActivated
  // collides with editing, so a dedicated read-only column is the clean way back.
  const expandable = Boolean(onExpandRow);
  const columns = useMemo<GridColumn[]>(
    () => [
      ...(expandable ? [{ title: '', id: '__expand', width: 36 } as GridColumn] : []),
      ...cols.map((c) => ({
        title: c.label,
        id: c.key,
        width: widths[c.key] ?? 160,
        icon: iconFor(c.type),
        hasMenu: Boolean(onHeaderMenu),
      })),
    ],
    [cols, widths, onHeaderMenu, expandable],
  );
  // Map a grid column index to the data column (offset by the expand column).
  const dataCol = (col: number): ColumnSpec | undefined => cols[expandable ? col - 1 : col];

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell;
      if (expandable && col === 0) {
        return { kind: GridCellKind.Text, data: '⤢', displayData: '⤢', allowOverlay: false };
      }
      const spec = dataCol(col);
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
      if (spec.type === 'auto_number') {
        const n = Number(rows[row]?.__idx ?? row) + 1;
        return { kind: GridCellKind.Number, data: n, displayData: String(n), allowOverlay: false };
      }
      if (spec.type === 'created_at' || spec.type === 'modified_at') {
        return { kind: GridCellKind.Text, data: value, displayData: value, allowOverlay: false };
      }
      if (spec.type === 'checkbox') {
        return {
          kind: GridCellKind.Boolean,
          data: value === 'x' || value === 'true',
          allowOverlay: false,
          readonly: ro,
        };
      }
      if (spec.type === 'attachment') {
        const names = value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => s.split('/').pop() ?? s)
          .join(', ');
        return {
          kind: GridCellKind.Text,
          data: value,
          displayData: value ? `📎 ${names}` : '',
          allowOverlay: editable,
          readonly: ro,
        };
      }
      if (spec.type === 'tags' || spec.type === 'select' || spec.type === 'user') {
        const tags =
          spec.type === 'select'
            ? value
              ? [value]
              : []
            : value.split(',').map((t) => t.trim()).filter(Boolean);
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
      if (spec.type === 'rating') {
        const r = Math.max(0, Math.min(spec.max ?? 5, Math.round(Number(value) || 0)));
        return {
          kind: GridCellKind.Custom,
          data: { kind: 'star-cell', rating: r, max: spec.max ?? 5 },
          copyData: value,
          allowOverlay: false,
        };
      }
      if (spec.type === 'progress') {
        return {
          kind: GridCellKind.Custom,
          data: { kind: 'range-cell', value: Number(value) || 0, max: spec.max ?? 100 },
          copyData: value,
          allowOverlay: false,
        };
      }
      if (baseCellType(spec.type) === 'number') {
        const n = value === '' ? undefined : Number(value);
        const num = typeof n === 'number' && !Number.isNaN(n) ? n : undefined;
        // Lightweight "render is the type" via displayData: currency $-formatted.
        let display = value;
        if (num !== undefined) {
          if (spec.type === 'currency') display = `${spec.symbol ?? '$'}${num.toLocaleString()}`;
          else if (spec.type === 'percent') display = `${num}%`;
          else if (spec.type === 'duration')
            display = num >= 60 ? `${Math.floor(num / 60)}h ${num % 60}m` : `${num}m`;
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
    [cols, schema, rows, editable, relations, expandable],
  );

  const onCellEdited = useCallback(
    (cell: Item, newVal: EditableGridCell): void => {
      const [col, row] = cell;
      const spec = dataCol(col);
      if (!spec) return;
      const idx = canonicalIdx(rows[row], row);
      let v = '';
      if (newVal.kind === GridCellKind.Boolean) v = newVal.data ? 'x' : '';
      else if (newVal.kind === GridCellKind.Number)
        v = newVal.data === undefined || newVal.data === null ? '' : String(newVal.data);
      else if (newVal.kind === GridCellKind.Uri || newVal.kind === GridCellKind.Text)
        v = newVal.data ?? '';
      else if (newVal.kind === GridCellKind.Custom) {
        const d = newVal.data as { kind?: string; rating?: number; value?: number };
        if (d.kind === 'star-cell') v = String(d.rating ?? 0);
        else if (d.kind === 'range-cell') v = String(d.value ?? 0);
        else return; // pill cell etc. — display only
      }
      onCellChange(idx, spec.key, v);
    },
    [cols, rows, onCellChange, expandable],
  );

  return (
    <div className={styles.glideWrap} data-testid="smart-table-glide">
      <DataEditor
        columns={columns}
        rows={rows.length}
        getCellContent={getCellContent}
        onCellEdited={editable ? onCellEdited : undefined}
        customRenderers={[pillRenderer, starRenderer, rangeRenderer]}
        onColumnResize={(c, w) => setWidths((p) => ({ ...p, [String(c.id)]: w }))}
        onHeaderMenuClick={onHeaderMenu ? (col) => onHeaderMenu(String(columns[col]?.id)) : undefined}
        getCellsForSelection
        rowMarkers={onSelectedRowsChange ? 'both' : onExpandRow ? 'both' : 'number'}
        gridSelection={gridSelection}
        onGridSelectionChange={(sel) => {
          setGridSelection(sel);
          if (onSelectedRowsChange) {
            onSelectedRowsChange(sel.rows.toArray().map((i) => canonicalIdx(rows[i], i)));
          }
        }}
        onRowMoved={undefined}
        smoothScrollX
        smoothScrollY
        fillHandle={editable}
        keybindings={{ search: true }}
        width="100%"
        height="100%"
        onCellClicked={(cell) => {
          // Single click on the leftmost ⤢ column opens the record card.
          if (expandable && onExpandRow && cell[0] === 0) onExpandRow(canonicalIdx(rows[cell[1]], cell[1]));
        }}
      />
    </div>
  );
};
