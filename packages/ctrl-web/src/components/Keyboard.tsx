// Keyboard — permanent 320px left rail. Hosts the keycap grid (4×4) and a
// system row beneath it. Pressing a keycap activates that tool into the
// workspace (right side); pressing a system key navigates to /pool /
// /irisy / /settings while leaving the keyboard itself in place.

import { useCallback, useState, type ReactElement } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { listKeycaps, type KeycapSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { IconRenderer } from '@/components/primitives';
import {
  HERMES_DASHBOARD_DEFAULT_URL,
  HERMES_SETTINGS_TAB_ID,
  useTabStore,
} from '@/lib/tab-store';
import styles from './Keyboard.module.css';

const KEYCAPS_PER_PAGE = 15; // 4×4 grid; the 16th cell is always the "+" add button.

interface SystemKey {
  id: 'pool' | 'search' | 'irisy' | 'settings';
  label: string;
  to?: '/pool' | '/irisy' | '/settings';
  /** If set, clicking opens this kind of workspace tab instead of routing. */
  opensTab?: 'hermes-settings';
  icon: ReactElement;
}

const PoolIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M7 9h.01M11 9h.01M15 9h.01M7 13h10M7 16h6" />
  </svg>
);
const SearchIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="6" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
const IrisyIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="9.5" cy="11" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="11" r="1" fill="currentColor" stroke="none" />
    <path d="M10 14.5c0.5 0.5 1 0.7 2 0.7s1.5-0.2 2-0.7" />
  </svg>
);
const GearIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3h.1a1.65 1.65 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8v.1a1.65 1.65 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z" />
  </svg>
);

const SYSTEM_KEYS: ReadonlyArray<SystemKey> = [
  { id: 'pool', label: 'Pool', to: '/pool', icon: <PoolIcon /> },
  { id: 'search', label: 'Search', icon: <SearchIcon /> },
  { id: 'irisy', label: 'Irisy', to: '/irisy', icon: <IrisyIcon /> },
  // Settings opens the hermes dashboard as a workspace tab — that's the
  // canonical "brain config" surface (skills / models / providers / memory).
  // The old /settings route stays for CTRL-shell-only preferences but isn't
  // the system-key target anymore.
  { id: 'settings', label: 'Settings', opensTab: 'hermes-settings', icon: <GearIcon /> },
];

interface KeycapCellProps {
  keycap: KeycapSummary;
  active: boolean;
  onActivate: (id: string) => void;
}

// Keycap face dispatches through the canonical IconRenderer (per
// .olym/skills/thorvg/SKILL.md §3.1). Today the kernel sends
// `icon: string` glyphs (emoji / 1-2 chars); normalizeIcon wraps those
// as { kind: 'glyph' }. Once the kernel ships the discriminated union
// (handoff: thorvg-icon-schema) Lottie / SVG keycaps render without
// any change at this layer.
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [searchOpen, setSearchOpen] = useState(false);
  const openTab = useTabStore((s) => s.openTab);
  const activeTabId = useTabStore((s) => s.activeId);

  const openHermesSettingsTab = useCallback((): void => {
    openTab({
      id: HERMES_SETTINGS_TAB_ID,
      kind: 'external-embed',
      title: 'Hermes Settings',
      url: HERMES_DASHBOARD_DEFAULT_URL,
    });
    // Settings lives in workspace tabs at `/`; route there if we're elsewhere.
    if (pathname !== '/') void navigate({ to: '/' });
  }, [openTab, navigate, pathname]);

  const handleSystemKeyClick = useCallback(
    (s: SystemKey): void => {
      if (s.opensTab === 'hermes-settings') {
        openHermesSettingsTab();
        return;
      }
      if (s.to) void navigate({ to: s.to });
    },
    [navigate, openHermesSettingsTab],
  );

  const { data: keycaps = [] } = useQuery({
    queryKey: ['keycaps'],
    queryFn: listKeycaps,
  });

  const visible = keycaps.slice(0, KEYCAPS_PER_PAGE);
  const empties = Math.max(0, KEYCAPS_PER_PAGE - visible.length);

  const handleActivate = (id: string): void => {
    // Route to a keycap workspace view. For T0 hotkey-only keycaps the
    // navigation will land on a default view that immediately invokes
    // the keycap and shows a toast — wired in the workspace template.
    // Search key matches workspace.tsx readKeycapId(): "keycap_id".
    void navigate({ to: '/workspace', search: { keycap_id: id } as never });
  };

  return (
    <aside className={styles.rail} aria-label="Keyboard — keycap rail">
      <div className={styles.search} onClick={() => setSearchOpen(true)}>
        <SearchIcon />
        <input
          placeholder="search keycaps…"
          aria-label="Search keycaps"
          onBlur={() => setSearchOpen(false)}
          autoFocus={searchOpen}
        />
        <kbd>⌘K</kbd>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>keys</span>
        <div className={styles.grid}>
          {visible.map((k) => (
            <KeycapCell
              key={k.id}
              keycap={k}
              active={false}
              onActivate={handleActivate}
            />
          ))}
          {Array.from({ length: empties }).map((_, i) => (
            <button
              key={`empty-${i}`}
              type="button"
              className={`${styles.cap} ${styles.capEmpty}`}
              aria-label="Empty slot"
              tabIndex={-1}
            >
              <span className={styles.capIcon} aria-hidden="true">·</span>
            </button>
          ))}
          {/* 16th cell — always the "+ add" button. Routes to /pool so
              the user can browse and install a new keycap. */}
          <button
            type="button"
            className={`${styles.cap} ${styles.capEmpty}`}
            aria-label="Add new keycap"
            onClick={() => void navigate({ to: '/pool' })}
            title="Add keycap"
          >
            <span className={styles.capIcon}>+</span>
            <span className={styles.capLabel}>Add</span>
          </button>
        </div>
      </div>

      <div className={styles.spacer} />

      <div className={styles.section}>
        <span className={styles.sectionLabel}>system</span>
        <div className={styles.grid}>
          {SYSTEM_KEYS.map((s) => {
            // Active when the route matches OR (for tab-opening keys)
            // when the corresponding tab is the active workspace tab.
            const active = s.to
              ? pathname === s.to
              : s.opensTab === 'hermes-settings'
                ? pathname === '/' && activeTabId === HERMES_SETTINGS_TAB_ID
                : false;
            return (
              <button
                key={s.id}
                type="button"
                className={styles.cap}
                data-active={active}
                onClick={() => handleSystemKeyClick(s)}
                title={s.label}
              >
                <span className={styles.capIcon} aria-hidden="true">{s.icon}</span>
                <span className={styles.capLabel}>{s.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
};
