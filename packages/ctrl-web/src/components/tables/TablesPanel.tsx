// TablesPanel — the smart-table workspace scene (ADR-003 §6 / §8). A minimal
// Grist / Teable-style layout: a collapsible left tree of TABLES (+ TEMPLATES)
// beside the viewer. Smart tables live in their OWN `tables/` folder, separate
// from the user's Obsidian notes — the sidebar never mixes in vault docs, so
// the two never collide (bao 2026-06-21; ADR-003 §6 v20). Pick a table ->
// SmartTableViewer (its own top view bar: grid / kanban / chart / timeline …);
// "+ New" or a template seeds a table; Import loads a CSV. Renders in
// AmbientHome beside Irisy (Irisy stays pinned).

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { SmartTableViewer } from '@/components/viewers/SmartTableViewer';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import { createSmartTable, importCsv, listSmartTables, TEMPLATES } from '@/lib/smart-tables';
import styles from './TablesPanel.module.css';

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

  const onImport = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const text = await file.text();
    const path = await importCsv(file.name.replace(/\.csv$/i, ''), text);
    await qc.invalidateQueries({ queryKey: ['smart-tables'] });
    setSelected(path);
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
        <section className={styles.detail}>{renderDetail(selected)}</section>
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
      <section className={styles.detail}>{renderDetail(selected)}</section>
    </div>
  );
};

function renderDetail(selected: Selection): ReactElement {
  if (!selected) {
    return <div className={styles.detailEmpty}>Pick a table.</div>;
  }
  const resource = resourceFromVaultPath(selected);
  // Key on the path so switching tables forces a clean remount (no viewer
  // state bleeds across a selection change).
  return <SmartTableViewer key={selected} resource={resource} />;
}
