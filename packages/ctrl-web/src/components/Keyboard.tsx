// Keyboard — permanent 320px left rail. Pure keycap grid (4×4) +
// mobile-style page dots at the bottom for paginated scenarios.
//
// Per bao 2026-05-23: the left rail is JUST keycaps now — no search
// bar, no system row. Pool / Irisy / Settings live in the right rail
// (level-1 items + Settings footer); search lives behind ⌘K. The "+"
// add cell on every page still routes to /pool so new keycaps install
// without leaving the cockpit.
//
// Scenario support is plumbed but inert until the kernel tags keycaps
// with `scenario`. Today there's one "All keycaps" scenario and the
// dots reflect actual data pagination. Once Work / Life / Marketing
// scenarios land, this file just consumes that field — no UI rewrite.

import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { listKeycaps, type KeycapSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { IconRenderer } from '@/components/primitives';
import styles from './Keyboard.module.css';

const KEYCAPS_PER_PAGE = 15; // 4×4 grid; the 16th cell is always the "+" add button.
const MAX_PAGES = 8;          // hard cap so dots never run off the bottom.

interface Scenario {
  id: string;
  label: string;
}

// Scenarios are stubbed until the kernel exposes them per-keycap.
// When that lands, replace this with `useScenarios()` and filter
// keycaps by scenario id before pagination.
const SCENARIO_DEFAULT: Scenario = { id: 'all', label: 'All keycaps' };

interface KeycapCellProps {
  keycap: KeycapSummary;
  active: boolean;
  onActivate: (id: string) => void;
}

const KeycapCell = ({ keycap, active, onActivate }: KeycapCellProps): ReactElement => {
  const icon = normalizeIcon(keycap.icon, keycap.name);
  return (
    <button
      type="button"
      className={styles.cap}
      data-active={active}
      onClick={() => onActivate(keycap.id)}
      title={keycap.name}
    >
      <span className={styles.capIcon} aria-hidden="true">
        <IconRenderer icon={icon} size={28} ariaLabel={keycap.name} />
      </span>
      <span className={styles.capLabel}>{keycap.name}</span>
    </button>
  );
};

export const Keyboard = (): ReactElement => {
  const navigate = useNavigate();
  const [pageIndex, setPageIndex] = useState(0);

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
    // On the last page we leave the 16th cell for the "Add" button.
    // On earlier pages we fill all 16 with keycaps + empties.
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

  const handleActivate = (id: string): void => {
    void navigate({ to: '/workspace', search: { keycap_id: id } as never });
  };

  const handleAdd = (): void => {
    void navigate({ to: '/pool' });
  };

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

  return (
    <aside className={styles.rail} aria-label="Keyboard — keycap rail">
      {/* Scenario header — single label today; future iterations layer
          in a dropdown / horizontal scroll once kernel tags scenarios. */}
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
            onActivate={handleActivate}
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

      {/* Page dots — iOS-style indicator. Always rendered so the rail
          chrome doesn't reflow when a second page appears. */}
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
