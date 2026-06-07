// StatusPill — label chip. L1 primitive.
//
// Tone-driven small badge used for "installed" / "MCP" / "running"
// labels on cards, list rows, mcp manifests. Pairs with Led when
// you need both a dot and a text label.

import type { ReactElement, ReactNode } from 'react';
import type { LedTone } from './Led';
import styles from './StatusPill.module.css';

export interface StatusPillProps {
  tone?: LedTone;
  children: ReactNode;
  className?: string;
}

const cls = (v: string | undefined): string => v ?? '';

export const StatusPill = ({
  tone = 'unknown',
  children,
  className,
}: StatusPillProps): ReactElement => (
  <span
    className={[cls(styles.pill), cls(styles[`tone_${tone}`]), className ?? '']
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </span>
);
