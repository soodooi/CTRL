// RightRail — two-level context navigation on the right edge.
//
// Model (per bao 2026-05-23 clarification):
//   Level-1 = permanent vertical icon column. Synthesized order:
//     [ Irisy (top) | …route-pushed items… | Settings (bottom) ]
//   Level-2 = sub-panel that appears ONLY after clicking a level-1
//     item that carries one. Click the same item again to collapse.
//
// Default active = `irisy`, so on first load the user sees Irisy
// selected and (when the `/` route has pushed her panel) her panel
// open in level-2 — the cockpit feels alive without any explicit click.
//
// Per-item routing: each RailItem may carry an `onClick` (navigate to
// the item's workspace) and an optional `subPanel` (its level-2 data).
// Items WITHOUT a sub-panel just invoke `onClick` — they don't toggle
// the active state. Items WITH a sub-panel toggle the active state on
// click in addition to invoking `onClick`.
//
// Below the nav, the rail footer carries the app version and an update
// indicator (green dot when a newer build is published on the channel).

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
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { IrisyMascot, type IrisyState } from './primitives/IrisyMascot';
import {
  HistorySidebar,
  type HistoryGroup,
  IconRenderer,
} from './primitives';
import type { LedTone } from './primitives';
import type { Icon } from '@/lib/icon';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
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
const VAULT_ITEM_ID = 'vault';
const POOL_ITEM_ID = 'pool';
const SETTINGS_ITEM_ID = 'settings';
const RAIL_ITEM_ICON_SIZE = 22;
const IRISY_ICON_SIZE = 40;

const isIcon = (g: string | Icon | undefined): g is Icon =>
  typeof g === 'object' && g !== null && 'kind' in g;

// Inline gear icon — matches the stroke language of the keyboard's
// system row settings key, so the two surfaces feel like one icon set.
const GearIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3h.1a1.65 1.65 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8v.1a1.65 1.65 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z" />
  </svg>
);

// Inline vault icon — book-like stack representing the markdown vault.
const VaultIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 5h12a2 2 0 0 1 2 2v13H6a2 2 0 0 1-2-2V5z" />
    <path d="M4 5a2 2 0 0 1 2-2h12v15" />
    <path d="M9 8h6M9 12h4" />
  </svg>
);

// Inline pool / grid icon — 4 squares.
const PoolIcon = (): ReactElement => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

export const RailProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [irisyState, setIrisyState] = useState<IrisyState>('idle');
  const [irisySubPanel, setIrisySubPanel] = useState<RailSubPanel | null>(null);
  const [activeRailId, setActiveRailId] = useState<string | null>(IRISY_ITEM_ID);
  const value = useMemo<RailContextValue>(
    () => ({
      irisyState,
      setIrisyState,
      irisySubPanel,
      setIrisySubPanel,
      activeRailId,
      setActiveRailId,
    }),
    [irisyState, irisySubPanel, activeRailId],
  );
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
};

export const useRail = (): RailContextValue => {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error('useRail must be used inside <RailProvider>');
  return ctx;
};

// `useRailItems` removed 2026-05-26 per memory
// `feedback_right_rail_is_fixed`. Routes do NOT push items into the
// rail; the level-1 nav is hardcoded in `RightRail` itself.

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

interface SyntheticRailItem extends RailItem {
  isIrisy?: boolean;
  isSettings?: boolean;
  isVault?: boolean;
  isPool?: boolean;
}

// Settings has no level-2 panel — tabs live INSIDE the /settings page
// (per bao 2026-05-24). Settings rail item is a simple navigate.
const SETTINGS_DEFAULT_PATH = '/settings/ctrl';

const parseSettingsSection = (pathname: string): string | null => {
  const match = pathname.match(/^\/settings\/([\w-]+)/);
  return match?.[1] ?? null;
};

