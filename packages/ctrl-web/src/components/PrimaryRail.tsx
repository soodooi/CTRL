// PrimaryRail — Level-1 primary navigation on the left edge.
//
// (Was `RightRail`, renamed 2026-05-29 when L1 flipped right → left per
// memory `feedback_l1_nav_left_and_fixed`. Component behavior unchanged;
// only the grid placement and the name moved.)
//
// 2026-05-29 restructure (bao): stripped of the Irisy mascot slot and
// the version pill — both moved out. L1 is icon-only. A toggle button at
// the top expands / closes L2 (secondary nav column to the right of L1).
// Settings stays pinned at the bottom.
//
// Irisy is no longer a peer of L1 nav items; her chat lives in the
// SHELL'S dedicated Irisy pane (always visible). RailContext still owns
// `irisyState` (used by the mascot inside IrisyChat) and a new `l2Open`
// flag the toggle writes.

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
import type { IrisyState } from './primitives/IrisyMascot';
import type { L2ItemDescriptor } from './L2Panel';
import { invoke } from '../lib/bridge';
import styles from './PrimaryRail.module.css';

const CODING_ITEM_ID = 'coding';
const WORKBENCH_ITEM_ID = 'workbench';
const VAULT_ITEM_ID = 'vault';
const POOL_ITEM_ID = 'pool';
const SETTINGS_ITEM_ID = 'settings';
const HOME_ITEM_ID = 'home';

interface RailContextValue {
  irisyState: IrisyState;
  setIrisyState: (state: IrisyState) => void;
  /** Which L1 item is selected — drives the L2 panel content when open. */
  activeRailId: string | null;
  setActiveRailId: (id: string | null) => void;
  /** Is the L2 column expanded? Default false. */
  l2Open: boolean;
  setL2Open: (open: boolean) => void;
  /** Per-L1-id L2 descriptor. Routes register via `useL2`. */
  l2ByRailId: Record<string, L2ItemDescriptor | undefined>;
  setL2For: (id: string, descriptor: L2ItemDescriptor | null) => void;
}

const RailContext = createContext<RailContextValue | null>(null);

export const RailProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [irisyState, setIrisyState] = useState<IrisyState>('idle');
  const [activeRailId, setActiveRailId] = useState<string | null>(HOME_ITEM_ID);
  const [l2Open, setL2Open] = useState(false);
  const [l2ByRailId, setL2ByRailId] = useState<Record<string, L2ItemDescriptor | undefined>>({});
  const setL2For = useCallback((id: string, descriptor: L2ItemDescriptor | null) => {
    setL2ByRailId((prev) => ({ ...prev, [id]: descriptor ?? undefined }));
  }, []);
  const value = useMemo<RailContextValue>(
    () => ({
      irisyState,
      setIrisyState,
      activeRailId,
      setActiveRailId,
      l2Open,
      setL2Open,
      l2ByRailId,
      setL2For,
    }),
    [irisyState, activeRailId, l2Open, l2ByRailId, setL2For],
  );
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
};

export const useRail = (): RailContextValue => {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error('useRail must be used inside <RailProvider>');
  return ctx;
};

/** Register the L2 descriptor for a given L1 id. Clears on unmount. */
export const useL2 = (railId: string, descriptor: L2ItemDescriptor | null): void => {
  const { setL2For } = useRail();
  useEffect(() => {
    setL2For(railId, descriptor);
  }, [railId, descriptor, setL2For]);
  useEffect(() => () => setL2For(railId, null), [railId, setL2For]);
};

// Inline icons — kept inline because the L1 set is short, fixed, and
// stroke-consistent. No external icon package needed.

const HomeIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 11l9-7 9 7v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z" />
  </svg>
);

const CodingIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="8 7 3 12 8 17" />
    <polyline points="16 7 21 12 16 17" />
    <line x1="14" y1="5" x2="10" y2="19" />
  </svg>
);

const WorkbenchIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="2.2" />
    <circle cx="18" cy="9" r="2.2" />
    <circle cx="9" cy="18" r="2.2" />
    <path d="M8 7l8 1.5M7.6 8l1.2 8" />
  </svg>
);

const VaultIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5h12a2 2 0 0 1 2 2v13H6a2 2 0 0 1-2-2V5z" />
    <path d="M4 5a2 2 0 0 1 2-2h12v15" />
    <path d="M9 8h6M9 12h4" />
  </svg>
);

const PoolIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const GearIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3h.1a1.65 1.65 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8v.1a1.65 1.65 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z" />
  </svg>
);

