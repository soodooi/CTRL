// Canonical production L1 navigation.
// Irisy is resident in the shell and capabilities are browsed only in Library.
// (ADR-003 frontend §8.5 v40)

import type { ReactElement } from 'react';
import styles from './Sidebar.module.css';

export type SidebarSection = 'work' | 'library' | 'settings';

interface SidebarProps {
  active: SidebarSection;
  onSelect: (section: SidebarSection) => void;
}

type IconProps = { children: ReactElement | ReactElement[] };

function Icon({ children }: IconProps): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const entries: Array<{
  id: SidebarSection;
  label: string;
  icon: ReactElement;
}> = [
  {
    id: 'work',
    label: 'Work',
    icon: (
      <Icon>
        <path d="M4 7h6l2 2h8v10H4z" />
        <path d="M4 7V5h6l2 2" />
      </Icon>
    ),
  },
  {
    id: 'library',
    label: 'Library',
    icon: (
      <Icon>
        <path d="M5 4h5v16H5zM14 4h5v16h-5z" />
        <path d="M7.5 8h0M16.5 8h0" />
      </Icon>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
      </Icon>
    ),
  },
];

export function Sidebar({ active, onSelect }: SidebarProps): ReactElement {
  return (
    <aside className={styles.rail} data-tauri-drag-region aria-label="Primary navigation">
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={`${styles.ic} ${active === entry.id ? styles.active : ''}`}
          onClick={() => onSelect(entry.id)}
          title={entry.label}
          aria-label={entry.label}
          aria-current={active === entry.id ? 'page' : undefined}
        >
          {entry.icon}
        </button>
      ))}
    </aside>
  );
}
