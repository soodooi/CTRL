// NotesApp — composition root for the Notes workspace tab body.
//
// (ADR-002 substrate § vault v1 §8.6 v4, 2026-06-02 — bao 2026-06-02
// realignment: Vault is substrate, Notes is the L1 app; memory
// `decision_vault_adr_002_section_8`.)
//
// 3-column shell:
//
//   ┌────────────────────────────────────────────────────────┐
//   │ Actions: [search] [+ Note] [Today] [Review N]          │
//   ├────────┬──────────────────────────────┬────────────────┤
//   │ Side   │ Editor (tab strip + body)    │ Backlinks      │
//   │ 220px  │ 1fr                          │ 220px          │
//   └────────┴──────────────────────────────┴────────────────┘
//
// bao 2026-06-03 (kairo-parity batch): left sidebar gets a Files/Tags
// toggle (no more dual-stacked panel), the center column carries an
// open-notes tab strip + bottom status bar, and the editor sprouts a
// kairo-style toolbar. State that used to live as separate UI panes
// (TagsPanel + NotesTree) now coalesces under a single `leftPane`
// switch — kairo's "Files | Tags" affordance.

import {
  useCallback,
  useState,
  type ReactElement,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  vaultRead,
  vaultSourcingPending,
  vaultSourcingRun,
  vaultWrite,
} from '@/lib/kernel';
import { useWorkspaceStore } from '@/lib/workspace-store';
import {
  loadDailyNotesConfig,
  loadSourcingConfig,
  renderDailyNotePath,
  renderReviewQueuePath,
} from '@/lib/vault-conventions';
import { lazy, Suspense } from 'react';
import { NotesActions } from './NotesActions';
import { NotesTree } from './NotesTree';
import { NotesEditor } from './NotesEditor';
import { NotesBacklinks } from './NotesBacklinks';
import { NotesTabBar } from './NotesTabBar';
import { TemplatesModal } from './TemplatesModal';
import { TagsPanel } from './TagsPanel';
import { ViewSwitcher, type NotesView } from './ViewSwitcher';
import styles from './Notes.module.css';

// Lazy-load Graph view so the force-graph runtime doesn't pull into
// the PWA cold-start bundle (ADR-002 § crypto v1 ≤ 200 KB gzip
// critical path).
const GraphView = lazy(() =>
  import('./GraphView').then((m) => ({ default: m.GraphView })),
);

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
  const [view, setView] = useState<NotesView>('editor');
  const queryClient = useQueryClient();
  const openSysTab = useWorkspaceStore((s) => s.openTab);
  const activeInstanceId = useWorkspaceStore((s) => s.activeInstanceId);
  const createBlank = useWorkspaceStore((s) => s.createBlank);

  // Inbox-pending count for the Review badge — polled every 8 s.
  const { data: pending } = useQuery({
    queryKey: ['vault-sourcing-pending'],
    queryFn: () => vaultSourcingPending(),
    refetchInterval: 8_000,
    staleTime: 4_000,
  });
  const reviewCount = pending?.count ?? 0;

  const refetchTree = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['vault-list'] });
  }, [queryClient]);

  /** Pin a note into the open-tab strip and select it. Re-opening an
   *  already-open path just selects it (no duplicate tab). */
  const openNoteTab = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev;
      return [...prev, { path, dirty: false }];
    });
  }, []);

  /** Close a note tab. If we just closed the active note, fall back
   *  to the right-neighbor (or empty state when none remain). */
  const closeNoteTab = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx < 0) return prev;
      const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      // Adjust selection
      if (selectedPath === path) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        setSelectedPath(fallback ? fallback.path : null);
      }
      return next;
    });
  }, [selectedPath]);

  const handleSelect = useCallback((path: string) => {
    openNoteTab(path);
  }, [openNoteTab]);

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

  const handleToday = useCallback(async () => {
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

  const handleReview = useCallback(async () => {
    setBusy(true);
    try {
      const cfg = await loadSourcingConfig();
      const today = new Date();
      const reviewPath = renderReviewQueuePath(cfg.reviewQueuePath, today);
      const yyyy = String(today.getFullYear());
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      await vaultSourcingRun(`${yyyy}-${mm}-${dd}`);
      refetchTree();
      // Open the review queue as a sourcing-review tab in the active
      // workspace instance (creates a host instance if none yet).
      const id = `sourcing-review:${reviewPath}`;
      const tab = {
        id,
        kind: 'sourcing-review' as const,
        title: 'Sourcing review',
        reviewPath,
      };
      if (!activeInstanceId) {
        const inst = createBlank('Sourcing review');
        openSysTab(tab, { instanceId: inst.id, activate: true });
      } else {
        openSysTab(tab, { activate: true });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('notes review failed', err);
    } finally {
      setBusy(false);
    }
  }, [activeInstanceId, createBlank, openSysTab, refetchTree]);

  return (
    <div className={styles.shell}>
      <NotesActions
        query={query}
        onQueryChange={setQuery}
        onNew={handleNew}
        onToday={() => void handleToday()}
        onReview={() => void handleReview()}
        reviewCount={reviewCount}
        busy={busy}
        selectedPath={selectedPath}
      />
      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onCreated={handleTemplateCreated}
      />
      <ViewSwitcher
        active={view}
        onChange={(next) => {
          setView(next);
        }}
      />
      <div className={styles.cols}>
        <div className={styles.leftCol}>
          <div className={styles.leftPaneToggle} role="tablist" aria-label="Left pane">
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
        </div>
        <div className={styles.centerCol}>
          {view === 'editor' ? (
            <>
              <NotesTabBar
                tabs={openTabs}
                activePath={selectedPath}
                onSelect={setSelectedPath}
                onClose={closeNoteTab}
              />
              <NotesEditor path={selectedPath} />
            </>
          ) : (
            <Suspense
              fallback={<div className={styles.viewFallback}>Loading view…</div>}
            >
              <GraphView focusPath={selectedPath} onSelect={handleSelect} />
            </Suspense>
          )}
        </div>
        <NotesBacklinks path={selectedPath} onSelect={handleSelect} />
      </div>
    </div>
  );
};
