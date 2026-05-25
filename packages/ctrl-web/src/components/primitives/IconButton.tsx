// IconButton — square icon-only button. L1 primitive.
//
// Three variants (ghost / outlined / primary) × three sizes (sm/md/lg)
// covers every "tap a glyph" affordance: install, dismiss, signal,
// expand, collapse, refresh, copy. ARIA-label is required because the
// children are non-textual.

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import styles from './IconButton.module.css';

export type IconButtonVariant = 'ghost' | 'outlined' | 'primary';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required because the visual is non-textual. */
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  active?: boolean;
  children: ReactNode;
}

const cls = (v: string | undefined): string => v ?? '';

export const IconButton = ({
  variant = 'ghost',
  size = 'md',
  active = false,
  className,
  type = 'button',
  children,
  ...rest
}: IconButtonProps): ReactElement => (
  <button
    type={type}
    className={[
      cls(styles.button),
      cls(styles[`variant_${variant}`]),
      cls(styles[`size_${size}`]),
      active ? cls(styles.active) : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
    {...rest}
  >
    {children}
  </button>
);
