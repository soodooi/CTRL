// L2 Vault navigator — mounts in the shell's L2 column when the user
// picks the Vault item on L1.
//
// (ADR-002 substrate § vault v1 §8.6, 2026-06-01 — memory
// `decision_vault_adr_002_section_8`.)
//
// Surface: search box + "+ Note" + "Today" Daily-Note shortcut + folder-
// grouped tree of every `.md` file under the vault root. Clicking a row
// opens a `vault-md` workspace tab in the active instance (Cmd / Ctrl
// click forks a new instance).
//
// Daily Note path comes from the feature layer (vault/.ctrl/daily-notes.yaml)
// — until that config lands, the shortcut falls back to the
// `daily/YYYY-MM-DD.md` convention. The kernel never knows about
// "Daily Note" per §8.4.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  vaultList,
  vaultRead,
  vaultRootPath,
  vaultSearch,
  vaultSourcingPending,
  vaultSourcingRun,
  vaultWrite,
} from '@/lib/kernel';
import { useWorkspaceStore } from '@/lib/workspace-store';
// ADR-002 § vault v1 §8.4 — Daily Note path + review-queue path
// come from the vault-internal yaml convention, not from kernel-baked
// rules.
import {
  loadDailyNotesConfig,
  loadSourcingConfig,
  renderDailyNotePath,
  renderReviewQueuePath,
} from '@/lib/vault-conventions';
import styles from './L2VaultPanel.module.css';

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

interface FolderGroup {
  folder: string;
  items: string[];
}

const groupPathsByFolder = (
  paths: ReadonlyArray<string>,
): FolderGroup[] => {
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

// Daily Note path resolution lives in vault-conventions per §8.4;
// the local helper is retained only as the last-resort fallback when
// the user's `.ctrl/daily-notes.yaml` is unreadable.

const renderDailyTemplate = (raw: string): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return raw.replace(/\{\{date\}\}/g, `${y}-${m}-${day}`);
};

