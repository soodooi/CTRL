// TablesPanel — the smart-table browse scene (ADR-003 §6 / §8). Renders in
// AmbientHome's scenePane BESIDE Irisy (Irisy stays pinned), not as a full-
// screen route — the generic morphing-surface architecture (like NotesApp).
// Left: the vault's smart tables (any .md with a schema: frontmatter). Right:
// the selected one through the viewer registry → SmartTableViewer (§14 query
// bar + grid/kanban). "+ New" seeds a starter table.

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

export const TablesPanel = ({ onActiveTable }: TablesPanelProps = {}): ReactElement => {
  const qc = useQueryClient();
  const { data: tables, isLoading } = useQuery({
    queryKey: ['smart-tables'],
    queryFn: listSmartTables,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  // Report the open table up (and clear it on unmount) so Irisy knows what the
  // user is looking at.
  useEffect(() => {
    onActiveTable?.(selected);
    return () => onActiveTable?.(null);
  }, [selected, onActiveTable]);

  const onPickTemplate = async (key: string): Promise<void> => {
    setShowTemplates(false);
    const name = window.prompt('New table name', TEMPLATES[key]?.name ?? 'Untitled');
    if (name == null) return;
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

  return (
    <div className={styles.page}>
      <aside className={styles.list}>
        <header className={styles.listHead}>
          <span className={styles.listTitle}>Smart Tables</span>
          <span className={styles.listActions}>
            <label className={styles.newBtn} title="Import a CSV file" data-testid="import-csv">
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
              className={styles.newBtn}
              onClick={() => setShowTemplates((s) => !s)}
              data-testid="new-table"
            >
              + New
            </button>
          </span>
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
                <span className={styles.templateFields}>{t.schema.length} fields</span>
              </button>
            ))}
          </div>
        )}
        {isLoading ? (
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
                  <span className={styles.itemTitle}>{t.title}</span>
                  <span className={styles.itemMeta}>{t.fields} fields</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            No smart tables yet.
            <br />
            Click <strong>+ New</strong>, or add a <code>schema:</code> block to any note.
          </div>
        )}
      </aside>
      <section className={styles.detail}>
        {selected ? (
          <SmartTableViewer resource={resourceFromVaultPath(selected)} />
        ) : (
          <div className={styles.detailEmpty}>Pick a table to query it.</div>
        )}
      </section>
    </div>
  );
};
