// RightRail — two-level context navigation on the right edge.
//
// Layout (when a route provides a sub-panel):
//   [ sub-panel (240px, collapsible) | chevron tab (14px) | level-1 rail (80px) ]
//
// Layout (when no sub-panel is registered — e.g. /pool, /settings):
//   [ level-1 rail (80px) ]
//
// Level-1 rail = Irisy portal (top) + vertical icon+label list (below).
// Level-2 sub-panel = HistorySidebar (or any future context list pushed
// in by a route via useRailSubPanel).
//
// Per bao 2026-05-23 directives:
//   - Move the SessionWorkspace "middle nav" out of the main column and
//     into the right rail as a collapsible level-2 panel.
//   - Level-1 icons now carry a visible text label below the icon (the
//     old `title` tooltip was too discoverable-only).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { IrisyMascot, type IrisyState } from './primitives/IrisyMascot';
import {
  HistorySidebar,
  type HistoryGroup,
  IconRenderer,
} from './primitives';
import type { LedTone } from './primitives';
import type { Icon } from '@/lib/icon';
import styles from './RightRail.module.css';

export type RailTone = LedTone;

export interface RailItem {
  id: string;
  label: string;
  // `string` keeps the legacy short-label use (e.g. 2-char abbreviation
  // from pool categories); `Icon` lifts it onto the IconRenderer pipeline
  // so a rail item can carry a lottie / svg without ad-hoc rendering.
  glyph?: string | Icon;
  tone?: RailTone;
  badge?: number;
  active?: boolean;
  onClick?: () => void;
}

/** Level-2 sub-panel descriptor. A route pushes one of these via
 *  `useRailSubPanel`; the rail renders it as a collapsible column. */
export interface RailSubPanel {
  groups: ReadonlyArray<HistoryGroup>;
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  newLabel?: string;
  emptyText?: string;
}

interface RailContextValue {
  items: ReadonlyArray<RailItem>;
  setItems: (items: ReadonlyArray<RailItem>) => void;
  irisyState: IrisyState;
  setIrisyState: (state: IrisyState) => void;
  subPanel: RailSubPanel | null;
  setSubPanel: (panel: RailSubPanel | null) => void;
  /** True while the sub-panel is collapsed (column hidden). */
  subPanelCollapsed: boolean;
  setSubPanelCollapsed: (collapsed: boolean) => void;
}

const RailContext = createContext<RailContextValue | null>(null);

const RAIL_ITEM_ICON_SIZE = 22;

const isIcon = (g: string | Icon | undefined): g is Icon =>
  typeof g === 'object' && g !== null && 'kind' in g;

export const RailProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [items, setItems] = useState<ReadonlyArray<RailItem>>([]);
  const [irisyState, setIrisyState] = useState<IrisyState>('idle');
  const [subPanel, setSubPanel] = useState<RailSubPanel | null>(null);
  const [subPanelCollapsed, setSubPanelCollapsed] = useState<boolean>(false);
  const value = useMemo<RailContextValue>(
    () => ({
      items,
      setItems,
      irisyState,
      setIrisyState,
      subPanel,
      setSubPanel,
      subPanelCollapsed,
      setSubPanelCollapsed,
    }),
    [items, irisyState, subPanel, subPanelCollapsed],
  );
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
};

export const useRail = (): RailContextValue => {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error('useRail must be used inside <RailProvider>');
  return ctx;
};

/** Convenience hook for routes that want to populate the rail. Pass a
 *  memoized items array — otherwise the rail re-renders every tick. The
 *  hook clears the rail on unmount so route swaps don't leak items. */
export const useRailItems = (items: ReadonlyArray<RailItem>): void => {
  const { setItems } = useRail();
  useEffect(() => {
    setItems(items);
    return () => setItems([]);
  }, [items, setItems]);
};

/** Push a level-2 sub-panel into the rail for the lifetime of the
 *  caller component. The rail clears it on unmount so route swaps
 *  don't leak the panel across pages.
 *
 *  Two effects so dep-change cleanup doesn't briefly null the panel:
 *  the upsert effect re-runs on panel change without clearing; the
 *  clear-on-unmount effect has an empty cleanup-only path. */
export const useRailSubPanel = (panel: RailSubPanel | null): void => {
  const { setSubPanel } = useRail();
  useEffect(() => {
    setSubPanel(panel);
  }, [panel, setSubPanel]);
  useEffect(() => () => setSubPanel(null), [setSubPanel]);
};

export const RightRail = (): ReactElement => {
  const {
    items,
    irisyState,
    subPanel,
    subPanelCollapsed,
    setSubPanelCollapsed,
  } = useRail();

  const handleItemClick = useCallback((item: RailItem) => {
    item.onClick?.();
  }, []);

  const hasSubPanel = subPanel !== null;
  const showSubPanel = hasSubPanel && !subPanelCollapsed;

  return (
    <aside
      className={styles.container}
      data-sub-panel={showSubPanel ? 'open' : 'closed'}
      aria-label="Context rail"
    >
      {hasSubPanel && (
        <div
          className={styles.subPanel}
          aria-hidden={!showSubPanel}
        >
          <HistorySidebar
            groups={subPanel.groups}
            activeId={subPanel.activeId}
            onSelect={subPanel.onSelect}
            onNew={subPanel.onNew}
            newLabel={subPanel.newLabel ?? 'New'}
            emptyText={subPanel.emptyText ?? 'no items'}
            className={styles.history}
          />
        </div>
      )}

      {hasSubPanel && (
        <button
          type="button"
          className={styles.toggle}
          onClick={() => setSubPanelCollapsed(!subPanelCollapsed)}
          aria-label={subPanelCollapsed ? 'Show sub-panel' : 'Hide sub-panel'}
          aria-expanded={!subPanelCollapsed}
          title={subPanelCollapsed ? 'Show sub-panel' : 'Hide sub-panel'}
        >
          <span aria-hidden="true">{subPanelCollapsed ? '▶' : '◀'}</span>
        </button>
      )}

      <div className={styles.primary}>
        {/* Irisy portal — presides over the rail at the top. */}
        <div className={styles.portal}>
          <div className={styles.mascot}>
            <div className={styles.mascotHalo} />
            <IrisyMascot state={irisyState} size={48} />
          </div>
          <span className={styles.mascotName}>Irisy</span>
        </div>

        {/* Level-1 navigation — icon + label per item. */}
        <nav className={styles.nav} aria-label="Workspace context">
          {items.length === 0 && (
            <span className={styles.empty}>no items</span>
          )}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.item}
              data-active={item.active ?? false}
              onClick={() => handleItemClick(item)}
              title={item.label}
              aria-label={item.label}
            >
              <span className={styles.itemIcon}>
                {isIcon(item.glyph) ? (
                  <IconRenderer
                    icon={item.glyph}
                    size={RAIL_ITEM_ICON_SIZE}
                    playing={item.active ?? false}
                    ariaLabel={item.label}
                  />
                ) : item.glyph ? (
                  <span className={styles.itemGlyph}>{item.glyph}</span>
                ) : (
                  <span
                    className={styles.itemDot}
                    data-tone={item.tone ?? 'unknown'}
                  />
                )}
                {item.badge !== undefined && item.badge > 0 && (
                  <span className={styles.itemBadge}>
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </span>
              <span className={styles.itemLabel}>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </aside>
  );
};
