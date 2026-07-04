// BaseView — a smart-table BASE opened: top sheet tabs (its data-tables) + the
// active sheet's grid/views. A Bitable IS a multi-sheet container (bao
// 2026-07-03: a smart-table must be multi-sheet), so opening one shows its
// data-tables as tabs — each a full SmartTableViewer with its own views.
// Tabs drag-reorder (persisted to tables/<base>/_base.md) + double-click rename
// (writes the sheet's frontmatter title). plan-tables-workspace-ux.md.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SmartTableViewer } from '@/components/viewers/SmartTableViewer';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import {
  createSheetInBase,
  deleteSheet,
  duplicateSheet,
  renameSheet,
  reorderSheets,
  type Base,
} from '@/lib/smart-tables';
import styles from './TablesPanel.module.css';

interface BaseViewProps {
  base: Base;
  /** Report the active sheet path up so the shell feeds it to Irisy. */
  onActiveSheet?: (path: string | null) => void;
}

export function BaseView({ base, onActiveSheet }: BaseViewProps): ReactElement {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(base.sheets[0]?.path ?? null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ path: string; value: string } | null>(null);
  // Right-click context menu on a tab: position + which sheet + delete-armed.
  const [menu, setMenu] = useState<{ path: string; x: number; y: number; confirm: boolean } | null>(null);
  const dragPath = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const multi = base.sheets.length > 1;

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  // Keep the active sheet valid as the base's sheets change (add / switch base).
  useEffect(() => {
    setActive((cur) => (cur && base.sheets.some((s) => s.path === cur) ? cur : base.sheets[0]?.path ?? null));
  }, [base]);

  useEffect(() => {
    onActiveSheet?.(active);
    return () => onActiveSheet?.(null);
  }, [active, onActiveSheet]);

  const refresh = (): Promise<unknown> => qc.invalidateQueries({ queryKey: ['bases'] });

  const addSheet = async (): Promise<void> => {
    setAdding(true);
    try {
      const path = await createSheetInBase(base.id, `Table ${base.sheets.length + 1}`);
      await refresh();
      setActive(path);
    } finally {
      setAdding(false);
    }
  };

  const commitRename = async (): Promise<void> => {
    if (!editing) return;
    const { path, value } = editing;
    setEditing(null);
    const current = base.sheets.find((s) => s.path === path)?.title;
    if (value.trim() && value.trim() !== current) {
      await renameSheet(path, value.trim());
      await refresh();
    }
  };

  const onDrop = async (targetPath: string): Promise<void> => {
    const from = dragPath.current;
    dragPath.current = null;
    setDragOver(null);
    if (!from || from === targetPath) return;
    const order = base.sheets.map((s) => s.path);
    const fromIdx = order.indexOf(from);
    const toIdx = order.indexOf(targetPath);
    if (fromIdx < 0 || toIdx < 0) return;
    order.splice(toIdx, 0, ...order.splice(fromIdx, 1));
    await reorderSheets(base.id, order);
    await refresh();
  };

  const onDuplicate = async (path: string): Promise<void> => {
    setMenu(null);
    const dest = await duplicateSheet(path);
    await refresh();
    setActive(dest);
  };

  const onDelete = async (path: string): Promise<void> => {
    setMenu(null);
    const remaining = base.sheets.filter((s) => s.path !== path);
    await deleteSheet(path);
    await refresh();
    if (active === path) setActive(remaining[0]?.path ?? null);
  };

  return (
    <div className={styles.baseView}>
      <div className={styles.sheetTabs} role="tablist" aria-label={`${base.name} data tables`}>
        {base.sheets.map((s) =>
          editing?.path === s.path ? (
            <input
              key={s.path}
              className={styles.sheetRename}
              value={editing.value}
              autoFocus
              onChange={(e) => setEditing({ path: s.path, value: e.target.value })}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename();
                else if (e.key === 'Escape') setEditing(null);
              }}
              data-testid="sheet-rename"
            />
          ) : (
            <button
              key={s.path}
              type="button"
              role="tab"
              aria-selected={s.path === active}
              className={styles.sheetTab}
              data-active={s.path === active || undefined}
              data-dragover={dragOver === s.path || undefined}
              draggable={multi}
              onClick={() => setActive(s.path)}
              onDoubleClick={() => setEditing({ path: s.path, value: s.title })}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ path: s.path, x: e.clientX, y: e.clientY, confirm: false });
              }}
              onDragStart={() => {
                dragPath.current = s.path;
              }}
              onDragOver={(e) => {
                if (dragPath.current && multi) {
                  e.preventDefault();
                  setDragOver(s.path);
                }
              }}
              onDragLeave={() => setDragOver((d) => (d === s.path ? null : d))}
              onDrop={(e) => {
                e.preventDefault();
                void onDrop(s.path);
              }}
              title={multi ? 'Double-click to rename · drag to reorder' : 'Double-click to rename'}
            >
              {s.title}
            </button>
          ),
        )}
        <button
          type="button"
          className={styles.sheetAdd}
          onClick={() => void addSheet()}
          disabled={adding}
          title="Add a data table to this base"
          data-testid="base-add-sheet"
        >
          +
        </button>
      </div>
      <div className={styles.sheetBody}>
        {active != null ? (
          <SmartTableViewer key={active} resource={resourceFromVaultPath(active)} />
        ) : (
          <div className={styles.detailEmpty}>This base has no tables yet.</div>
        )}
      </div>
      {menu && (
        <div
          className={styles.tabMenu}
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          role="menu"
          data-testid="sheet-tab-menu"
        >
          <button
            type="button"
            className={styles.tabMenuItem}
            onClick={() => void onDuplicate(menu.path)}
          >
            Duplicate
          </button>
          <button
            type="button"
            className={styles.tabMenuItem}
            onClick={() => {
              setEditing({ path: menu.path, value: base.sheets.find((s) => s.path === menu.path)?.title ?? '' });
              setMenu(null);
            }}
          >
            Rename
          </button>
          {menu.confirm ? (
            <button
              type="button"
              className={`${styles.tabMenuItem} ${styles.tabMenuDanger}`}
              onClick={() => void onDelete(menu.path)}
              data-testid="sheet-delete-confirm"
            >
              Confirm delete
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.tabMenuItem} ${styles.tabMenuDanger}`}
              onClick={() => setMenu({ ...menu, confirm: true })}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
