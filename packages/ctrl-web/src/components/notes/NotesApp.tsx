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
//   │ Tree   │ Editor                       │ Backlinks      │
//   │ 220px  │ 1fr                          │ 220px          │
//   └────────┴──────────────────────────────┴────────────────┘
//
// State scope (owned here, propagated down via props):
//   - `query`         — search box value (drives NotesTree)
//   - `selectedPath`  — currently-active note (drives Editor + Backlinks)
//   - `busy`          — async lock for + Note / Today / Review writes
//
// Components live in standalone files so the Irisy app system can
// reuse them later (e.g. a "Weekly Review" keycap importing
// `NotesEditor`) without copying the wiring.

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
import { NotesActions } from './NotesActions';
import { NotesTree } from './NotesTree';
import { NotesEditor } from './NotesEditor';
import { NotesBacklinks } from './NotesBacklinks';
import { TemplatesModal } from './TemplatesModal';
import { TagsPanel } from './TagsPanel';
import styles from './Notes.module.css';

const renderDailyTemplate = (raw: string): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return raw.replace(/\{\{date\}\}/g, `${y}-${m}-${day}`);
};

export const NotesApp = (): ReactElement => {
  const [query, setQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const openTab = useWorkspaceStore((s) => s.openTab);
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

  const handleNew = useCallback(() => {
    setTemplatesOpen(true);
  }, []);

  const handleTemplateCreated = useCallback(
    (path: string) => {
      refetchTree();
      setSelectedPath(path);
    },
    [refetchTree],
  );

  const handleToday = useCallback(async () => {
    setBusy(true);
    try {
      const cfg = await loadDailyNotesConfig();
      const path = renderDailyNotePath(cfg.pathTemplate);
      // Existence check via direct read so we don't depend on a
      // possibly-stale vault-list cache.
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
      setSelectedPath(path);
    } finally {
      setBusy(false);
    }
  }, [refetchTree]);

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
        openTab(tab, { instanceId: inst.id, activate: true });
      } else {
        openTab(tab, { activate: true });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('notes review failed', err);
    } finally {
      setBusy(false);
    }
  }, [activeInstanceId, createBlank, openTab, refetchTree]);

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
      <div className={styles.cols}>
        <div className={styles.leftCol}>
          <NotesTree
            query={query}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            tagFilter={tagFilter}
          />
          <TagsPanel selected={tagFilter} onSelect={setTagFilter} />
        </div>
        <NotesEditor path={selectedPath} />
        <NotesBacklinks path={selectedPath} onSelect={setSelectedPath} />
      </div>
    </div>
  );
};