export const L2VaultPanel = (): ReactElement => {
  const openTab = useWorkspaceStore((s) => s.openTab);
  const createBlank = useWorkspaceStore((s) => s.createBlank);
  const activeInstanceId = useWorkspaceStore((s) => s.activeInstanceId);
  const [query, setQuery] = useState('');
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [newNotePath, setNewNotePath] = useState('notes/');
  const [reviewBusy, setReviewBusy] = useState(false);

  // Poll the inbox size every 8 s so the badge reflects keycap drops
  // without paying the cost of vault_watch event subscription here.
  const { data: pending } = useQuery({
    queryKey: ['vault-sourcing-pending'],
    queryFn: () => vaultSourcingPending(),
    refetchInterval: 8_000,
    staleTime: 4_000,
  });
  const inboxCount = pending?.count ?? 0;

  const { data: rootPath } = useQuery({
    queryKey: ['vault-root'],
    queryFn: vaultRootPath,
    staleTime: Infinity,
  });

  const { data: allPaths = [], isLoading: listLoading, refetch } = useQuery({
    queryKey: ['vault-list'],
    queryFn: () => vaultList(),
    staleTime: 5_000,
  });

  const trimmed = query.trim();
  const { data: searchResults = [] } = useQuery({
    queryKey: ['vault-search', trimmed],
    queryFn: () => vaultSearch(trimmed, 100),
    enabled: trimmed.length > 1,
    staleTime: 2_000,
  });

  const visiblePaths = trimmed.length > 1 ? searchResults : allPaths;
  const grouped = useMemo(() => groupPathsByFolder(visiblePaths), [visiblePaths]);

  const openPath = useCallback(
    (path: string, newInstance: boolean) => {
      const id = `vault:${path}`;
      const tab = {
        id,
        kind: 'vault-md' as const,
        title: baseName(path),
        vaultPath: path,
      };
      if (newInstance || !activeInstanceId) {
        const inst = createBlank(baseName(path));
        openTab(tab, { instanceId: inst.id, activate: true });
      } else {
        openTab(tab, { activate: true });
      }
    },
    [activeInstanceId, createBlank, openTab],
  );

  const handleNew = useCallback(() => {
    setNewNoteOpen(true);
    setNewNotePath('notes/untitled.md');
  }, []);

  const commitNew = useCallback(async () => {
    const path = newNotePath.trim();
    if (!path) return;
    const safe = path.endsWith('.md') ? path : `${path}.md`;
    try {
      await vaultWrite({
        path: safe,
        content: '',
        frontmatter: { created: new Date().toISOString() },
      });
      setNewNoteOpen(false);
      await refetch();
      openPath(safe, false);
    } catch (err) {
      // Surface inline error — minimal UI, not a toast (the L2 column
      // doesn't host portal anchors).
      // eslint-disable-next-line no-console
      console.warn('vault new note failed', err);
    }
  }, [newNotePath, openPath, refetch]);

  const openSourcingReview = useCallback(
    (reviewPath: string) => {
      const id = `sourcing-review:${reviewPath}`;
      const tab = {
        id,
        kind: 'sourcing-review' as const,
        title: 'Sourcing review',
        reviewPath,
      };
      if (!activeInstanceId) {
        const inst = createBlank('Sourcing review');
        openTab(tab, { instanceId: inst.id, activate: true });
      } else {
        openTab(tab, { activate: true });
      }
    },
    [activeInstanceId, createBlank, openTab],
  );

  // Sourcing badge handler — run the kernel routine then open the
  // workspace review tab. Uses the sourcing yaml convention so the
  // path matches the file the user actually edited.
  const handleSourcingReview = useCallback(async () => {
    setReviewBusy(true);
    try {
      const cfg = await loadSourcingConfig();
      const today = new Date();
      const reviewPath = renderReviewQueuePath(cfg.reviewQueuePath, today);
      const yyyy = String(today.getFullYear());
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      await vaultSourcingRun(`${yyyy}-${mm}-${dd}`);
      await refetch();
      openSourcingReview(reviewPath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('sourcing review trigger failed', err);
    } finally {
      setReviewBusy(false);
    }
  }, [openSourcingReview, refetch]);

  const handleToday = useCallback(async () => {
    const cfg = await loadDailyNotesConfig();
    const path = renderDailyNotePath(cfg.pathTemplate);
    if (!allPaths.includes(path)) {
      // Pre-fill the body from the template if the user has one;
      // missing template -> empty body. Frontmatter defaults come
      // straight from the yaml — `decision_vault_adr_002_section_8`
      // keeps that policy outside kernel.
      let body = '';
      try {
        const t = await vaultRead(cfg.template);
        body = renderDailyTemplate(typeof t.body === 'string' ? t.body : '');
      } catch {
        body = '';
      }
      try {
        await vaultWrite({
          path,
          content: body,
          frontmatter: cfg.frontmatterDefault,
        });
        await refetch();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('vault daily note create failed', err);
        return;
      }
    }
    openPath(path, false);
  }, [allPaths, openPath, refetch]);

  // template placeholder substitution — `{{date}}` is the only one
  // we render today. Future placeholders (`{{title}}`, `{{tags}}`)
  // land in the same helper to keep substitution centralised.

  // Auto-collapse new-note row if the user navigates away.
  useEffect(() => {
    if (!newNoteOpen) return;
    const timer = setTimeout(() => undefined, 0);
    return () => clearTimeout(timer);
  }, [newNoteOpen]);

  return (
    <aside className={styles.panel} aria-label="Vault navigator">
      <header className={styles.header}>
        <h2 className={styles.title}>Vault</h2>
        {rootPath ? (
          <p className={styles.rootPath} title={rootPath}>
            {rootPath}
          </p>
        ) : null}
        <input
          type="search"
          className={styles.search}
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.action}
            onClick={handleNew}
            title="New note"
          >
            + Note
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => void handleToday()}
            title="Open today's daily note"
          >
            Today
          </button>
        </div>
        <button
          type="button"
          className={styles.reviewBadge}
          data-pending={inboxCount > 0 || undefined}
          onClick={() => void handleSourcingReview()}
          disabled={reviewBusy}
          title="Review the sourcing inbox"
        >
          <span className={styles.reviewLabel}>Review</span>
          <span className={styles.reviewCount}>{inboxCount}</span>
        </button>
        {newNoteOpen ? (
          <div className={styles.newNoteRow}>
            <input
              type="text"
              className={styles.search}
              value={newNotePath}
              autoFocus
              onChange={(e) => setNewNotePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitNew();
                if (e.key === 'Escape') setNewNoteOpen(false);
              }}
            />
          </div>
        ) : null}
      </header>
      <div className={styles.body}>
        {listLoading ? (
          <p className={styles.muted}>Loading…</p>
        ) : grouped.length === 0 ? (
          <p className={styles.muted}>
            {trimmed.length > 1 ? 'No matches' : 'Vault is empty'}
          </p>
        ) : (
          grouped.map(({ folder, items }) => (
            <section key={folder} className={styles.folder}>
              <h3 className={styles.folderName}>{folder}</h3>
              <ul className={styles.list}>
                {items.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className={styles.item}
                      onClick={(e) => openPath(path, e.metaKey || e.ctrlKey)}
                      title={path}
                    >
                      <span className={styles.itemName}>{stem(baseName(path))}</span>
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
