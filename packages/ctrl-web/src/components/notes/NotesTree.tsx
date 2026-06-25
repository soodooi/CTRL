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

import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  vaultDelete,
  vaultList,
  vaultMove,
  vaultNotesByTag,
  vaultRename,
  vaultRootPath,
  vaultSearch,
  vaultSemanticSearch,
} from '@/lib/kernel';
import styles from './Notes.module.css';

/** Structural change emitted after a file operation so the parent can
 *  keep its open tabs / selection in sync with disk. */
export type PathMutation =
  | { kind: 'delete'; path: string }
  | { kind: 'rename' | 'move'; from: string; to: string };

interface NotesTreeProps {
  query: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** When set, the tree restricts to notes tagged with this value
   *  via `vault_notes_by_tag`. */
  tagFilter?: string | null;
  /** Called after a rename / move / delete so the parent can update its
   *  open tabs and selection (the tree owns the file-op UI, the parent
   *  owns the workspace tabs). */
  onPathMutated?: (change: PathMutation) => void;
}

/** Parent directory of a vault-relative path (`''` for root files). */
const parentDir = (p: string): string => {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : '';
};

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

/**
 * Top-level paths that are CTRL substrate rather than user notes. They
 * exist in the vault root so vim / Finder / Obsidian can see them
 * (philosophy: vault is plain-text substrate), but they pollute the
 * Notes app left tree because they are tools-talking-to-tools data, not
 * stuff the user is writing into. Hidden by default; toggleable via
 * `Show system folders`.
 *
 * Keep this list in lockstep with the seed dirs created in
 * `src-tauri/src/kernel/vault.rs::ensure_vault_layout` +
 * `seed_vault_feature_layer` so we never accidentally surface a new
 * substrate dir as a "note folder".
 */
const SYSTEM_TOP_LEVEL = new Set([
  '.ctrl',           // config / sourcing.yaml / daily-notes.yaml
  '.irisy-memory',   // Irisy persistent yaml memory
  '.irisy-prompts',  // Irisy prompt cache
  '.irisy-sessions', // Irisy past sessions
  'irisy',           // Irisy state (SOUL.md will land in here per ADR-005 §4)
  'mcps',         // mcp builtin resources (substrate)
  'assets',          // images/audio/pdf/attachments — handled via attachment viewer
]);

const isSystemPath = (p: string): boolean => {
  const slash = p.indexOf('/');
  const top = slash >= 0 ? p.slice(0, slash) : p;
  return SYSTEM_TOP_LEVEL.has(top);
};

/**
 * Group by the **last directory segment** so a path like
 * `irisy/sub/README.md` lands in a group named `irisy/sub` instead of
 * `irisy` (which would collapse multiple READMEs from different
 * sub-folders into one bucket and lose the disambiguating folder).
 * Root-level files (no `/`) land in a `(root)` bucket.
 *
 * `extraEmptyFolders` lets the caller surface user-level folders even
 * when they contain no `.md` files yet — e.g. an empty `sourcing/` that
 * should still appear so the user knows where the kernel will drop
 * unintegrated input.
 */
const groupByFolder = (
  paths: ReadonlyArray<string>,
  showSystem: boolean,
  extraEmptyFolders: ReadonlyArray<string>,
): FolderGroup[] => {
  const buckets = new Map<string, string[]>();
  for (const p of paths) {
    if (!showSystem && isSystemPath(p)) continue;
    const lastSlash = p.lastIndexOf('/');
    const folder = lastSlash >= 0 ? p.slice(0, lastSlash) : '(root)';
    const list = buckets.get(folder) ?? [];
    list.push(p);
    buckets.set(folder, list);
  }
  for (const f of extraEmptyFolders) {
    if (!buckets.has(f)) buckets.set(f, []);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, items]) => ({ folder, items: items.sort() }));
};

/** User-level top-level folders that should appear in the tree even
 *  when empty, so the user sees the canonical layout up-front. */
const USER_TOP_LEVEL_FOLDERS = [
  'notes',
  'daily',
  'sourcing',
  'templates',
] as const;

