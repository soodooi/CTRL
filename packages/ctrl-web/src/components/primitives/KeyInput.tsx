// KeyInput — hotkey recorder. Focus the field, press a combination, and
// the captured combo is reported back as a normalized string ("Ctrl+Shift+K").
//
// Why a dedicated component: a plain TextInput cannot intercept the
// modifier+letter combo before the browser fires global shortcuts (and we
// want the field to feel "armed" — visually distinct from a regular input).
// Settings.tsx will consume this for the lone-Ctrl hotkey config (waiting
// on zeus's set_hotkey command; for now the captured combo is just stored
// via the onChange callback).

import { useState, type KeyboardEvent, type ReactElement } from 'react';
import { cx } from './cx';
import styles from './KeyInput.module.css';

interface KeyInputProps {
  /** Current combo string, e.g. "Ctrl" or "Ctrl+Shift+K". Empty means unbound. */
  value: string;
  onChange: (combo: string) => void;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  placeholder?: string;
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;

const buildCombo = (event: KeyboardEvent<HTMLDivElement>): string => {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Meta');

  const key = event.key;
  // Single Ctrl / Alt / Shift / Meta press records as the modifier alone
  // (lone-Ctrl is a valid hotkey for CTRL's launcher).
  if (MODIFIER_ORDER.includes(key as (typeof MODIFIER_ORDER)[number])) {
    return parts.join('+') || key;
  }

  const normalized = key.length === 1 ? key.toUpperCase() : key;
  parts.push(normalized);
  return parts.join('+');
};

export const KeyInput = ({
  value,
  onChange,
  id,
  placeholder = 'Press a key combination…',
  ...aria
}: KeyInputProps): ReactElement => {
  const [recording, setRecording] = useState(false);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!recording) return;
    if (event.key === 'Escape') {
      setRecording(false);
      return;
    }
    if (event.key === 'Tab') return; // let focus traversal through
    event.preventDefault();
    event.stopPropagation();
    onChange(buildCombo(event));
  };

  return (
    <div
      id={id}
      role="textbox"
      tabIndex={0}
      aria-readonly="true"
      aria-label={placeholder}
      className={cx(styles.field, recording && styles.recording)}
      onFocus={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={handleKeyDown}
      {...aria}
    >
      <span className={styles.value}>
        {value || <span className={styles.placeholder}>{placeholder}</span>}
      </span>
      {/* aria-live so screen readers announce the recording state flip
          when the field is focused / blurred — the visual badge change
          alone is invisible to AT users. polite (not assertive) so the
          announcement queues behind any active speech. */}
      <span className={styles.badge} aria-live="polite">
        {recording ? 'recording' : 'idle'}
      </span>
    </div>
  );
};