export const RightRail = (): ReactElement => {
  const {
    irisyState,
    irisySubPanel,
    activeRailId,
    setActiveRailId,
  } = useRail();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const update = useUpdateStatus();

  const settingsSection = parseSettingsSection(pathname);

  // Irisy lives in its own header slot ABOVE the level-1 nav — she's
  // the cockpit's identity anchor, not a peer of route keycap shortcuts.
  // Click still toggles her sub-panel + navigates to `/`.
  const irisyItem = useMemo<SyntheticRailItem>(
    () => ({
      id: IRISY_ITEM_ID,
      label: 'Irisy',
      isIrisy: true,
      subPanel: irisySubPanel ?? undefined,
      onClick: () => {
        void navigate({ to: '/' });
      },
    }),
    [irisySubPanel, navigate],
  );

  // Level-1 nav = FIXED items only. Per memory
  // `feedback_right_rail_is_fixed` (bao 2026-05-26): items must NOT
  // change with route. No route-pushed items.map(...) here — routes
  // render their own internal toolbars / chips inside the route page,
  // never reach into the rail.
  const allItems = useMemo<ReadonlyArray<SyntheticRailItem>>(() => {
    const vaultItem: SyntheticRailItem = {
      id: VAULT_ITEM_ID,
      label: 'Vault',
      isVault: true,
      onClick: () => {
        void navigate({ to: '/vault' });
      },
    };
    const poolItem: SyntheticRailItem = {
      id: POOL_ITEM_ID,
      label: 'Pool',
      isPool: true,
      onClick: () => {
        void navigate({ to: '/pool' });
      },
    };
    const settingsItem: SyntheticRailItem = {
      id: SETTINGS_ITEM_ID,
      label: 'Settings',
      isSettings: true,
      onClick: () => {
        void navigate({ to: SETTINGS_DEFAULT_PATH });
      },
    };
    return [vaultItem, poolItem, settingsItem];
  }, [navigate]);

  // Auto-flip activeRailId to vault / pool when the route enters those
  // surfaces — keeps the rail selection in sync with where the user
  // actually is.
  useEffect(() => {
    if (pathname.startsWith('/vault') && activeRailId !== VAULT_ITEM_ID) {
      setActiveRailId(VAULT_ITEM_ID);
    } else if (pathname.startsWith('/pool') && activeRailId !== POOL_ITEM_ID) {
      setActiveRailId(POOL_ITEM_ID);
    }
  }, [pathname, activeRailId, setActiveRailId]);

  const activeItem =
    activeRailId === IRISY_ITEM_ID
      ? irisyItem
      : allItems.find((i) => i.id === activeRailId) ?? null;
  const showSubPanel = activeItem?.subPanel != null;

  const handleItemClick = useCallback(
    (item: SyntheticRailItem) => {
      // Click the active item again → collapse its level-2 (only if it
      // has one; items without a panel stay selected on re-click).
      // Click any other item → move active selection to it.
      if (item.id === activeRailId && item.subPanel != null) {
        setActiveRailId(null);
      } else {
        setActiveRailId(item.id);
      }
      item.onClick?.();
    },
    [activeRailId, setActiveRailId],
  );

  // Auto-flip activeRailId to 'settings' when the workspace enters a
  // settings route — so the panel reveals its options without forcing
  // the user to click the rail item first.
  useEffect(() => {
    if (settingsSection && activeRailId !== SETTINGS_ITEM_ID) {
      setActiveRailId(SETTINGS_ITEM_ID);
    }
  }, [settingsSection, activeRailId, setActiveRailId]);

  const renderItem = (item: SyntheticRailItem): ReactElement => {
    // Visual active = the user's current selection. This is independent
    // of whether the item has a level-2 sub-panel — Settings is active
    // when on /settings/* even though it has no panel.
    const isSelected = item.id === activeRailId;
    return (
      <button
        key={item.id}
        type="button"
        className={styles.item}
        data-active={isSelected}
        data-irisy={item.isIrisy || undefined}
        data-settings={item.isSettings || undefined}
        data-vault={item.isVault || undefined}
        data-pool={item.isPool || undefined}
        onClick={() => handleItemClick(item)}
        title={item.label}
        aria-label={item.label}
        aria-current={isSelected ? 'true' : undefined}
      >
        <span className={styles.itemIcon}>
          {item.isIrisy ? (
            <IrisyMascot state={irisyState} size={IRISY_ICON_SIZE} />
          ) : item.isVault ? (
            <VaultIcon />
          ) : item.isPool ? (
            <PoolIcon />
          ) : item.isSettings ? (
            <GearIcon />
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
  };

  // Split synthetic items so Settings can live in the footer slot,
  // pinned to the bottom of the rail.
  const settingsItem = allItems.find((i) => i.isSettings);
  const navItems = allItems.filter((i) => !i.isSettings);

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
        <header className={styles.irisyHeader}>
          {renderItem(irisyItem)}
        </header>

        <nav className={styles.nav} aria-label="Context navigation">
          {navItems.map(renderItem)}
        </nav>

        <div className={styles.footer}>
          {settingsItem && renderItem(settingsItem)}
          <div
            className={styles.versionRow}
            title={
              update.available
                ? `Update available${update.latestVersion ? ` (${update.latestVersion})` : ''}`
                : `CTRL v${APP_VERSION}`
            }
          >
            <span className={styles.versionText}>v{APP_VERSION}</span>
            {update.available && (
              <span
                className={styles.updateDot}
                aria-label="Update available"
                role="status"
              />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
