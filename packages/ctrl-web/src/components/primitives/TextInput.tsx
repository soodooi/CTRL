// TextInput — single-line text input. Forwards ref so FormField + react-hook-form
// can wire it transparently. Visual + a11y states (focus / invalid / disabled)
// drive purely off CSS; no JS state needed.

import { forwardRef, type InputHTMLAttributes, type ReactElement } from 'react';
import styles from './TextInput.module.css';

interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> {
  /** Defaults to 'text'. Use 'password' / 'email' / 'search' as needed. */
  type?: 'text' | 'password' | 'email' | 'search' | 'url' | 'tel';
  className?: string;
}

const cx = (...parts: Array<string | undefined | false>): string =>
  parts.filter(Boolean).join(' ');

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ type = 'text', className, ...rest }, ref): ReactElement => (
    <input
      ref={ref}
      type={type}
      className={cx(styles.input, className)}
      {...rest}
    />
  ),
);

TextInput.displayName = 'TextInput';
