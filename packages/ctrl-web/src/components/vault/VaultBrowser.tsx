// VaultBrowser — the VMark-style entry point into ~/Documents/CTRL/.
// Three panes side-by-side:
//
//   [ Tree  ] [ Selected viewer (markdown / image / table / …) ] [ Backlinks ]
//
// Tree is a flat list of vault paths grouped by top-level folder
// (notes/ / assets/images/ / assets/audio/ / …). Search box hooks
// straight into `vault_search` FTS5. Clicking a note opens it in the
// active workspace instance as a `vault-md` tab; double-click opens it
// in a new instance (Cmd-click also opens-new).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  vaultList,
  vaultRead,
  vaultRootPath,
  vaultSearch,
  vaultWrite,
} from '@/lib/kernel';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { ViewerHost } from '@/components/viewers/ViewerHost';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import { BacklinksPanel } from './BacklinksPanel';
import styles from './VaultBrowser.module.css';

const groupPathsByFolder = (
  paths: ReadonlyArray<string>,
): Array<{ folder: string; items: string[] }> => {
  const buckets = new Map<string, string[]>();
  for (const p of paths) {
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

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

export const VaultBrowser = (): ReactElement => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const openTab = useWorkspaceStore((s) => s.openTab);
  const createBlank = useWorkspaceStore((s) => s.createBlank);
  const activeInstanceId = useWorkspaceStore((s) => s.activeInstanceId);

  const { data: rootPath } = useQuery({
    queryKey: ['vault-root'],
    queryFn: vaultRootPath,
    staleTime: Infinity,
  });

  const { data: allPaths = [], isLoading: listLoading } = useQuery({
    queryKey: ['vault-list'],
    queryFn: () => vaultList(),
    staleTime: 5_000,
  });

  // Search re-runs as the user types, throttled by react-query's
  // staleTime; debounce manually for the FTS5 call itself.
  const trimmed = query.trim();
  const { data: searchResults = [] } = useQuery({
    queryKey: ['vault-search', trimmed],
    queryFn: () => vaultSearch(trimmed, 100),
    enabled: trimmed.length > 1,
    staleTime: 2_000,
  });

  const visiblePaths = trimmed.length > 1 ? searchResults : allPaths;
  const grouped = useMemo(() => groupPathsByFolder(visiblePaths), [visiblePaths]);

  // Auto-select the first markdown when the list arrives, if nothing
  // selected yet. Avoids the empty-pane look on first mount.
  useEffect(() => {
    if (selected) return;
    const firstMd = visiblePaths.find((p) => p.endsWith('.md'));
    if (firstMd) setSelected(firstMd);
  }, [visiblePaths, selected]);

  const handleOpenInActive = useCallback(
    (path: string) => {
      const id = `vault:${path}`;
      const tab = {
        id,
        kind: 'vault-md' as const,
        title: baseName(path),
        vaultPath: path,
      };
      if (!activeInstanceId) {
        // Spawn a host instance so the tab has somewhere to live.
        createBlank('Vault');
      }
      openTab(tab, { activate: true });
    },
    [activeInstanceId, createBlank, openTab],
  );

  const handleOpenInNew = useCallback(
    (path: string) => {
      const inst = createBlank(baseName(path));
      const id = `vault:${path}`;
      openTab(
        {
          id,
          kind: 'vault-md',
          title: baseName(path),
          vaultPath: path,
        },
        { instanceId: inst.id, activate: true },
      );
    },
    [createBlank, openTab],
  );

  // Build a ViewerResource for the inline preview pane. Save handler
  // delegates to vault_write so edits persist to the actual file.
  const previewResource = useMemo(() => {
    if (!selected) return null;
    const base = resourceFromVaultPath(selected);
    return {
      ...base,
      onSave: async (content: string) => {
        const entry = await vaultRead(selected);
        await vaultWrite({
          path: selected,
          content,
          frontmatter: entry.frontmatter,
        });
        queryClient.invalidateQueries({ queryKey: ['vault-read', selected] });
      },
    };
  }, [selected, queryClient]);

  return (
    <div className={styles.shell}>
      <aside className={styles.tree}>
        <header className={styles.treeHeader}>
          <h1 className={styles.title}>Vault</h1>
          {rootPath && <p className={styles.rootPath} title={rootPath}>{rootPath}</p>}
          <input
            type="search"
            className={styles.search}
            placeholder="Search files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </header>
        <div className={styles.treeBody}>
          {listLoading ? (
            <p className={styles.muted}>Loading…</p>
          ) : grouped.length === 0 ? (
            <p className={styles.muted}>
              {trimmed.length > 1 ? 'No matches' : 'Vault is empty'}
            </p>
          ) : (
            grouped.map(({ folder, items }) => (
              <section key={folder} className={styles.folder}>
                <h2 className={styles.folderName}>{folder}</h2>
                <ul className={styles.fileList}>
                  {items.map((path) => (
                    <li key={path}>
                      <button
                        type="button"
                        className={styles.fileItem}
                        data-active={selected === path}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) {
                            handleOpenInNew(path);
                          } else {
                            setSelected(path);
                          }
                        }}
                        onDoubleClick={() => handleOpenInActive(path)}
                        title={path}
                      >
                        <span className={styles.fileName}>{baseName(path)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </aside>
      <main className={styles.preview}>
        {previewResource ? (
          <ViewerHost resource={previewResource} />
        ) : (
          <div className={styles.previewEmpty}>
            <p>Select a file to preview.</p>
          </div>
        )}
      </main>
      <aside className={styles.sidebar}>
        {selected && <BacklinksPanel path={selected} />}
      </aside>
    </div>
  );
};
