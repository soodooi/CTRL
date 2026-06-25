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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  vaultList,
  vaultRead,
  vaultWrite,
} from '@/lib/kernel';
import {
  loadDailyNotesConfig,
  renderDailyNotePath,
} from '@/lib/vault-conventions';
import { NotesTree, type PathMutation } from './NotesTree';
import { NotesEditor } from './NotesEditor';
import { NotesBacklinks } from './NotesBacklinks';
import { NotesTabBar } from './NotesTabBar';
import { TemplatesModal } from './TemplatesModal';
import { TagsPanel } from './TagsPanel';
import { VaultHealthFold } from './VaultHealthFold';
import styles from './Notes.module.css';

// Notes is a THIN KB layer (vault/ctrl/notes-module-plan.md + ADR-003 v9): a
// viewer + navigation over the plain-markdown vault, not an Obsidian clone.
// Graph view + a command palette belong to Obsidian (open-in-Obsidian), so they
// are deliberately not reimplemented here.

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
  // Simplified layout (bao 2026-06-12): L2 file tree + backlinks collapse into
  // toolbar toggles so the editor gets the room. L2 is CLOSED by default
  // (bao 2026-06-12: anti-Trae — don't slam four zones on the user at once).
  // Notes is a knowledge-base MANAGEMENT surface (ADR-003 §5 three-pane:
  // Tree + content + Backlinks), not the minimal morphing home — so the file
  // tree is persistent by default (☰ can still hide it). A KB manager needs the
  // folder hierarchy always in view; the find/new/recent home is the empty state.
  const [treeOpen, setTreeOpen] = useState(true);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const refetchTree = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vault-list'] });
  }, [queryClient]);

  // Recent notes for the knowledge-base home. L2 is closed by default, so the
  // home itself must let the user find/open a note without the tree. We reuse
  // the same ['vault-list'] query the tree uses, drop CTRL system paths, and
  // surface the first few as quick re-entry points (NotebookLM-style "jump
  // back in" — never a blank canvas).
  const { data: allPaths = [] } = useQuery({
    queryKey: ['vault-list'],
    queryFn: () => vaultList(),
    staleTime: 5_000,
  });
  const SYSTEM_TOP = [
    '.ctrl',
    '.irisy-memory',
    '.irisy-prompts',
    '.irisy-sessions',
    'irisy',
    'mcps',
    'assets',
  ];
  const recentNotes = allPaths
    .filter((p) => !SYSTEM_TOP.includes(p.split('/')[0] ?? ''))
    .slice(0, 6);

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

  // Keep the workspace tabs + selection in sync when the tree renames,
  // moves, or deletes a file on disk (the tree owns the file-op UI).
  const handlePathMutated = useCallback((change: PathMutation) => {
    if (change.kind === 'delete') {
      setOpenTabs((prev) => prev.filter((t) => t.path !== change.path));
      setSelectedPath((cur) => (cur === change.path ? null : cur));
    } else {
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.path === change.from ? { ...t, path: change.to } : t,
        ),
      );
      setSelectedPath((cur) => (cur === change.from ? change.to : cur));
    }
  }, []);

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
  // we keep the handler wired so Irisy / a future mcp can invoke
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
          body = renderDailyTemplate(typeof t.content === 'string' ? t.content : '');
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
        {treeOpen && (
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
                onPathMutated={handlePathMutated}
              />
            ) : (
              <TagsPanel selected={tagFilter} onSelect={setTagFilter} />
            )}
          </aside>
        )}
        <div className={styles.centerCol}>
          <div className={styles.notesToolbar}>
            <button
              type="button"
              className={styles.toolBtn}
              data-on={treeOpen || undefined}
              onClick={() => setTreeOpen((v) => !v)}
              title="Files"
              aria-label="Toggle files"
            >
              ☰
            </button>
            <div className={styles.toolbarTabs}>
              <NotesTabBar
                tabs={openTabs}
                activePath={selectedPath}
                onSelect={setSelectedPath}
                onClose={closeNoteTab}
              />
            </div>
            <button
              type="button"
              className={styles.toolBtn}
              data-on={backlinksOpen || undefined}
              onClick={() => setBacklinksOpen((v) => !v)}
              title="Backlinks"
              aria-label="Toggle backlinks"
            >
              ↩
            </button>
          </div>
          {selectedPath ? (
            <NotesEditor path={selectedPath} />
          ) : (
            <section className={styles.kbHome} aria-label="Knowledge base">
              <div className={styles.kbHomeInner}>
                <h2 className={styles.kbTitle}>Your knowledge base</h2>
                <p className={styles.kbSub}>
                  Plain markdown on your machine — yours to keep. Search it, open a
                  note, or start a new one. Ask Irisy on the left to work with it.
                </p>
                <input
                  type="search"
                  className={styles.kbSearch}
                  placeholder="Search your notes…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setTreeOpen(true);
                  }}
                  aria-label="Search notes"
                />
                <div className={styles.kbActions}>
                  <button type="button" className={styles.kbNew} onClick={handleNew}>
                    + New note
                  </button>
                  <button
                    type="button"
                    className={styles.kbBrowse}
                    onClick={() => setTreeOpen(true)}
                  >
                    Browse all notes
                  </button>
                </div>
                {recentNotes.length > 0 && (
                  <div className={styles.kbRecent}>
                    <div className={styles.kbRecentLabel}>Jump back in</div>
                    <div className={styles.kbRecentList}>
                      {recentNotes.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={styles.kbRecentItem}
                          onClick={() => openNoteTab(p)}
                          title={p}
                        >
                          {p.replace(/\.md$/, '').split('/').pop()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
        {backlinksOpen && (
          <NotesBacklinks path={selectedPath} onSelect={handleSelect} />
        )}
      </div>
    </div>
  );
};
