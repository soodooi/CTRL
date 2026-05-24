// RightRail — two-level context navigation on the right edge.
//
// Model (per bao 2026-05-23 clarification):
//   Level-1 = permanent vertical icon column (Irisy on top + any keycap
//             shortcuts pushed by routes).
//   Level-2 = sub-panel that appears ONLY after clicking a level-1 item
//             that carries one. Click the same item again to collapse.
//
// Default active = `irisy`, so on first load the user sees Irisy
// selected and (when the `/` route has pushed her history) her panel
// open in level-2 — the cockpit feels alive without any explicit click.
//
// Per-item routing: each RailItem may carry an `onClick` (navigate to
// the item's workspace) and an optional `subPanel` (its level-2 data).
// Items WITHOUT a sub-panel just invoke `onClick` — they don't toggle
// the active state. Items WITH a sub-panel toggle the active state on
// click in addition to invoking `onClick`.

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
import { useNavigate } from '@tanstack/react-router';
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

export interface RailSubPanel {
  groups: ReadonlyArray<HistoryGroup>;
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  newLabel?: string;
  emptyText?: string;
}

export interface RailItem {
  id: string;
  label: string;
  glyph?: string | Icon;
  tone?: RailTone;
  badge?: number;
  active?: boolean;
  onClick?: () => void;
  /** Level-2 panel that appears when this item is the active rail
   *  selection. Items without this just invoke `onClick`. */
  subPanel?: RailSubPanel;
}

interface RailContextValue {
  items: ReadonlyArray<RailItem>;
  setItems: (items: ReadonlyArray<RailItem>) => void;
  irisyState: IrisyState;
  setIrisyState: (state: IrisyState) => void;
  /** Irisy's level-2 panel content, pushed by whichever route owns her
   *  context (today: `/` pushes a chat-history list). */
  irisySubPanel: RailSubPanel | null;
  setIrisySubPanel: (panel: RailSubPanel | null) => void;
  /** Which level-1 item is selected. `null` = level-2 column hidden.
   *  Defaults to `'irisy'` so the cockpit boots with her panel open. */
  activeRailId: string | null;
  setActiveRailId: (id: string | null) => void;
}

const RailContext = createContext<RailContextValue | null>(null);

const IRISY_ITEM_ID = 'irisy';
const RAIL_ITEM_ICON_SIZE = 22;
const IRISY_ICON_SIZE = 40;

const isIcon = (g: string | Icon | undefined): g is Icon =>
  typeof g === 'object' && g !== null && 'kind' in g;

export const RailProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [items, setItems] = useState<ReadonlyArray<RailItem>>([]);
  const [irisyState, setIrisyState] = useState<IrisyState>('idle');
  const [irisySubPanel, setIrisySubPanel] = useState<RailSubPanel | null>(null);
  const [activeRailId, setActiveRailId] = useState<string | null>(IRISY_ITEM_ID);
  const value = useMemo<RailContextValue>(
    () => ({
      items,
      setItems,
      irisyState,
      setIrisyState,
      irisySubPanel,
      setIrisySubPanel,
      activeRailId,
      setActiveRailId,
    }),
    [items, irisyState, irisySubPanel, activeRailId],
  );
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
};

export const useRail = (): RailContextValue => {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error('useRail must be used inside <RailProvider>');
  return ctx;
};

/** Convenience hook for routes that want to populate the level-1 rail
 *  with route-specific items. Pass a memoized array. */
export const useRailItems = (items: ReadonlyArray<RailItem>): void => {
  const { setItems } = useRail();
  useEffect(() => {
    setItems(items);
  }, [items, setItems]);
  useEffect(() => () => setItems([]), [setItems]);
};

/** Push Irisy's level-2 panel content. The rail clears it on unmount
 *  via the second effect — a single effect with cleanup would briefly
 *  null the panel between dep-change ticks and cause a flash. */
export const useIrisySubPanel = (panel: RailSubPanel | null): void => {
  const { setIrisySubPanel } = useRail();
  useEffect(() => {
    setIrisySubPanel(panel);
  }, [panel, setIrisySubPanel]);
  useEffect(() => () => setIrisySubPanel(null), [setIrisySubPanel]);
};

export const RightRail = (): ReactElement => {
  const {
    items,
    irisyState,
    irisySubPanel,
    activeRailId,
    setActiveRailId,
  } = useRail();
  const navigate = useNavigate();

  // Synthesize Irisy as the always-first level-1 item. Her sub-panel
  // tracks the rail context (route-pushed via useIrisySubPanel).
  const allItems = useMemo<ReadonlyArray<RailItem & { isIrisy: boolean }>>(() => {
    const irisyItem: RailItem & { isIrisy: boolean } = {
      id: IRISY_ITEM_ID,
      label: 'Irisy',
      isIrisy: true,
      subPanel: irisySubPanel ?? undefined,
      onClick: () => {
        void navigate({ to: '/' });
      },
    };
    return [irisyItem, ...items.map((i) => ({ ...i, isIrisy: false }))];
  }, [irisySubPanel, items, navigate]);

  const activeItem = allItems.find((i) => i.id === activeRailId) ?? null;
  const showSubPanel = activeItem?.subPanel != null;

  const handleItemClick = useCallback(
    (item: RailItem & { isIrisy: boolean }) => {
      // Items with a sub-panel toggle level-2 visibility AND invoke onClick.
      // Items without a sub-panel just invoke onClick (no toggle).
      if (item.subPanel != null) {
        setActiveRailId(activeRailId === item.id ? null : item.id);
      }
      item.onClick?.();
    },
    [activeRailId, setActiveRailId],
  );

  return (
    <aside
      className={styles.container}
      data-sub-panel={showSubPanel ? 'open' : 'closed'}
      aria-label="Context rail"
    >
      {showSubPanel && activeItem?.subPanel && (
        <div className={styles.subPanel}>
          <HistorySidebar
            groups={activeItem.subPanel.groups}
            activeId={activeItem.subPanel.activeId}
            onSelect={activeItem.subPanel.onSelect}
            onNew={activeItem.subPanel.onNew}
            newLabel={activeItem.subPanel.newLabel ?? 'New'}
            emptyText={activeItem.subPanel.emptyText ?? 'no items'}
            className={styles.history}
          />
        </div>
      )}

      <div className={styles.primary}>
        <nav className={styles.nav} aria-label="Context navigation">
          {allItems.map((item) => {
            const isActive = item.id === activeRailId && showSubPanel;
            return (
              <button
                key={item.id}
                type="button"
                className={styles.item}
                data-active={isActive}
                data-irisy={item.isIrisy || undefined}
                onClick={() => handleItemClick(item)}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className={styles.activeBar} aria-hidden="true" />
                <span className={styles.itemIcon}>
                  {item.isIrisy ? (
                    <IrisyMascot state={irisyState} size={IRISY_ICON_SIZE} />
                  ) : isIcon(item.glyph) ? (
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
            );
          })}
        </nav>
      </div>
    </aside>
  );
};
