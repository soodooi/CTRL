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

/** Glyph for a saved-view kind, shown on the nested view rows (Feishu spine). */
const viewIcon = (kind: string): string => {
  switch (kind) {
    case 'kanban': return '▥';
    case 'calendar': return '▦';
    case 'gallery': return '▧';
    case 'form': return '▤';
    case 'chart': return '▨';
    case 'timeline': return '▬';
    case 'summary': return 'Σ';
    default: return '▤';
  }
};

/** One unified node in the left tree — a table or a spreadsheet, so the two
 *  paradigms read as one list of "things with data" (plan-tables-workspace-ux.md
 *  T1: left-tree spine). Views nest only under smart-tables. */
interface DataNode {
  path: string;
  title: string;
  type: 'table' | 'sheet';
  meta: string;
  views: Array<{ name: string; kind: string }>;
}

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

  // Merge tables + spreadsheets into ONE sorted tree of data-things, icon-
  // distinguished — to the user "a thing with data" is one concept (T1).
  const dataNodes: DataNode[] = [
    ...(tables ?? []).map((t): DataNode => ({
      path: t.path, title: t.title, type: 'table', meta: `${t.fields}`, views: t.views,
    })),
    ...(sheets ?? []).map((s): DataNode => ({
      path: s.path, title: s.title, type: 'sheet', meta: 'fx', views: [],
    })),
  ].sort((a, b) => a.title.localeCompare(b.title));

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

  // Empty state = the convergent create menu (all 5 products: Blank / Template /
  // Build-with-AI), one-shot, no wizard (plan-tables-workspace-ux.md T5).
  const emptyState = (
    <div className={styles.emptyTiles}>
      <div className={styles.emptyHint}>Create something with data</div>
      <div className={styles.tileRow}>
        <button type="button" className={styles.tile} onClick={() => void onPickTemplate('blank')}>
          <span className={styles.tileIcon}>▤</span>
          <span className={styles.tileTitle}>Blank table</span>
          <span className={styles.tileSub}>Smart table · 8 views</span>
        </button>
        <button type="button" className={styles.tile} onClick={() => void onNewSheet()}>
          <span className={styles.tileIcon}>▦</span>
          <span className={styles.tileTitle}>Blank spreadsheet</span>
          <span className={styles.tileSub}>Excel · 400+ formulas</span>
        </button>
        <button type="button" className={styles.tile} onClick={() => setShowTemplates(true)}>
          <span className={styles.tileIcon}>⧉</span>
          <span className={styles.tileTitle}>From template</span>
          <span className={styles.tileSub}>{Object.keys(TEMPLATES).length} templates</span>
        </button>
      </div>
      <div className={styles.emptyIrisy}>or ask Irisy on the right to build one for you →</div>
    </div>
  );
  const detailFor = (sel: Selection): ReactElement => (sel ? renderTableDetail(sel) : emptyState);

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
        <section className={styles.detail}>{detailFor(selected)}</section>
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
          {tablesLoading ? (
            <div className={styles.empty}>loading…</div>
          ) : dataNodes.length > 0 ? (
            <ul className={styles.items}>
              {dataNodes.map((n) => (
                <li key={n.path}>
                  <button
                    type="button"
                    className={styles.item}
                    data-active={selected === n.path}
                    onClick={() => setSelected(n.path)}
                    title={n.path}
                  >
                    <span className={styles.itemIcon}>{n.type === 'sheet' ? '▦' : '▤'}</span>
                    <span className={styles.itemTitle}>{n.title}</span>
                    <span className={styles.itemMeta}>{n.meta}</span>
                  </button>
                  {n.type === 'table' && n.views.length > 0 && (
                    <ul className={styles.subItems}>
                      {n.views.map((v, i) => (
                        <li key={`${n.path}:${i}`}>
                          <button
                            type="button"
                            className={styles.subItem}
                            onClick={() => setSelected(n.path)}
                            title={`${v.name} (${v.kind})`}
                          >
                            <span className={styles.subIcon}>{viewIcon(v.kind)}</span>
                            <span className={styles.itemTitle}>{v.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.empty}>
              No tables yet — <strong>+ New</strong> to create one.
            </div>
          )}
        </div>
      </aside>
      <section className={styles.detail}>{detailFor(selected)}</section>
    </div>
  );
};

