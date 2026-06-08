// Keyboard — permanent 320px left rail. Pure mcp grid (4×4) +
// mobile-style page dots at the bottom for paginated scenarios.
//
// 2026-05-25 workflow upgrade:
//   - Click mcp → `createFromMcp()` opens (or refocuses) its
//     workspace instance in the middle zone. No more navigate to a
//     dedicated `/workspace` query-string route.
//   - Drag mcp → drop on workspace area = same as click (drop target
//     wired in app.tsx, MIME = application/x-ctrl-mcp-id).
//   - Hover cap → 3-dot menu reveal (Duplicate / Open new / Remove).
//   - Cmd/Ctrl+D on focused cap → duplicate its workspace instance.
//
// 2026-05-30 ADR-003 frontend amendment (Irisy-as-sole-entry + Keyboard drag-install):
// The Keyboard itself is now the drag-target for mcp installation.
// Accepts three drop sources:
//   1. Pool card → install (MIME = `application/x-ctrl-mcp-manifest`,
//      JSON payload with the manifest).
//   2. External file drop (`.zip` / `mcp.json`) → manifest parse +
//      install (manifest.json read as text, .zip deferred to a later
//      handoff — current shape is manifest-only).
//   3. URL drop (text/uri-list, e.g. dragged from address bar) → fetch
//      manifest from the URL, install.
// Plus a trash zone (revealed while dragging FROM the Keyboard) for
// uninstall. Drop-zone highlight + reject toast give visual feedback.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { z } from 'zod';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listMcps, type McpSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { invoke } from '@/lib/bridge';
import { IconRenderer } from '@/components/primitives';
import { McpMenu, McpMenuTrigger } from './McpMenu';
import styles from './Keyboard.module.css';

const MCPS_PER_PAGE = 15; // 4×4 grid; the 16th cell is always the "+" add button.
const MAX_PAGES = 8;          // hard cap so dots never run off the bottom.

/** Custom MIME used for inter-app drag of an INSTALLED mcp id (drag
 *  source = a mcp already on the Keyboard). Strict prefix so a stray
 *  text drop from another app can never spawn a phantom mcp. */
export const MCP_DRAG_MIME = 'application/x-ctrl-mcp-id';

/** Custom MIME for a draggable INSTALL payload — Pool / catalog surfaces
 *  attach a stringified manifest JSON. Drop on the Keyboard triggers
 *  `install_mcp`. Distinct from MCP_DRAG_MIME (which carries an
 *  already-installed id) so the drop handler can tell intent apart. */
export const MCP_INSTALL_MIME = 'application/x-ctrl-mcp-manifest';

/** Minimal shape gate for a remotely-fetched MCP manifest. The kernel's
 *  `install_mcp` performs authoritative validation, but a URL drop is the
 *  least-trusted source (attacker-influenced origin), so we reject any
 *  response that doesn't at least look like a named manifest before it
 *  ever reaches invoke(). Kept permissive (passthrough) on extra keys. */
const remoteManifestSchema = z
  .object({ name: z.string().min(1) })
  .passthrough();

/** Toast auto-dismiss timer for install/uninstall feedback. */
const TOAST_DISMISS_MS = 4000;

interface Scenario {
  id: string;
  label: string;
}

const SCENARIO_DEFAULT: Scenario = { id: 'all', label: 'All mcps' };

interface McpCellProps {
  mcp: McpSummary;
  active: boolean;
  menuOpen: boolean;
  onActivate: (id: string) => void;
  onToggleMenu: (id: string | null) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onDragStartFromCell: () => void;
  onDragEndFromCell: () => void;
}

