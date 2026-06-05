// NotesApp — composition root for the Notes workspace tab body.
//
// (ADR-002 substrate § vault v1 §8.6 v6, 2026-06-05 — bao 1:1 kairo
// UI fidelity revert; supersedes the 2026-06-02 v4 + 2026-06-03 v5
// kairo-parity batch that drifted away from upstream kairo v0.1.0
// by adding Daily / Health / Kanban / Diagram / Git views and a
// horizontal top action bar.)
//
// Sidebar-first 2-column shell matching the kairo v0.1.0 screenshot:
//
//   ┌──────────────────────────────────────────────────────┐
//   │ ┌────────────────┐ ┌───────────────────────┐ ┌─────┐ │
//   │ │ Vault: <root>  │ │ Editor (tab strip +   │ │Back │ │
//   │ │ [search ⌘K]    │ │ body)                 │ │links│ │
//   │ │ [Notes][Graph] │ │                       │ │     │ │
//   │ │ + New Note     │ │                       │ │     │ │
//   │ │ Vault Health ▸ │ │                       │ │     │ │
//   │ │ [Files][Tags]  │ │                       │ │     │ │
//   │ │ - note1.md     │ │                       │ │     │ │
//   │ │ - note2.md     │ │                       │ │     │ │
//   │ └────────────────┘ └───────────────────────┘ └─────┘ │
//   └──────────────────────────────────────────────────────┘
//
// Today / Review buttons (CTRL-specific quick actions) removed from
// UI per bao 2026-06-05 — Irisy can still trigger those flows via
// the underlying vault_* / vault_sourcing_* MCP tools.

import {
  useCallback,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { vaultRead, vaultWrite } from '@/lib/kernel';
import {
  loadDailyNotesConfig,
  renderDailyNotePath,
} from '@/lib/vault-conventions';
import { NotesTree } from './NotesTree';
import { NotesEditor } from './NotesEditor';
import { NotesBacklinks } from './NotesBacklinks';
import { NotesTabBar } from './NotesTabBar';
import { TemplatesModal } from './TemplatesModal';
import { TagsPanel } from './TagsPanel';
import { VaultHealthFold } from './VaultHealthFold';
import styles from './Notes.module.css';

// GraphView intentionally not mounted here — bao 2026-06-05: kairo
// shows Notes/Graph as in-sidebar nav, but CTRL already has L1
// PrimaryRail + an L2 slot reserved in app.tsx ([Tab | L2 | L1 |
// Irisy]). Surfacing Graph as a second sidebar button duplicates
// navigation and steals 32 px from the workspace. Graph rendering
// lives at `./GraphView` and Irisy / a future L2 sub-nav (ADR-003
// frontend §7.5) can mount it without the in-sidebar toggle.

const renderDailyTemplate = (raw: string): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return raw.replace(/\{\{date\}\}/g, `${y}-${m}-${day}`);
};

type LeftPane = 'files' | 'tags';

interface OpenTab {
  path: string;
  dirty: boolean;
}

export const NotesApp = (): ReactElement => {
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [leftPane, setLeftPane] = useState<LeftPane>('files');
  const [busy, setBusy] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const refetchTree = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vault-list'] });
  }, [queryClient]);

  const openNoteTab = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev;
      return [...prev, { path, dirty: false }];
    });
  }, []);

  const closeNoteTab = useCallback(
    (path: string) => {
      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === path);
        if (idx < 0) return prev;
        const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        if (selectedPath === path) {
          const fallback = next[idx] ?? next[idx - 1] ?? null;
          setSelectedPath(fallback ? fallback.path : null);
        }
        return next;
      });
    },
    [selectedPath],
  );

  const handleSelect = useCallback(
    (path: string) => {
      openNoteTab(path);
    },
    [openNoteTab],
  );

  const handleNew = useCallback(() => {
    setTemplatesOpen(true);
  }, []);

  const handleTemplateCreated = useCallback(
    (path: string) => {
      refetchTree();
      openNoteTab(path);
    },
    [refetchTree, openNoteTab],
  );

  // Quick `Today` shortcut — kairo doesn't expose this as a button, but
  // we keep the handler wired so Irisy / a future keycap can invoke
  // "open today's daily note" without re-implementing the template
  // resolution.
  const openToday = useCallback(async () => {
    setBusy(true);
    try {
      const cfg = await loadDailyNotesConfig();
      const path = renderDailyNotePath(cfg.pathTemplate);
      let exists = false;
      try {
        await vaultRead(path);
        exists = true;
      } catch {
        exists = false;
      }
      if (!exists) {
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
          refetchTree();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('notes today create failed', err);
          return;
        }
      }
      openNoteTab(path);
    } finally {
      setBusy(false);
    }
  }, [refetchTree, openNoteTab]);
  void openToday;

  return (
    <div className={styles.shell}>
      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onCreated={handleTemplateCreated}
      />
      <div className={styles.cols}>
        <aside className={styles.leftCol} aria-label="Notes sidebar">
          <input
            type="search"
            className={styles.sidebarSearch}
            placeholder="Search notes…"
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              setQuery(e.target.value)
            }
            aria-label="Search notes"
          />
          <button
            type="button"
            className={styles.sidebarNewBtn}
            onClick={handleNew}
            disabled={busy}
          >
            + New Note
          </button>
          <VaultHealthFold />
          <div
            className={styles.leftPaneToggle}
            role="tablist"
            aria-label="Left pane"
          >
            <button
              type="button"
              role="tab"
              aria-selected={leftPane === 'files'}
              className={styles.leftPaneToggleBtn}
              data-active={leftPane === 'files' || undefined}
              onClick={() => setLeftPane('files')}
            >
              Files
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={leftPane === 'tags'}
              className={styles.leftPaneToggleBtn}
              data-active={leftPane === 'tags' || undefined}
              onClick={() => setLeftPane('tags')}
            >
              Tags
            </button>
          </div>
          {leftPane === 'files' ? (
            <NotesTree
              query={query}
              selectedPath={selectedPath}
              onSelect={handleSelect}
              tagFilter={tagFilter}
            />
          ) : (
            <TagsPanel selected={tagFilter} onSelect={setTagFilter} />
          )}
        </aside>
        <div className={styles.centerCol}>
          <NotesTabBar
            tabs={openTabs}
            activePath={selectedPath}
            onSelect={setSelectedPath}
            onClose={closeNoteTab}
          />
          <NotesEditor path={selectedPath} />
        </div>
        <NotesBacklinks path={selectedPath} onSelect={handleSelect} />
      </div>
    </div>
  );
};
