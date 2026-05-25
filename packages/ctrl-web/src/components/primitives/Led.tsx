// Led — status indicator dot. L1 primitive.
//
// PFD-color discipline: nominal (green) / caution (amber pulsed) /
// warning (red) / info (CTRL blue) / offline (gray, no glow) /
// unknown (subtle ring, no fill).

import type { ReactElement } from 'react';
import styles from './Led.module.css';

export type LedTone =
  | 'nominal'
  | 'caution'
  | 'warning'
  | 'info'
  | 'offline'
  | 'unknown';

export interface LedProps {
  tone?: LedTone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const cls = (v: string | undefined): string => v ?? '';

export const Led = ({
  tone = 'unknown',
  size = 'md',
  className,
  label,
}: LedProps): ReactElement => (
  <span
    className={[
      cls(styles.led),
      cls(styles[`size_${size}`]),
      cls(styles[`tone_${tone}`]),
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
  />
);