const McpCell = ({
  mcp,
  active,
  menuOpen,
  onActivate,
  onToggleMenu,
  onDuplicate,
  onRemove,
  onDragStartFromCell,
  onDragEndFromCell,
}: McpCellProps): ReactElement => {
  const icon = normalizeIcon(mcp.icon, mcp.name);
  const cellRef = useRef<HTMLButtonElement | null>(null);

  const handleDragStart = (e: DragEvent<HTMLButtonElement>): void => {
    e.dataTransfer.setData(MCP_DRAG_MIME, mcp.id);
    e.dataTransfer.setData('text/plain', mcp.id); // back-compat readers
    e.dataTransfer.effectAllowed = 'copyMove';
    onDragStartFromCell();
  };

  const handleDragEnd = (): void => {
    onDragEndFromCell();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    // Cmd/Ctrl+D = duplicate the focused mcp's workspace instance.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      onDuplicate(mcp.id);
    }
  };

  return (
    <div className={styles.capWrap}>
      <button
        ref={cellRef}
        type="button"
        className={styles.cap}
        data-active={active}
        data-menu-open={menuOpen || undefined}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={() => onActivate(mcp.id)}
        onKeyDown={handleKeyDown}
        title={mcp.name}
      >
        <span className={styles.capIcon} aria-hidden="true">
          <IconRenderer icon={icon} size={28} ariaLabel={mcp.name} />
        </span>
        <span className={styles.capLabel}>{mcp.name}</span>
        <span className={styles.menuTrigger}>
          <McpMenuTrigger
            onClick={() => onToggleMenu(menuOpen ? null : mcp.id)}
            ariaLabel={`${mcp.name} actions`}
          />
        </span>
      </button>
      {menuOpen && (
        <div className={styles.menuAnchor}>
          <McpMenu
            anchorRef={cellRef as RefObject<HTMLElement | null>}
            onDismiss={() => onToggleMenu(null)}
            items={[
              {
                id: 'open',
                label: 'Open',
                shortcut: '↵',
                onSelect: () => onActivate(mcp.id),
              },
              {
                id: 'duplicate',
                label: 'Duplicate workspace',
                shortcut: '⌘D',
                onSelect: () => onDuplicate(mcp.id),
              },
              {
                id: 'remove',
                label: 'Remove mcp',
                destructive: true,
                onSelect: () => onRemove(mcp.id),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
};

interface InstallToast {
  kind: 'success' | 'error';
  text: string;
}

export const Keyboard = (): ReactElement => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pageIndex, setPageIndex] = useState(0);
  const [openMenuMcpId, setOpenMenuMcpId] = useState<string | null>(null);
  // Drag-install state — `dropMode` reflects what the user is hovering
  // with: 'install' (a Pool card / external manifest) flips the rail's
  // drop affordance; 'uninstall' (a mcp being dragged off the
  // Keyboard) reveals the trash zone.
  const [dropMode, setDropMode] = useState<'install' | 'uninstall' | null>(
    null,
  );
  const [trashHot, setTrashHot] = useState(false);
  const [toast, setToast] = useState<InstallToast | null>(null);
  // Mirrors the React-DnD-equivalent "is anything being dragged from the
  // Keyboard right now" flag — drives trash zone visibility.
  const [draggingFromKeyboard, setDraggingFromKeyboard] = useState(false);

  const createFromMcp = useWorkspaceStore((s) => s.createFromMcp);
  const duplicateInstance = useWorkspaceStore((s) => s.duplicateInstance);
  const instances = useWorkspaceStore((s) => s.instances);
  const closeInstance = useWorkspaceStore((s) => s.closeInstance);

  const { data: mcps = [] } = useQuery({
    queryKey: ['mcps'],
    queryFn: listMcps,
  });

  // Auto-dismiss the install/uninstall toast so it doesn't linger.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_DISMISS_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  const showSuccess = useCallback((text: string): void => {
    setToast({ kind: 'success', text });
  }, []);
  const showError = useCallback((text: string): void => {
    setToast({ kind: 'error', text });
  }, []);

  // ── install path ───────────────────────────────────────────────
  // Parse a manifest from one of:
  //   - JSON string (Pool drag payload)
  //   - File (drag from Finder, .json only — .zip deferred)
  //   - URL string (drag from address bar) — fetched as JSON
  // Returns null on parse failure; caller surfaces a toast.
  const parseManifestFromDrop = useCallback(
    async (
      dt: DataTransfer,
    ): Promise<Record<string, unknown> | null> => {
      const direct = dt.getData(MCP_INSTALL_MIME);
      if (direct) {
        try {
          const parsed: unknown = JSON.parse(direct);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
          return null;
        } catch {
          return null;
        }
      }
      const file = dt.files?.[0];
      if (file && /\.json$/i.test(file.name)) {
        try {
          const text = await file.text();
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
          }
          return null;
        } catch {
          return null;
        }
      }
      const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
      if (uri) {
        const url = uri.split('\n')[0]?.trim();
        if (!url) return null;
        // SSRF guard (OWASP A10): a dropped URI is attacker-influenced
        // and the response is installed as an MCP manifest. Only allow
        // https: — reject http:, file:, data:, and intranet-reachable
        // schemes so a drag payload can't pivot to a local/internal host
        // over a non-TLS channel.
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          return null;
        }
        if (parsedUrl.protocol !== 'https:') return null;
        try {
          const res = await fetch(parsedUrl.toString(), { mode: 'cors' });
          if (!res.ok) return null;
          const parsed: unknown = await res.json();
          const validated = remoteManifestSchema.safeParse(parsed);
          if (!validated.success) return null;
          return validated.data as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      return null;
    },
    [],
  );

  const installManifest = useCallback(
    async (manifest: Record<string, unknown>): Promise<void> => {
      try {
        const summary = await invoke<McpSummary>('install_mcp', {
          args: { manifest, server_code: '', server_code_filename: '' },
        });
        await queryClient.invalidateQueries({ queryKey: ['mcps'] });
        showSuccess(`Installed ${summary.name}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'install failed';
        showError(`Install failed: ${message}`);
      }
    },
    [queryClient, showError, showSuccess],
  );

  const uninstallMcp = useCallback(
    async (id: string): Promise<void> => {
      const summary = mcps.find((k) => k.id === id);
      try {
        await invoke('uninstall_mcp', { args: { mcp_id: id } });
        const existing = instances.find((i) => i.mcpId === id);
        if (existing) closeInstance(existing.id);
        await queryClient.invalidateQueries({ queryKey: ['mcps'] });
        showSuccess(`Uninstalled ${summary?.name ?? id}`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'uninstall failed';
        showError(`Uninstall failed: ${message}`);
      }
    },
    [closeInstance, instances, mcps, queryClient, showError, showSuccess],
  );

  // ── rail-level drag handlers (install side) ────────────────────
  // Differentiate intent: MCP_DRAG_MIME (already-installed id from a
  // cell) means the user is rearranging or trashing — we don't paint
  // the install drop-zone. Everything else is treated as a potential
  // install candidate.
  const hasInstallPayload = (e: DragEvent<HTMLElement>): boolean => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(MCP_DRAG_MIME)) return false;
    return (
      types.includes(MCP_INSTALL_MIME) ||
      types.includes('Files') ||
      types.includes('text/uri-list') ||
      types.includes('text/plain')
    );
  };

  const handleRailDragOver = useCallback(
    (e: DragEvent<HTMLElement>): void => {
      if (!hasInstallPayload(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropMode('install');
    },
    [],
  );

  const handleRailDragLeave = useCallback(
    (e: DragEvent<HTMLElement>): void => {
      // Only clear when leaving the rail bounds itself — child elements
      // fire dragleave for their own boundaries which we ignore.
      if (e.currentTarget === e.target) setDropMode(null);
    },
    [],
  );

  const handleRailDrop = useCallback(
    async (e: DragEvent<HTMLElement>): Promise<void> => {
      if (!hasInstallPayload(e)) return;
      e.preventDefault();
      setDropMode(null);
      const dt = e.dataTransfer;
      const manifest = await parseManifestFromDrop(dt);
      if (!manifest) {
        showError(
          'Drop ignored — expected a mcp manifest (JSON file or Pool card).',
        );
        return;
      }
      await installManifest(manifest);
    },
    [installManifest, parseManifestFromDrop, showError],
  );

  // ── trash-zone handlers (uninstall side) ───────────────────────
  const handleTrashDragOver = useCallback(
    (e: DragEvent<HTMLElement>): void => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes(MCP_DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setTrashHot(true);
    },
    [],
  );
  const handleTrashDragLeave = useCallback((): void => {
    setTrashHot(false);
  }, []);
  const handleTrashDrop = useCallback(
    async (e: DragEvent<HTMLElement>): Promise<void> => {
      e.preventDefault();
      setTrashHot(false);
      const id = e.dataTransfer.getData(MCP_DRAG_MIME);
      if (!id) return;
      await uninstallMcp(id);
    },
    [uninstallMcp],
  );

  // ── child-cell drag-source notifications ───────────────────────
  // McpCell calls these so the trash zone can appear only while a
  // Keyboard cell is being dragged (not for every drag in the window).
  const handleCellDragStart = useCallback((): void => {
    setDraggingFromKeyboard(true);
    setDropMode('uninstall');
  }, []);
  const handleCellDragEnd = useCallback((): void => {
    setDraggingFromKeyboard(false);
    setDropMode(null);
    setTrashHot(false);
  }, []);

  // Pagination: 15 mcps per page + an "Add" cell at the end of the
  // LAST page. Empty cells pad the current page to a full 4×4 grid.
  const { totalPages, pageStart, visible, paddingEmpties, isLastPage } = useMemo(() => {
    const pages = Math.max(1, Math.ceil(mcps.length / MCPS_PER_PAGE));
    const cappedPages = Math.min(pages, MAX_PAGES);
    const safePageIndex = Math.min(pageIndex, cappedPages - 1);
    const start = safePageIndex * MCPS_PER_PAGE;
    const slice = mcps.slice(start, start + MCPS_PER_PAGE);
    const isLast = safePageIndex === cappedPages - 1;
    const slotsForCells = isLast ? MCPS_PER_PAGE : MCPS_PER_PAGE + 1;
    const empties = Math.max(0, slotsForCells - slice.length);
    return {
      totalPages: cappedPages,
      pageStart: start,
      visible: slice,
      paddingEmpties: empties,
      isLastPage: isLast,
    };
  }, [mcps, pageIndex]);

  const handleActivate = useCallback(
    (id: string): void => {
      const summary = mcps.find((k) => k.id === id);
      if (!summary) return;
      createFromMcp({ id: summary.id, name: summary.name });
      void navigate({ to: '/workspace' });
    },
    [mcps, createFromMcp, navigate],
  );

  const handleDuplicate = useCallback(
    (id: string): void => {
      const summary = mcps.find((k) => k.id === id);
      if (!summary) return;
      // Resolve to the mcp's existing instance (if any) and fork
      // it. If no instance exists yet, create one first — Cmd+D on a
      // never-opened mcp shouldn't be a silent no-op.
      const existing = instances.find((i) => i.mcpId === id);
      const target =
        existing ?? createFromMcp({ id: summary.id, name: summary.name });
      duplicateInstance(target.id);
      void navigate({ to: '/workspace' });
    },
    [mcps, instances, createFromMcp, duplicateInstance, navigate],
  );

  const handleRemove = useCallback(
    (id: string): void => {
      // Remove the mcp's workspace instance (if open) — mcp-level
      // uninstall is a kernel op (`uninstall_mcp`) that lives on the
      // 3-dot Remove action once it lands. For today the menu cleans up
      // the front-end state so the action isn't a dead-end.
      const existing = instances.find((i) => i.mcpId === id);
      if (existing) closeInstance(existing.id);
    },
    [instances, closeInstance],
  );

  const handleAdd = useCallback((): void => {
    void navigate({ to: '/pool' });
  }, [navigate]);

  // Keyboard navigation on the page-dots row — Left / Right arrow keys
  // jump pages while the rail itself is focused.
  const handleDotKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPageIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setPageIndex((i) => Math.min(totalPages - 1, i + 1));
    }
  };

  // Close any open hover menu on page change — visually disorienting
  // otherwise (the anchor cell scrolls away).
  useEffect(() => {
    setOpenMenuMcpId(null);
  }, [pageIndex]);

  return (
    <aside
      className={styles.rail}
      aria-label="Keyboard — mcp rail"
      data-drop-mode={dropMode ?? undefined}
      onDragOver={handleRailDragOver}
      onDragLeave={handleRailDragLeave}
      onDrop={(e) => void handleRailDrop(e)}
    >
      <header className={styles.scenarioBar}>
        <span className={styles.scenarioName}>{SCENARIO_DEFAULT.label}</span>
        <span className={styles.scenarioCount}>
          {mcps.length === 0
            ? '—'
            : `${pageStart + 1}–${pageStart + visible.length} of ${mcps.length}`}
        </span>
      </header>

      <div className={styles.grid} role="grid" aria-label="Mcp grid">
        {visible.map((k) => (
          <McpCell
            key={k.id}
            mcp={k}
            active={false}
            menuOpen={openMenuMcpId === k.id}
            onActivate={handleActivate}
            onToggleMenu={setOpenMenuMcpId}
            onDuplicate={handleDuplicate}
            onRemove={handleRemove}
            onDragStartFromCell={handleCellDragStart}
            onDragEndFromCell={handleCellDragEnd}
          />
        ))}
        {Array.from({ length: paddingEmpties }).map((_, i) => (
          <button
            key={`empty-${pageIndex}-${i}`}
            type="button"
            className={`${styles.cap} ${styles.capEmpty}`}
            aria-label="Empty slot"
            tabIndex={-1}
          >
            <span className={styles.capIcon} aria-hidden="true">
              ·
            </span>
          </button>
        ))}
        {isLastPage && (
          <button
            type="button"
            className={`${styles.cap} ${styles.capAdd}`}
            aria-label="Add new mcp"
            onClick={handleAdd}
            title="Add mcp"
          >
            <span className={styles.capIcon}>+</span>
            <span className={styles.capLabel}>Add</span>
          </button>
        )}
      </div>

      <div className={styles.spacer} />

      <nav
        className={styles.pageDots}
        role="tablist"
        aria-label="Mcp pages"
        onKeyDown={handleDotKeyDown}
      >
        {Array.from({ length: totalPages }).map((_, i) => (
          <button
            key={`dot-${i}`}
            type="button"
            role="tab"
            aria-selected={i === pageIndex}
            aria-label={`Page ${i + 1} of ${totalPages}`}
            className={styles.dot}
            data-active={i === pageIndex}
            onClick={() => setPageIndex(i)}
          />
        ))}
      </nav>

      {/* Trash zone — only visible while the user is dragging a cell off
          the Keyboard. Drop = uninstall via uninstall_mcp. The
          aria-hidden flips with visibility so screen readers don't
          announce a phantom target when nothing is being dragged. */}
      <div
        className={styles.trash}
        data-active={draggingFromKeyboard || undefined}
        data-hot={trashHot || undefined}
        aria-hidden={!draggingFromKeyboard}
        onDragOver={handleTrashDragOver}
        onDragLeave={handleTrashDragLeave}
        onDrop={(e) => void handleTrashDrop(e)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
          stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
        <span className={styles.trashLabel}>Drop to uninstall</span>
      </div>

      {/* Toast — auto-dismisses after TOAST_DISMISS_MS. Anchored to the
          rail so it doesn't overlap the main display area. */}
      {toast && (
        <div
          className={`${styles.toast} ${
            toast.kind === 'success' ? styles.toastOk : styles.toastErr
          }`}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </aside>
  );
};
