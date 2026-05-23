// ChatInput — L1 primitive for chat / composer surfaces.
//
// Controlled input with optional submit-hint chip (defaults to "↵").
// Submit fires on Enter; Shift+Enter is reserved for future multiline
// upgrade (when consumers swap to a textarea variant).

import { useId, type FormEvent, type ReactElement } from 'react';
import styles from './ChatInput.module.css';

export interface ChatInputProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** ARIA label for the input. Defaults to the placeholder. */
  ariaLabel?: string;
  className?: string;
}

export const ChatInput = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  hint = '↵',
  autoFocus,
  disabled,
  ariaLabel,
  className,
}: ChatInputProps): ReactElement => {
  const inputId = useId();
  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };
  return (
    <form
      className={[styles.shell, disabled ? styles.disabled : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      onSubmit={handleSubmit}
    >
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={styles.field}
        aria-label={ariaLabel ?? placeholder ?? 'Message'}
      />
      <span className={styles.hint}>{hint}</span>
    </form>
  );
};