export const NotesTree = ({
  query,
  selectedPath,
  onSelect,
  tagFilter,
  onPathMutated,
}: NotesTreeProps): ReactElement => {
  const queryClient = useQueryClient();

  // File-operation UI state. The tree is the natural home for rename /
  // move / delete because it owns the right-click target and the path
  // list; mutations bubble up via `onPathMutated` so the workspace tabs
  // stay in sync. (Wires vault_rename / vault_move / vault_delete —
  // backend was ready, no UI surfaced them before.)
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  // Collapsible folders: a 120-file flat dump reads as "messy". Folders the user
  // explicitly toggled live here; by default a folder is collapsed unless it is
  // (root), holds the open note, or a search is active (notes-module-plan §5).
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const toggleFolder = (folder: string): void =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  // Dismiss the context menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Surface op errors instead of failing silently (was a real
  // breakpoint — frontmatter / editor errors only hit console.warn).
  useEffect(() => {
    if (!opError) return;
    const t = window.setTimeout(() => setOpError(null), 4000);
    return () => window.clearTimeout(t);
  }, [opError]);

  const openMenu = (e: ReactMouseEvent, path: string): void => {
    e.preventDefault();
    setConfirmDelete(null);
    setMenu({ path, x: e.clientX, y: e.clientY });
  };

  const submitRename = async (from: string, raw: string): Promise<void> => {
    const to = raw.trim();
    setRenaming(null);
    if (!to || to === from) return;
    try {
      // Same folder → rename; different folder → move. The kernel
      // accepts a full vault-relative path for both, so editing the
      // path string covers Obsidian-style "rename = move".
      if (parentDir(to) === parentDir(from)) await vaultRename(from, to);
      else await vaultMove(from, to);
      await queryClient.invalidateQueries({ queryKey: ['vault-list'] });
      onPathMutated?.({
        kind: parentDir(to) === parentDir(from) ? 'rename' : 'move',
        from,
        to,
      });
    } catch (e) {
      setOpError(`Rename failed: ${String(e)}`);
    }
  };

  const doDelete = async (path: string): Promise<void> => {
    setConfirmDelete(null);
    setMenu(null);
    try {
      await vaultDelete(path);
      await queryClient.invalidateQueries({ queryKey: ['vault-list'] });
      onPathMutated?.({ kind: 'delete', path });
    } catch (e) {
      setOpError(`Delete failed: ${String(e)}`);
    }
  };

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
  // Hybrid search (ADR-002 v5 §10.5) — BM25 always runs; semantic
  // search adds embeddings-based candidates when the query is long
  // enough to be a "natural language" query (>= 4 chars). Results are
  // merged, deduped, BM25 first then semantic-only candidates.
  const { data: searchHits = [] } = useQuery({
    queryKey: ['vault-hybrid-search', trimmed],
    queryFn: async () => {
      const bm25 = await vaultSearch(trimmed, 60);
      if (trimmed.length < 4) return bm25;
      const semantic = await vaultSemanticSearch(trimmed, 20).catch(() => []);
      const seen = new Set(bm25);
      const extra = semantic.map((h) => h.path).filter((p) => !seen.has(p));
      return [...bm25, ...extra].slice(0, 100);
    },
    enabled: trimmed.length > 1 && !tagFilter,
    staleTime: 2_000,
  });

  const { data: tagHits = [] } = useQuery({
    queryKey: ['vault-tag-notes', tagFilter],
    queryFn: () => (tagFilter ? vaultNotesByTag(tagFilter) : Promise.resolve([])),
    enabled: !!tagFilter,
    staleTime: 5_000,
  });

  const [showSystem, setShowSystem] = useState(false);

  // Resolution order: tag filter wins (kairo parity), then search,
  // then full list. Search + tag can't combine yet — that's a
  // future ANDed filter once the kernel exposes a join command.
  const visiblePaths = tagFilter
    ? tagHits
    : trimmed.length > 1
    ? searchHits
    : allPaths;
  // Empty user-level dirs are only injected when there is literally
  // NO user content yet — otherwise listing them creates 4 always-
  // visible "Empty" rows even when the user only writes into notes/.
  // bao 2026-06-03 reported this as the main "tree feels cluttered"
  // offender, so once any user content lands the placeholders retire.
  const isFiltered = !!tagFilter || trimmed.length > 1;
  const userHasContent = allPaths.some((p) => !isSystemPath(p));
  const grouped = useMemo(
    () => groupByFolder(
      visiblePaths,
      showSystem,
      isFiltered || userHasContent ? [] : USER_TOP_LEVEL_FOLDERS,
    ),
    [visiblePaths, showSystem, isFiltered, userHasContent],
  );

  return (
    <aside className={styles.tree} aria-label="Notes tree">
      <header className={styles.treeHeader}>
        <h2 className={styles.treeTitle}>Notes</h2>
        {rootPath ? (
          <p className={styles.treeRoot} title={rootPath}>
            {rootPath}
          </p>
        ) : null}
        <label className={styles.treeSystemToggle} title="Show CTRL system folders (.ctrl, irisy, mcps, …)">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
          />
          <span>Show system folders</span>
        </label>
      </header>
      <div className={styles.treeBody}>
        {trimmed.length === 1 && !tagFilter ? (
          <p className={styles.muted}>
            Keep typing to search — semantic match adds in at 4 characters.
          </p>
        ) : null}
        {isLoading ? (
          <p className={styles.muted}>Loading…</p>
        ) : grouped.length === 0 ? (
          <p className={styles.muted}>
            {trimmed.length > 1
              ? 'No matches — try fewer or different words.'
              : 'No notes yet — press ⌘P or “+ New Note” to start.'}
          </p>
        ) : (
          grouped.map(({ folder, items }) => {
            const open =
              isFiltered ||
              folder === '(root)' ||
              (selectedPath != null && selectedPath.startsWith(folder + '/'))
                ? !toggled.has(folder)
                : toggled.has(folder);
            return (
            <section key={folder} className={styles.folder} data-open={open || undefined}>
              <button
                type="button"
                className={styles.folderName}
                onClick={() => toggleFolder(folder)}
                aria-expanded={open}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span aria-hidden style={{ width: 10, opacity: 0.55 }}>
                  {open ? '▾' : '▸'}
                </span>
                {folder}
                <span style={{ marginLeft: 'auto', opacity: 0.4, fontSize: '0.85em' }}>
                  {items.length}
                </span>
              </button>
              {open &&
                (items.length === 0 ? (
                <p className={styles.folderEmpty}>Empty</p>
              ) : (
                <ul className={styles.fileList}>
                  {items.map((path) => (
                    <li key={path}>
                      {renaming === path ? (
                        <input
                          className={styles.renameInput}
                          autoFocus
                          defaultValue={path}
                          aria-label="Rename or move note"
                          onFocus={(e) => {
                            // Pre-select the basename stem so a quick
                            // rename overwrites just the name, while the
                            // folder path stays editable for a move.
                            const v = e.target.value;
                            const start = v.lastIndexOf('/') + 1;
                            const dot = v.lastIndexOf('.');
                            e.target.setSelectionRange(
                              start,
                              dot > start ? dot : v.length,
                            );
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter')
                              void submitRename(path, e.currentTarget.value);
                            else if (e.key === 'Escape') setRenaming(null);
                          }}
                          onBlur={(e) => void submitRename(path, e.target.value)}
                        />
                      ) : (
                        <button
                          type="button"
                          className={styles.fileItem}
                          data-active={selectedPath === path || undefined}
                          onClick={() => onSelect(path)}
                          onContextMenu={(e) => openMenu(e, path)}
                          title={`${path} — right-click for actions`}
                        >
                          <span className={styles.fileName}>{stem(baseName(path))}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ))}
            </section>
            );
          })
        )}
      </div>
      {opError ? (
        <p className={styles.treeError} role="alert">
          {opError}
        </p>
      ) : null}
      {menu ? (
        <div
          className={styles.contextMenu}
          style={{ top: menu.y, left: menu.x }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {confirmDelete === menu.path ? (
            <>
              <div className={styles.contextMenuLabel}>
                Delete “{stem(baseName(menu.path))}”?
              </div>
              <button
                type="button"
                className={styles.contextMenuItem}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.contextMenuDanger}
                onClick={() => void doDelete(menu.path)}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.contextMenuItem}
                onClick={() => {
                  setRenaming(menu.path);
                  setMenu(null);
                }}
              >
                Rename / move…
              </button>
              <button
                type="button"
                className={styles.contextMenuDanger}
                onClick={() => setConfirmDelete(menu.path)}
              >
                Delete…
              </button>
            </>
          )}
        </div>
      ) : null}
    </aside>
  );
};
