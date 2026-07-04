// TablesPanel — the tables workspace. A collapsible left tree of BASES (each a
// multi-sheet container: a smart-table base holds data-tables as sheets, a
// Univer base is a workbook), beside the open base. Bases live in their OWN
// `tables/` folder, separate from the user's notes (bao 2026-06-21). Opening a
// smart base shows its data-tables as top tabs (BaseView), each a full
// SmartTableViewer with its own views; a Univer base opens the spreadsheet.
// plan-tables-workspace-ux.md (multi-sheet). Renders in AmbientHome beside Irisy.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import {
  createBase,
  createSheet,
  createSmartTable,
  exportTableCsv,
  importCsv,
  listBases,
  renameBase,
  TEMPLATES,
  type Base,
} from '@/lib/smart-tables';
import { BaseView } from './BaseView';
import styles from './TablesPanel.module.css';

// Univer spreadsheet viewer is heavy (~5.6MB) — lazy-load it so it only enters
// the bundle when a Univer base is actually opened (plan-univer-formula-augment.md).
const UniverSheetViewer = lazy(() =>
  import('@/components/viewers/UniverSheetViewer').then((m) => ({ default: m.UniverSheetViewer })),
);

/** Stable selection key — kind + id so a folder-base and a flat table of the
 *  same name never collide. */
const baseKey = (b: Base): string => `${b.kind}:${b.id}`;

interface TablesPanelProps {
  /** Lift the active sheet path so the shell feeds it to Irisy as ambient
   *  context ("the user is viewing <path>"). */
  onActiveTable?: (path: string | null) => void;
}

