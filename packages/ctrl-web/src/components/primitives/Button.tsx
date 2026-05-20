// Button — primary action element.
//
// Variants: primary (cobalt fill) / ghost (outline) / danger (red fill).
// Sizes:    sm (28px) / md (36px). md is the default, matches input height.
//
// Forwards ref so callers can focus / measure / attach popovers programmatically.
// Native <button> semantics — type defaults to 'button' to avoid the implicit
// 'submit' surprise in forms.

import { forwardRef, type ButtonHTMLAttributes, type ReactElement } from 'react';
import { cx } from './cx';
import styles from './Button.module.css';

type Variant = 'primary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  /** Optional className for layout-only overrides; visual styles stay token-driven. */
  className?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'primary', size = 'md', fullWidth, type = 'button', className, ...rest },
    ref,
  ): ReactElement => (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        styles[`variant_${variant}`],
        styles[`size_${size}`],
        fullWidth && styles.fullWidth,
        className,
      )}
      {...rest}
    />
  ),
);

Button.displayName = 'Button';
