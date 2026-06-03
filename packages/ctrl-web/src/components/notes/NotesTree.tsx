// NotesTree — left column of the Notes app.
//
// (ADR-002 substrate § vault v1 §8.6 v4, 2026-06-02 — memory
// `decision_vault_adr_002_section_8`.)
//
// Folder-grouped flat list of vault `.md` files driven by a TanStack
// Query on `vault_list`. Search query (when non-empty + > 1 char)
// switches the source to the FTS5-backed `vault_search` result; the
// component itself stays presentational and emits selections through
// `onSelect`.

import { useMemo, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultList, vaultRootPath, vaultSearch } from '@/lib/kernel';
import styles from './Notes.module.css';

interface NotesTreeProps {
  query: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

interface FolderGroup {
  folder: string;
  items: string[];
}

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const groupByFolder = (paths: ReadonlyArray<string>): FolderGroup[] => {
  const buckets = new Map<string, string[]>();
  for (const p of paths) {
    if (p.startsWith('.ctrl/')) continue;
    const slash = p.indexOf('/');
    const folder = slash >= 0 ? p.slice(0, slash) : '(root)';
    const list = buckets.get(folder) ?? [];
    list.push(p);
    buckets.set(folder, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, items]) => ({ folder, items: items.sort() }));
};

export const NotesTree = ({
  query,
  selectedPath,
  onSelect,
}: NotesTreeProps): ReactElement => {
  const { data: rootPath } = useQuery({
    queryKey: ['vault-root'],
    queryFn: vaultRootPath,
    staleTime: Infinity,
  });

  const { data: allPaths = [], isLoading } = useQuery({
    queryKey: ['vault-list'],
    queryFn: () => vaultList(),
    staleTime: 5_000,
  });

  const trimmed = query.trim();
  const { data: searchHits = [] } = useQuery({
    queryKey: ['vault-search', trimmed],
    queryFn: () => vaultSearch(trimmed, 100),
    enabled: trimmed.length > 1,
    staleTime: 2_000,
  });

  const visiblePaths = trimmed.length > 1 ? searchHits : allPaths;
  const grouped = useMemo(() => groupByFolder(visiblePaths), [visiblePaths]);

  return (
    <aside className={styles.tree} aria-label="Notes tree">
      <header className={styles.treeHeader}>
        <h2 className={styles.treeTitle}>Notes</h2>
        {rootPath ? (
          <p className={styles.treeRoot} title={rootPath}>
            {rootPath}
          </p>
        ) : null}
      </header>
      <div className={styles.treeBody}>
        {isLoading ? (
          <p className={styles.muted}>Loading…</p>
        ) : grouped.length === 0 ? (
          <p className={styles.muted}>
            {trimmed.length > 1 ? 'No matches' : 'Vault is empty'}
          </p>
        ) : (
          grouped.map(({ folder, items }) => (
            <section key={folder} className={styles.folder}>
              <h3 className={styles.folderName}>{folder}</h3>
              <ul className={styles.fileList}>
                {items.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className={styles.fileItem}
                      data-active={selectedPath === path || undefined}
                      onClick={() => onSelect(path)}
                      title={path}
                    >
                      <span className={styles.fileName}>{stem(baseName(path))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </aside>
  );
};
