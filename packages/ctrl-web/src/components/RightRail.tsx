// RightRail — 工作区 navigation column (一级 + 二级 nav).
//
// Terminology (bao 2026-05-24):
//   工作区 (workspace) = entire right side of the cockpit, INCLUDING this
//     column. RightRail is the navigation portion of 工作区; routes render
//     into the main area to its left.
//   一级导航 (level-1) = permanent 64px vertical icon column on the right
//     edge of this component. Synthesized order:
//       [ Irisy (top, mascot + blink) | …route-pushed items… | Settings (bottom) ]
//   二级导航 (level-2) = collapsible 240px sub-panel that appears ONLY
//     after clicking a 一级 item carrying one. Used by the active keycap
//     to list its work titles (chat sessions / drafts / contexts). Click
//     the same 一级 item again to collapse.
//
// Default active = `irisy`, so on first load the user sees Irisy selected
// and (when the `/` route has pushed her panel) her 二级 panel open — the
// cockpit feels alive without an explicit click.
//
// Per-item routing: each RailItem may carry an `onClick` (navigate to its
// main area) and an optional `subPanel` (its 二级 data). Items WITHOUT a
// sub-panel just invoke `onClick` — they don't toggle the active state.
// Items WITH a sub-panel toggle active state on click in addition to
// invoking `onClick`.
//
// Footer (below 一级): app version pill — clickable, drives the auto-push
// update flow (kernel-cached check, instant install on click when an
// update is available).

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
import { APP_VERSION, useUpdateController } from '@/lib/app-meta';
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

interface SyntheticRailItem extends RailItem {
  isIrisy?: boolean;
  isSettings?: boolean;
}

const SETTINGS_SECTIONS: ReadonlyArray<{ id: string; title: string }> = [
  { id: 'ctrl', title: 'CTRL Settings' },
  { id: 'hermes', title: 'Hermes Settings' },
  { id: 'updates', title: 'Update Log' },
];

const SETTINGS_DEFAULT_PATH = '/settings/ctrl';

const parseSettingsSection = (pathname: string): string | null => {
  const match = pathname.match(/^\/settings\/([\w-]+)/);
  return match?.[1] ?? null;
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { status: update, forceCheck, install } = useUpdateController();

  const versionLabel = (() => {
    if (update.state === 'installing') return 'installing…';
    if (update.state === 'available' && update.latestVersion) {
      return `↑ v${update.latestVersion}`;
    }
    return `v${APP_VERSION}`;
  })();

  const versionTitle = (() => {
    if (update.state === 'installing') return 'Downloading and installing update…';
    if (update.state === 'available') {
      return `Update to v${update.latestVersion ?? '?'} — click to install`;
    }
    if (update.state === 'error') return `${update.message ?? 'Update check failed'} — click to retry`;
    if (update.state === 'no_endpoint') return update.message ?? 'Updater not configured';
    if (update.state === 'up_to_date') return `${update.message ?? 'Up to date'} — click to re-check`;
    return `CTRL v${APP_VERSION} — click to check for updates`;
  })();

  const onVersionClick = (): void => {
    if (update.state === 'installing') return;
    if (update.state === 'available') {
      void install();
    } else {
      void forceCheck();
    }
  };

  const settingsSection = parseSettingsSection(pathname);

  // Synthesize Irisy (top) + route items + Settings (bottom).
  const allItems = useMemo<ReadonlyArray<SyntheticRailItem>>(() => {
    const irisyItem: SyntheticRailItem = {
      id: IRISY_ITEM_ID,
      label: 'Irisy',
      isIrisy: true,
      subPanel: irisySubPanel ?? undefined,
      onClick: () => {
        void navigate({ to: '/' });
      },
    };
    const settingsItem: SyntheticRailItem = {
      id: SETTINGS_ITEM_ID,
      label: 'Settings',
      isSettings: true,
      subPanel: {
        groups: [{ label: 'Sections', items: SETTINGS_SECTIONS }],
        activeId: settingsSection,
        onSelect: (id: string) => {
          void navigate({ to: `/settings/${id}` });
        },
      },
      onClick: () => {
        // Landing the user inside a settings sub-route so the workspace
        // has content the moment the level-2 panel reveals it.
        if (!pathname.startsWith('/settings')) {
          void navigate({ to: SETTINGS_DEFAULT_PATH });
        }
      },
    };
    return [
      irisyItem,
      ...items.map((i) => ({ ...i, isIrisy: false, isSettings: false })),
      settingsItem,
    ];
  }, [irisySubPanel, items, navigate, pathname, settingsSection]);

  const activeItem = allItems.find((i) => i.id === activeRailId) ?? null;
  const showSubPanel = activeItem?.subPanel != null;

  const handleItemClick = useCallback(
    (item: SyntheticRailItem) => {
      // Items with a sub-panel toggle level-2 visibility AND invoke onClick.
      // Items without a sub-panel just invoke onClick (no toggle).
      if (item.subPanel != null) {
        setActiveRailId(activeRailId === item.id ? null : item.id);
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
    const isActive = item.id === activeRailId && showSubPanel;
    return (
      <button
        key={item.id}
        type="button"
        className={styles.item}
        data-active={isActive}
        data-irisy={item.isIrisy || undefined}
        data-settings={item.isSettings || undefined}
        onClick={() => handleItemClick(item)}
        title={item.label}
        aria-label={item.label}
        aria-current={isActive ? 'true' : undefined}
      >
        <span className={styles.activeBar} aria-hidden="true" />
        <span className={styles.itemIcon}>
          {item.isIrisy ? (
            <IrisyMascot state={irisyState} size={IRISY_ICON_SIZE} />
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
  const topItems = allItems.filter((i) => !i.isSettings);

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
          {topItems.map(renderItem)}
        </nav>

        <div className={styles.footer}>
          {settingsItem && renderItem(settingsItem)}
          <button
            type="button"
            className={styles.versionRow}
            data-state={update.state}
            data-available={update.available || undefined}
            title={versionTitle}
            onClick={onVersionClick}
            disabled={update.state === 'installing'}
            aria-label={versionTitle}
          >
            <span className={styles.versionText}>{versionLabel}</span>
            {update.available && (
              <span
                className={styles.updateDot}
                aria-hidden="true"
              />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
};
