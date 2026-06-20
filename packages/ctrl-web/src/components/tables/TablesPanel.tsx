// TablesPanel — the smart-table browse scene (ADR-003 §6 / §8). Renders in
// AmbientHome's scenePane BESIDE Irisy (Irisy stays pinned), not as a full-
// screen route — the generic morphing-surface architecture (like NotesApp).
// Left: the vault's smart tables (any .md with a schema: frontmatter). Right:
// the selected one through the viewer registry → SmartTableViewer (§14 query
// bar + grid/kanban). "+ New" seeds a starter table.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { SmartTableViewer } from '@/components/viewers/SmartTableViewer';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import { createSmartTable, listSmartTables } from '@/lib/smart-tables';
import styles from './TablesPanel.module.css';

export const TablesPanel = (): ReactElement => {
  const qc = useQueryClient();
  const { data: tables, isLoading } = useQuery({
    queryKey: ['smart-tables'],
    queryFn: listSmartTables,
  });
  const [selected, setSelected] = useState<string | null>(null);

  const onNew = async (): Promise<void> => {
    const name = window.prompt('New table name', 'Untitled table');
    if (name == null) return;
    const path = await createSmartTable(name);
    await qc.invalidateQueries({ queryKey: ['smart-tables'] });
    setSelected(path);
  };

  return (
    <div className={styles.page}>
      <aside className={styles.list}>
        <header className={styles.listHead}>
          <span className={styles.listTitle}>Smart Tables</span>
          <button type="button" className={styles.newBtn} onClick={onNew}>
            + New
          </button>
        </header>
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