// Expand/close L2 toggle — chevron that flips with state.
const ToggleIcon = ({ open }: { open: boolean }): ReactElement => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {open ? (
      <polyline points="13 6 19 12 13 18" />
    ) : (
      <polyline points="11 6 5 12 11 18" />
    )}
  </svg>
);

interface RailDef {
  id: string;
  label: string;
  path: string;
  icon: ReactElement;
}

const NAV_ITEMS: ReadonlyArray<RailDef> = [
  { id: HOME_ITEM_ID, label: 'Home', path: '/', icon: <HomeIcon /> },
  { id: CODING_ITEM_ID, label: 'Coding', path: '/coding', icon: <CodingIcon /> },
  { id: WORKBENCH_ITEM_ID, label: 'Workbench', path: '/workbench', icon: <WorkbenchIcon /> },
  { id: VAULT_ITEM_ID, label: 'Vault', path: '/vault', icon: <VaultIcon /> },
  { id: POOL_ITEM_ID, label: 'Pool', path: '/pool', icon: <PoolIcon /> },
];

const SETTINGS_PATH = '/settings/ctrl';

const idForPath = (pathname: string): string => {
  if (pathname.startsWith('/coding')) return CODING_ITEM_ID;
  if (pathname.startsWith('/workbench')) return WORKBENCH_ITEM_ID;
  if (pathname.startsWith('/vault')) return VAULT_ITEM_ID;
  if (pathname.startsWith('/pool')) return POOL_ITEM_ID;
  if (pathname.startsWith('/settings')) return SETTINGS_ITEM_ID;
  return HOME_ITEM_ID;
};

export const PrimaryRail = (): ReactElement => {
  const { activeRailId, setActiveRailId } = useRail();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  // Sync active L1 with current route so the highlight matches reality.
  useEffect(() => {
    const id = idForPath(pathname);
    if (activeRailId !== id) setActiveRailId(id);
  }, [pathname, activeRailId, setActiveRailId]);

  const handleNavClick = useCallback(
    (def: RailDef) => {
      setActiveRailId(def.id);
      void navigate({ to: def.path });
    },
    [navigate, setActiveRailId],
  );

  const handleSettingsClick = useCallback(() => {
    setActiveRailId(SETTINGS_ITEM_ID);
    void navigate({ to: SETTINGS_PATH });
  }, [navigate, setActiveRailId]);

  // ▾ toggle — opens the workspace big window (1800 × 720, left of main)
  // where advanced keycaps render. See commands/system.rs::
  // toggle_workspace_window. Returns the new visibility so we can mirror
  // it in the icon state without a follow-up poll.
  const handleWorkspaceToggle = useCallback(async () => {
    try {
      const nowVisible = await invoke<boolean>('toggle_workspace_window');
      setWorkspaceOpen(nowVisible);
    } catch {
      /* browser PWA or workspace window not available — silently no-op */
    }
  }, []);

  return (
    <aside className={styles.primary} aria-label="Primary navigation">
      {/* ▾ toggle — opens the workspace window (bao 2026-05-30:
          "最上面的展开按钮,展开 keycap 管理区"). */}
      <button
        type="button"
        className={styles.l2Toggle}
        onClick={() => void handleWorkspaceToggle()}
        aria-label={workspaceOpen ? 'Close workspace window' : 'Open workspace window'}
        title={workspaceOpen ? 'Close workspace' : 'Open workspace'}
        aria-pressed={workspaceOpen}
      >
        <ToggleIcon open={workspaceOpen} />
      </button>

      <nav className={styles.nav} aria-label="Primary nav items">
        {NAV_ITEMS.map((def) => {
          const isActive = activeRailId === def.id;
          return (
            <button
              key={def.id}
              type="button"
              className={styles.item}
              data-active={isActive}
              onClick={() => handleNavClick(def)}
              title={def.label}
              aria-label={def.label}
              aria-current={isActive ? 'true' : undefined}
            >
              <span className={styles.itemIcon}>{def.icon}</span>
            </button>
          );
        })}
      </nav>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.item}
          data-active={activeRailId === SETTINGS_ITEM_ID}
          onClick={handleSettingsClick}
          title="Settings"
          aria-label="Settings"
          aria-current={activeRailId === SETTINGS_ITEM_ID ? 'true' : undefined}
        >
          <span className={styles.itemIcon}><GearIcon /></span>
        </button>
      </div>
    </aside>
  );
};
