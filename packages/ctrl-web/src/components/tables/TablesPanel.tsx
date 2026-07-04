// TablesPanel — the smart-table workspace scene (ADR-003 §6 / §8). A minimal
// Grist / Teable-style layout: a collapsible left tree of TABLES (+ TEMPLATES)
// beside the viewer. Smart tables live in their OWN `tables/` folder, separate
// from the user's Obsidian notes — the sidebar never mixes in vault docs, so
// the two never collide (bao 2026-06-21; ADR-003 §6 v20). Pick a table ->
// SmartTableViewer (its own top view bar: grid / kanban / chart / timeline …);
// "+ New" or a template seeds a table; Import loads a CSV. Renders in
// AmbientHome beside Irisy (Irisy stays pinned).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import { SmartTableViewer } from '@/components/viewers/SmartTableViewer';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import {
  createSheet,
  createSmartTable,
  exportTableCsv,
  importCsv,
  listSheets,
  listSmartTables,
  TEMPLATES,
} from '@/lib/smart-tables';
import styles from './TablesPanel.module.css';

// Univer spreadsheet viewer is heavy (~5.6MB) — lazy-load it so it only enters
// the bundle when a .sheet.md is actually opened (plan-univer-formula-augment.md).
const UniverSheetViewer = lazy(() =>
  import('@/components/viewers/UniverSheetViewer').then((m) => ({ default: m.UniverSheetViewer })),
);

/** A .sheet.md opens in Univer; every other tables/ file is a smart-table. */
function renderTableDetail(selected: string | null): ReactElement {
  if (!selected) {
    return <div className={styles.detailEmpty}>Pick a table.</div>;
  }
  const resource = resourceFromVaultPath(selected);
  if (selected.toLowerCase().endsWith('.sheet.md')) {
    return (
      <Suspense fallback={<div className={styles.detailEmpty}>Loading spreadsheet…</div>}>
        <UniverSheetViewer key={selected} resource={resource} />
      </Suspense>
    );
  }
  // Key on the path so switching tables forces a clean remount.
  return <SmartTableViewer key={selected} resource={resource} />;
}

interface TablesPanelProps {
  /** Lift the currently-open table path so the shell can feed it to Irisy as
   *  ambient context ("the user is viewing <path>"). */
  onActiveTable?: (path: string | null) => void;
}

type Selection = string | null;

export const TablesPanel = ({ onActiveTable }: TablesPanelProps = {}): ReactElement => {
  const qc = useQueryClient();
  const { data: tables, isLoading: tablesLoading } = useQuery({
    queryKey: ['smart-tables'],
    queryFn: listSmartTables,
  });
  const { data: sheets } = useQuery({
    queryKey: ['sheets'],
    queryFn: listSheets,
  });
  const [selected, setSelected] = useState<Selection>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Report the open table up so Irisy knows what the user is looking at.
  useEffect(() => {
    onActiveTable?.(selected);
    return () => onActiveTable?.(null);
  }, [selected, onActiveTable]);

  const onPickTemplate = async (key: string): Promise<void> => {
    setShowTemplates(false);
    // No window.prompt: Tauri's WKWebView returns null for it (and a blocking
    // name dialog isn't one-shot anyway). Create immediately with the template's
    // default name — createSmartTable de-dupes the slug — and let the user rename
    // in the table title afterwards.
    const name = TEMPLATES[key]?.name ?? 'Untitled';
    const path = await createSmartTable(name, key);
    await qc.invalidateQueries({ queryKey: ['smart-tables'] });
    setSelected(path);
  };

  const onNewSheet = async (): Promise<void> => {
    setShowTemplates(false);
    const path = await createSheet();
    await qc.invalidateQueries({ queryKey: ['sheets'] });
    setSelected(path);
  };

  const onImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const text = await file.text();
    const path = await importCsv(file.name.replace(/\.csv$/i, ''), text);
    await qc.invalidateQueries({ queryKey: ['smart-tables'] });
    setSelected(path);
  };

  const onExport = async (): Promise<void> => {
    if (!selected) return;
    const title = tables?.find((t) => t.path === selected)?.title ?? 'table';
    await exportTableCsv(selected, title);
  };

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
        <section className={styles.detail}>{renderTableDetail(selected)}</section>
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
              onClick={() => setShowTemplates((s) => !s)}
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
              disabled={!selected}
              title={selected ? 'Export the open table as CSV' : 'Open a table to export it'}
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

        {showTemplates && (
          <div className={styles.templateMenu} data-testid="template-menu">
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
          <div className={styles.sectionLabel}>Tables</div>
          {tablesLoading ? (
            <div className={styles.empty}>loading…</div>
          ) : tables && tables.length > 0 ? (
            <ul className={styles.items}>
              {tables.map((t) => (
                <li key={t.path}>
                  <button
                    type="button"
                    className={styles.item}
                    data-active={selected === t.path}
                    onClick={() => setSelected(t.path)}
                  >
                    <span className={styles.itemIcon}>▤</span>
                    <span className={styles.itemTitle}>{t.title}</span>
                    <span className={styles.itemMeta}>{t.fields}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.empty}>
              No tables yet — <strong>+ New</strong>.
            </div>
          )}

          {sheets && sheets.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Spreadsheets</div>
              <ul className={styles.items}>
                {sheets.map((s) => (
                  <li key={s.path}>
                    <button
                      type="button"
                      className={styles.item}
                      data-active={selected === s.path}
                      onClick={() => setSelected(s.path)}
                    >
                      <span className={styles.itemIcon}>▦</span>
                      <span className={styles.itemTitle}>{s.title}</span>
                      <span className={styles.itemMeta}>fx</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.sectionLabel}>Templates</div>
          <ul className={styles.items}>
            {Object.entries(TEMPLATES).map(([key, t]) => (
              <li key={key}>
                <button
                  type="button"
                  className={styles.item}
                  onClick={() => void onPickTemplate(key)}
                  title={`New ${t.name} table`}
                >
                  <span className={styles.itemIcon}>{t.icon}</span>
                  <span className={styles.itemTitle}>{t.name}</span>
                  <span className={styles.itemMeta}>{t.schema.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <section className={styles.detail}>{renderTableDetail(selected)}</section>
    </div>
  );
};

