// PrimaryRail — Level-1 primary navigation on the left edge.
//
// (Was `RightRail`, renamed 2026-05-29 when L1 flipped right → left per
// memory `feedback_l1_nav_left_and_fixed`.)
//
// L1 = icon-only chips. ▾ at the top toggles the NSWindow workspace
// (separate Tauri child window, addChildWindow left of main). Settings
// pinned at the bottom. Irisy chat is shell-level (always visible right
// column), not an L1 peer.
//
// 2026-05-30 (ADR-003 frontend §2): L1 nav = `[Irisy, Coding]` 2 chips. Create
// removed — keycap-designer is an internal Irisy mode per memory
// `decision_one_persona_irisy`.
//
// 2026-05-31 (ADR-003 frontend §7): the legacy `L2Panel` + `useL2` API is gone.
// L2 is now a shell-level reserved column (left of L1, in `app.module.css`)
// driven by the NSWindow's active tab. L1 chips will be rewired to open
// NSWindow with chip-specific content (Keycap / Vault / Coding /
// Settings) in a follow-up PR; for now they keep the legacy route nav
// so navigation does not break during the transition.

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
import { invoke } from '../lib/bridge';
import { useWorkspaceStore } from '../lib/workspace-store';
import styles from './PrimaryRail.module.css';

// L1 nav ids — bao 2026-05-30 (ADR-003 frontend §2): ▾ workspace toggle (top) +
// 2 nav (Irisy / Coding) + Settings (bottom). ADR-003 frontend §7 target is 4
// chips (Keycap / Vault / Coding / Settings) opening NSWindow content;
// rewiring deferred to a follow-up PR.
const IRISY_ITEM_ID = 'builtin-irisy';
const CODING_ITEM_ID = 'coding';
const POOL_ITEM_ID = 'pool';
const SETTINGS_ITEM_ID = 'settings';

interface RailContextValue {
  irisyState: IrisyState;
  setIrisyState: (state: IrisyState) => void;
  /** Which L1 item is selected. */
  activeRailId: string | null;
  setActiveRailId: (id: string | null) => void;
}

const RailContext = createContext<RailContextValue | null>(null);

export const RailProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [irisyState, setIrisyState] = useState<IrisyState>('idle');
  const [activeRailId, setActiveRailId] = useState<string | null>(IRISY_ITEM_ID);
  const value = useMemo<RailContextValue>(
    () => ({ irisyState, setIrisyState, activeRailId, setActiveRailId }),
    [irisyState, activeRailId],
  );
  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
};

export const useRail = (): RailContextValue => {
  const ctx = useContext(RailContext);
  if (!ctx) throw new Error('useRail must be used inside <RailProvider>');
  return ctx;
};

// Inline icons — kept inline because the L1 set is short, fixed, and
// stroke-consistent. No external icon package needed.

const PoolIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.4" />
    <rect x="14" y="3" width="7" height="7" rx="1.4" />
    <rect x="3" y="14" width="7" height="7" rx="1.4" />
    <rect x="14" y="14" width="7" height="7" rx="1.4" />
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

// Irisy icon — eye (iris) inside a soft chat halo. Single user-facing
// companion; the create-mode used to have its own icon (plus-in-square)
// but Irisy is one persona now, internal modes invisible.
const IrisyIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="11" r="6" />
    <circle cx="12" cy="11" r="2.2" fill="currentColor" stroke="none" />
    <path d="M9 17l-2 3 4-2" />
  </svg>
);

const NAV_ITEMS: ReadonlyArray<RailDef> = [
  { id: IRISY_ITEM_ID, label: 'Irisy', path: '/', icon: <IrisyIcon /> },
  { id: POOL_ITEM_ID, label: 'Keycap pool', path: '/pool', icon: <PoolIcon /> },
  { id: CODING_ITEM_ID, label: 'Coding', path: '/coding', icon: <CodingIcon /> },
];

const SETTINGS_PATH = '/settings/ctrl';

const idForPath = (pathname: string): string => {
  if (pathname.startsWith('/coding')) return CODING_ITEM_ID;
  if (pathname.startsWith('/pool')) return POOL_ITEM_ID;
  if (pathname.startsWith('/settings')) return SETTINGS_ITEM_ID;
  // `/irisy` is now an alias landing on Irisy (no separate Create item).
  return IRISY_ITEM_ID;
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
      // bao 2026-06-01: tab-bound L1 chips open a route tab in the
      // workspace tab area; the Tauri shell separately expands the main
      // window so the Tab column is visible. Irisy stays as full-window
      // navigation since it lives in the always-on right pane.
      if (def.id === POOL_ITEM_ID || def.id === CODING_ITEM_ID) {
        useWorkspaceStore.getState().openSystemTab({
          id: def.id,
          kind: 'route',
          path: def.path,
          title: def.label,
        });
        void invoke<boolean>('toggle_workspace_window').catch(() => undefined);
        return;
      }
      void navigate({ to: def.path });
    },
    [navigate, setActiveRailId],
  );

  const handleSettingsClick = useCallback(() => {
    setActiveRailId(SETTINGS_ITEM_ID);
    // bao 2026-06-01: L1 click opens a route tab in the singleton
    // "system" workspace instance (L2 pane), not a full-window navigate.
    // The Tauri shell separately expands the window leftward when any
    // workspace instance exists so the new tab is visible.
    useWorkspaceStore.getState().openSystemTab({
      id: 'settings',
      kind: 'route',
      path: SETTINGS_PATH,
      title: 'Settings',
    });
    void invoke<boolean>('toggle_workspace_window').catch(() => undefined);
  }, [setActiveRailId]);

  // ▾ toggle — opens the workspace big window (macOS NSWindow
  // addChildWindow of main, 1370×720, left of main). Three close paths:
  // this ▾, the → button on the workspace header, and the Ctrl hotkey
  // (cascades via WindowController). bao 2026-05-30: workspace v2 ship.
  const handleWorkspaceToggle = useCallback(async () => {
    try {
      const nowVisible = await invoke<boolean>('toggle_workspace_window');
      setWorkspaceOpen(nowVisible);
    } catch {
      /* browser PWA or unsupported platform — silently no-op */
    }
  }, []);

  return (
    <aside className={styles.primary} aria-label="Primary navigation">
      {/* Workspace toggle — pinned at the top of L1. The other 2 close
          paths are: → button on workspace itself, and global Ctrl hide. */}
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
