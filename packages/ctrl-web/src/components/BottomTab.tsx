// BottomTab — mobile-pattern primary navigation. Sits at the bottom of
// the shell so primary tabs are within thumb reach on phone-aspect
// viewports (≤ 920×560 floating shell or true mobile PWA).
//
// 4 tabs render today: Pool / Code Space / Irisy / Settings. Workspace
// is excluded — it's an independent native window opened from Pool, not
// a primary destination. Home (`/`) is reachable via the StatusBar logo
// tap, not a tab. This deviates from H-2026-05-20-001's original 3-tab
// list (Pool / Irisy / Settings) because Code Space (A1) landed after
// that handoff was drafted.

import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { cx } from './primitives/cx';
import styles from './BottomTab.module.css';

// Narrow union so the typed TanStack Router Link can still autocomplete +
// validate the path. Widening to `string` would defeat the type-safe
// router registration in app.tsx.
type TabPath = '/pool' | '/code-space' | '/irisy' | '/settings';

interface TabDef {
  to: TabPath;
  label: string;
  icon: ReactElement;
}

const KeyboardIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  </svg>
);

const CodeIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 6L2 12l6 6M16 6l6 6-6 6" />
  </svg>
);

const SparkIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
);

const GearIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3h.1a1.65 1.65 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8v.1a1.65 1.65 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z" />
  </svg>
);

const TABS: ReadonlyArray<TabDef> = [
  { to: '/pool', label: 'Pool', icon: <KeyboardIcon /> },
  { to: '/code-space', label: 'Code', icon: <CodeIcon /> },
  { to: '/irisy', label: 'Irisy', icon: <SparkIcon /> },
  { to: '/settings', label: 'Settings', icon: <GearIcon /> },
];

export const BottomTab = (): ReactElement => (
  <nav className={styles.bar} role="tablist" aria-label="Primary navigation">
    {TABS.map((tab) => (
      <Link
        key={tab.to}
        to={tab.to}
        role="tab"
        className={styles.tab}
        activeProps={{ className: cx(styles.tab, styles.tabActive), 'aria-selected': 'true' }}
      >
        <span className={styles.icon}>{tab.icon}</span>
        <span className={styles.label}>{tab.label}</span>
      </Link>
    ))}
  </nav>
);
