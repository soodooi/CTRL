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

import { useMemo, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  vaultList,
  vaultNotesByTag,
  vaultRootPath,
  vaultSearch,
} from '@/lib/kernel';
import styles from './Notes.module.css';

interface NotesTreeProps {
  query: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  /** When set, the tree restricts to notes tagged with this value
   *  via `vault_notes_by_tag`. */
  tagFilter?: string | null;
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
  'keycaps',         // keycap builtin resources (substrate)
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
        <label className={styles.treeSystemToggle} title="Show CTRL system folders (.ctrl, irisy, keycaps, …)">
          <input
            type="checkbox"
            checked={showSystem}
            onChange={(e) => setShowSystem(e.target.checked)}
          />
          <span>Show system folders</span>
        </label>
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
              {items.length === 0 ? (
                <p className={styles.folderEmpty}>Empty</p>
              ) : (
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
              )}
            </section>
          ))
        )}
      </div>
    </aside>
  );
};
