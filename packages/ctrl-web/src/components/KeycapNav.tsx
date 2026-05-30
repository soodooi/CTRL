// KeycapNav — far-right "副 L1" icon column. Reserved for keycap-
// management actions (browse the Pool, add a keycap, etc.). bao
// 2026-05-30: 最右侧做一个副一级目录,用于管理 keycaps.
//
// First pass keeps the items minimal — Pool browse + Add — so the
// surface exists and bao can iterate on what belongs here without
// touching the shell grid.

import type { ReactElement } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import styles from './KeycapNav.module.css';

const PoolIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const AddIcon = (): ReactElement => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="8" y1="12" x2="16" y2="12" />
  </svg>
);

interface NavDef {
  id: string;
  label: string;
  icon: ReactElement;
  onActivate: (navigate: ReturnType<typeof useNavigate>) => void;
  isActive: (pathname: string) => boolean;
}

const ITEMS: ReadonlyArray<NavDef> = [
  {
    id: 'pool',
    label: 'Browse keycap pool',
    icon: <PoolIcon />,
    onActivate: (navigate) => void navigate({ to: '/pool' }),
    isActive: (p) => p.startsWith('/pool'),
  },
  {
    id: 'add',
    label: 'Create a new keycap',
    icon: <AddIcon />,
    onActivate: (navigate) =>
      void navigate({ to: '/irisy', search: { intent: 'create-keycap' } as never }),
    isActive: (p) => p.startsWith('/irisy'),
  },
];

export const KeycapNav = (): ReactElement => {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className={styles.column} aria-label="Keycap management">
      {ITEMS.map((def) => {
        const isActive = def.isActive(pathname);
        return (
          <button
            key={def.id}
            type="button"
            className={styles.item}
            data-active={isActive}
            onClick={() => def.onActivate(navigate)}
            title={def.label}
            aria-label={def.label}
            aria-current={isActive ? 'true' : undefined}
          >
            <span className={styles.itemIcon}>{def.icon}</span>
          </button>
        );
      })}
    </aside>
  );
};