export const TablesPanel = ({ onActiveTable }: TablesPanelProps = {}): ReactElement => {
  const qc = useQueryClient();
  const { data: bases, isLoading } = useQuery({ queryKey: ['bases'], queryFn: listBases });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The data-table currently in focus inside the open base (BaseView reports it
  // up); drives Irisy ambient context + CSV export.
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  // Inline base rename in the tree (double-click a base).
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);

  const commitBaseRename = async (b: Base): Promise<void> => {
    const val = renaming?.value.trim();
    setRenaming(null);
    if (val && val !== b.name) {
      await renameBase(b, val);
      await qc.invalidateQueries({ queryKey: ['bases'] });
    }
  };

  const selectedBase = (bases ?? []).find((b) => baseKey(b) === selectedKey) ?? null;

  const openBase = (b: Base): void => {
    setSelectedKey(baseKey(b));
    // Univer bases have one file; smart bases report their active sheet via BaseView.
    if (b.kind === 'univer') setActiveSheet(b.sheets[0]?.path ?? null);
  };

  useEffect(() => {
    onActiveTable?.(activeSheet);
    return () => onActiveTable?.(null);
  }, [activeSheet, onActiveTable]);

  const afterCreate = async (openPath: string, baseId: string, kind: 'smart' | 'univer'): Promise<void> => {
    setShowCreate(false);
    await qc.invalidateQueries({ queryKey: ['bases'] });
    setSelectedKey(`${kind}:${baseId}`);
    setActiveSheet(openPath);
  };

  const onNewBase = async (): Promise<void> => {
    const { baseId, sheetPath } = await createBase('Base');
    await afterCreate(sheetPath, baseId, 'smart');
  };
  const onPickTemplate = async (key: string): Promise<void> => {
    const name = TEMPLATES[key]?.name ?? 'Untitled';
    const path = await createSmartTable(name, key);
    await afterCreate(path, path.slice('tables/'.length).replace(/\.md$/i, ''), 'smart');
  };
  const onNewSheet = async (): Promise<void> => {
    const path = await createSheet();
    await afterCreate(path, path.slice('tables/'.length).replace(/\.sheet\.md$/i, ''), 'univer');
  };
  const onImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const text = await file.text();
    const path = await importCsv(file.name.replace(/\.csv$/i, ''), text);
    await afterCreate(path, path.slice('tables/'.length).replace(/\.md$/i, ''), 'smart');
  };
  const canExport = activeSheet != null && activeSheet.toLowerCase().endsWith('.md') && !activeSheet.toLowerCase().endsWith('.sheet.md');
  const onExport = async (): Promise<void> => {
    if (!canExport || activeSheet == null) return;
    await exportTableCsv(activeSheet, activeSheet.split('/').pop()?.replace(/\.md$/i, '') ?? 'table');
  };

  const detail = ((): ReactElement => {
    if (selectedBase == null) {
      // Empty state = convergent create menu (Blank base / spreadsheet / template).
      return (
        <div className={styles.emptyTiles}>
          <div className={styles.emptyHint}>Create something with data</div>
          <div className={styles.tileRow}>
            <button type="button" className={styles.tile} onClick={() => void onNewBase()}>
              <span className={styles.tileIcon}>▤</span>
              <span className={styles.tileTitle}>New base</span>
              <span className={styles.tileSub}>Multi-sheet · relations</span>
            </button>
            <button type="button" className={styles.tile} onClick={() => void onNewSheet()}>
              <span className={styles.tileIcon}>▦</span>
              <span className={styles.tileTitle}>Blank spreadsheet</span>
              <span className={styles.tileSub}>Excel · 400+ formulas</span>
            </button>
            <button type="button" className={styles.tile} onClick={() => setShowCreate(true)}>
              <span className={styles.tileIcon}>⧉</span>
              <span className={styles.tileTitle}>From template</span>
              <span className={styles.tileSub}>{Object.keys(TEMPLATES).length} templates</span>
            </button>
          </div>
          <div className={styles.emptyIrisy}>or ask Irisy on the right to build one for you →</div>
        </div>
      );
    }
    if (selectedBase.kind === 'univer') {
      const path = selectedBase.sheets[0]?.path;
      return path ? (
        <Suspense fallback={<div className={styles.detailEmpty}>Loading spreadsheet…</div>}>
          <UniverSheetViewer key={path} resource={resourceFromVaultPath(path)} />
        </Suspense>
      ) : (
        <div className={styles.detailEmpty}>Empty workbook.</div>
      );
    }
    return <BaseView key={selectedBase.id} base={selectedBase} onActiveSheet={setActiveSheet} />;
  })();

  if (collapsed) {
    return (
      <div className={styles.page} data-collapsed="true">
        <button
          type="button"
          className={styles.expandRail}
          onClick={() => setCollapsed(false)}
          title="Show sidebar"
          data-testid="ws-expand"
        >
          »
        </button>
        <section className={styles.detail}>{detail}</section>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <aside className={styles.list}>
        <header className={styles.listHead}>
          <span className={styles.listActions}>
            <button
              type="button"
              className={styles.newBtn}
              onClick={() => setShowCreate((s) => !s)}
              data-testid="new-table"
            >
              + New
            </button>
            <label className={styles.ghostBtn} title="Import a CSV file" data-testid="import-csv">
              Import
              <input
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  void onImport(file);
                }}
              />
            </label>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => void onExport()}
              disabled={!canExport}
              title={canExport ? 'Export the open data table as CSV' : 'Open a data table to export it'}
              data-testid="export-csv"
            >
              Export
            </button>
          </span>
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={() => setCollapsed(true)}
            title="Collapse sidebar"
            data-testid="ws-collapse"
          >
            «
          </button>
        </header>

        {showCreate && (
          <div className={styles.templateMenu} data-testid="template-menu">
            <button
              type="button"
              className={styles.templateItem}
              onClick={() => void onNewBase()}
              data-testid="new-base"
            >
              <span className={styles.templateIcon}>▤</span>
              <span>New base</span>
              <span className={styles.templateFields}>multi</span>
            </button>
            <button
              type="button"
              className={styles.templateItem}
              onClick={() => void onNewSheet()}
              data-testid="new-spreadsheet"
            >
              <span className={styles.templateIcon}>▦</span>
              <span>Blank spreadsheet</span>
              <span className={styles.templateFields}>Excel</span>
            </button>
            {Object.entries(TEMPLATES).map(([key, t]) => (
              <button
                key={key}
                type="button"
                className={styles.templateItem}
                onClick={() => void onPickTemplate(key)}
              >
                <span className={styles.templateIcon}>{t.icon}</span>
                <span>{t.name}</span>
                <span className={styles.templateFields}>{t.schema.length}</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.tree}>
          {isLoading ? (
            <div className={styles.empty}>loading…</div>
          ) : bases && bases.length > 0 ? (
            <ul className={styles.items}>
              {bases.map((b) =>
                renaming?.key === baseKey(b) ? (
                  <li key={baseKey(b)}>
                    <input
                      className={styles.baseRename}
                      value={renaming.value}
                      autoFocus
                      onChange={(e) => setRenaming({ key: baseKey(b), value: e.target.value })}
                      onBlur={() => void commitBaseRename(b)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitBaseRename(b);
                        else if (e.key === 'Escape') setRenaming(null);
                      }}
                      data-testid="base-rename"
                    />
                  </li>
                ) : (
                  <li key={baseKey(b)}>
                    <button
                      type="button"
                      className={styles.item}
                      data-active={selectedKey === baseKey(b)}
                      onClick={() => openBase(b)}
                      onDoubleClick={() => setRenaming({ key: baseKey(b), value: b.name })}
                      title={`${b.id} · double-click to rename`}
                    >
                      <span className={styles.itemIcon}>{b.kind === 'univer' ? '▦' : '▤'}</span>
                      <span className={styles.itemTitle}>{b.name}</span>
                      <span className={styles.itemMeta}>
                        {b.kind === 'univer' ? 'fx' : b.sheets.length > 1 ? `${b.sheets.length}` : ''}
                      </span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <div className={styles.empty}>
              No bases yet — <strong>+ New</strong> to create one.
            </div>
          )}
        </div>
      </aside>
      <section className={styles.detail}>{detail}</section>
    </div>
  );
};
