// Keyboard — permanent 320px left rail. Pure keycap grid (4×4) +
// mobile-style page dots at the bottom for paginated scenarios.
//
// 2026-05-25 workflow upgrade:
//   - Click keycap → `createFromKeycap()` opens (or refocuses) its
//     workspace instance in the middle zone. No more navigate to a
//     dedicated `/workspace` query-string route.
//   - Drag keycap → drop on workspace area = same as click (drop target
//     wired in app.tsx, MIME = application/x-ctrl-keycap-id).
//   - Hover cap → 3-dot menu reveal (Duplicate / Open new / Remove).
//   - Cmd/Ctrl+D on focused cap → duplicate its workspace instance.

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
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { listKeycaps, type KeycapSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { IconRenderer } from '@/components/primitives';
import { KeycapMenu, KeycapMenuTrigger } from './KeycapMenu';
import styles from './Keyboard.module.css';

const KEYCAPS_PER_PAGE = 15; // 4×4 grid; the 16th cell is always the "+" add button.
const MAX_PAGES = 8;          // hard cap so dots never run off the bottom.

/** Custom MIME used for inter-app drag. Strict prefix so a stray text
 *  drop from another app can never spawn a phantom keycap. */
export const KEYCAP_DRAG_MIME = 'application/x-ctrl-keycap-id';

interface Scenario {
  id: string;
  label: string;
}

const SCENARIO_DEFAULT: Scenario = { id: 'all', label: 'All keycaps' };

interface KeycapCellProps {
  keycap: KeycapSummary;
  active: boolean;
  menuOpen: boolean;
  onActivate: (id: string) => void;
  onToggleMenu: (id: string | null) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}

const KeycapCell = ({
  keycap,
  active,
  menuOpen,
  onActivate,
  onToggleMenu,
  onDuplicate,
  onRemove,
}: KeycapCellProps): ReactElement => {
  const icon = normalizeIcon(keycap.icon, keycap.name);
  const cellRef = useRef<HTMLButtonElement | null>(null);

  const handleDragStart = (e: DragEvent<HTMLButtonElement>): void => {
    e.dataTransfer.setData(KEYCAP_DRAG_MIME, keycap.id);
    e.dataTransfer.setData('text/plain', keycap.id); // back-compat readers
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>): void => {
    // Cmd/Ctrl+D = duplicate the focused keycap's workspace instance.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      onDuplicate(keycap.id);
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
        onClick={() => onActivate(keycap.id)}
        onKeyDown={handleKeyDown}
        title={keycap.name}
      >
        <span className={styles.capIcon} aria-hidden="true">
          <IconRenderer icon={icon} size={28} ariaLabel={keycap.name} />
        </span>
        <span className={styles.capLabel}>{keycap.name}</span>
        <span className={styles.menuTrigger}>
          <KeycapMenuTrigger
            onClick={() => onToggleMenu(menuOpen ? null : keycap.id)}
            ariaLabel={`${keycap.name} actions`}
          />
        </span>
      </button>
      {menuOpen && (
        <div className={styles.menuAnchor}>
          <KeycapMenu
            anchorRef={cellRef as RefObject<HTMLElement | null>}
            onDismiss={() => onToggleMenu(null)}
            items={[
              {
                id: 'open',
                label: 'Open',
                shortcut: '↵',
                onSelect: () => onActivate(keycap.id),
              },
              {
                id: 'duplicate',
                label: 'Duplicate workspace',
                shortcut: '⌘D',
                onSelect: () => onDuplicate(keycap.id),
              },
              {
                id: 'remove',
                label: 'Remove keycap',
                destructive: true,
                onSelect: () => onRemove(keycap.id),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
};

export const Keyboard = (): ReactElement => {
  const navigate = useNavigate();
  const [pageIndex, setPageIndex] = useState(0);
  const [openMenuKeycapId, setOpenMenuKeycapId] = useState<string | null>(null);

  const createFromKeycap = useWorkspaceStore((s) => s.createFromKeycap);
  const duplicateInstance = useWorkspaceStore((s) => s.duplicateInstance);
  const instances = useWorkspaceStore((s) => s.instances);
  const closeInstance = useWorkspaceStore((s) => s.closeInstance);

  const { data: keycaps = [] } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  // Pagination: 15 keycaps per page + an "Add" cell at the end of the
  // LAST page. Empty cells pad the current page to a full 4×4 grid.
  const { totalPages, pageStart, visible, paddingEmpties, isLastPage } = useMemo(() => {
    const pages = Math.max(1, Math.ceil(keycaps.length / KEYCAPS_PER_PAGE));
    const cappedPages = Math.min(pages, MAX_PAGES);
    const safePageIndex = Math.min(pageIndex, cappedPages - 1);
    const start = safePageIndex * KEYCAPS_PER_PAGE;
    const slice = keycaps.slice(start, start + KEYCAPS_PER_PAGE);
    const isLast = safePageIndex === cappedPages - 1;
    const slotsForCells = isLast ? KEYCAPS_PER_PAGE : KEYCAPS_PER_PAGE + 1;
    const empties = Math.max(0, slotsForCells - slice.length);
    return {
      totalPages: cappedPages,
      pageStart: start,
      visible: slice,
      paddingEmpties: empties,
      isLastPage: isLast,
    };
  }, [keycaps, pageIndex]);

  const handleActivate = useCallback(
    (id: string): void => {
      const summary = keycaps.find((k) => k.id === id);
      if (!summary) return;
      createFromKeycap({ id: summary.id, name: summary.name });
      void navigate({ to: '/workspace' });
    },
    [keycaps, createFromKeycap, navigate],
  );

  const handleDuplicate = useCallback(
    (id: string): void => {
      const summary = keycaps.find((k) => k.id === id);
      if (!summary) return;
      // Resolve to the keycap's existing instance (if any) and fork
      // it. If no instance exists yet, create one first — Cmd+D on a
      // never-opened keycap shouldn't be a silent no-op.
      const existing = instances.find((i) => i.keycapId === id);
      const target =
        existing ?? createFromKeycap({ id: summary.id, name: summary.name });
      duplicateInstance(target.id);
      void navigate({ to: '/workspace' });
    },
    [keycaps, instances, createFromKeycap, duplicateInstance, navigate],
  );

  const handleRemove = useCallback(
    (id: string): void => {
      // Remove the keycap's workspace instance (if open) — keycap-level
      // uninstall is a kernel op (`uninstall_keycap`) that lives on the
      // 3-dot Remove action once it lands. For today the menu cleans up
      // the front-end state so the action isn't a dead-end.
      const existing = instances.find((i) => i.keycapId === id);
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
    setOpenMenuKeycapId(null);
  }, [pageIndex]);

  return (
    <aside className={styles.rail} aria-label="Keyboard — keycap rail">
      <header className={styles.scenarioBar}>
        <span className={styles.scenarioName}>{SCENARIO_DEFAULT.label}</span>
        <span className={styles.scenarioCount}>
          {keycaps.length === 0
            ? '—'
            : `${pageStart + 1}–${pageStart + visible.length} of ${keycaps.length}`}
        </span>
      </header>

      <div className={styles.grid} role="grid" aria-label="Keycap grid">
        {visible.map((k) => (
          <KeycapCell
            key={k.id}
            keycap={k}
            active={false}
            menuOpen={openMenuKeycapId === k.id}
            onActivate={handleActivate}
            onToggleMenu={setOpenMenuKeycapId}
            onDuplicate={handleDuplicate}
            onRemove={handleRemove}
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
            aria-label="Add new keycap"
            onClick={handleAdd}
            title="Add keycap"
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
        aria-label="Keycap pages"
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
    </aside>
  );
};
