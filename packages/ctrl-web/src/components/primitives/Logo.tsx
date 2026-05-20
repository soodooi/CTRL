// Logo — CTRL brand mark.
//
// Mark-only variant is shipped first because StatusBar (H-2026-05-20-001)
// and Settings need it now. Wordmark variant will land when marketing /
// onboarding surfaces ask for it (currently 0 production callers).
// Source: doc/visual-identity/logo-mark.svg → public/icons/logo-mark.svg.

import type { ReactElement } from 'react';
import styles from './Logo.module.css';

type Size = 'sm' | 'md' | 'lg';

interface LogoProps {
  size?: Size;
  /** Override the aria-label. Defaults to "CTRL". */
  ariaLabel?: string;
}

const PIXEL_SIZE: Record<Size, number> = {
  sm: 20,
  md: 28,
  lg: 40,
};

export const Logo = ({ size = 'md', ariaLabel = 'CTRL' }: LogoProps): ReactElement => {
  const px = PIXEL_SIZE[size];
  return (
    <img
      src="/icons/logo-mark.svg"
      width={px}
      height={px}
      alt={ariaLabel}
      className={styles.logo}
      draggable={false}
    />
  );
};
