// CommandBar — Cmd-K palette. L1 primitive.
//
// Centered overlay with a single search input + selectable result
// rows. Keyboard navigation (↑ ↓ ↵ esc) wired internally so the
// consumer just supplies items + onSelect. Fuzzy matching is the
// caller's responsibility (pass filtered items); CommandBar is
// presentation-only so any matcher (substring, fuzzysort, fzf-style)
// can plug in without forking the primitive.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './CommandBar.module.css';

export interface CommandItem {
  id: string;
  label: string;
  /** Short visual badge (2-3 chars) shown left of the label. */
  glyph?: string;
  /** Right-aligned hint, e.g. "mcp" / "route". */
  hint?: string;
}

export interface CommandBarProps {
  /** Controls the overlay; when false the component renders null. */
  open: boolean;
  /** Called when the user dismisses via Esc or backdrop click. */
  onClose: () => void;
  /** Items already filtered by the consumer's matcher. */
  items: ReadonlyArray<CommandItem>;
  /** Selection — called on ↵ or click. */
  onSelect: (item: CommandItem) => void;
  /** Controlled query value. */
  query: string;
  onQueryChange: (next: string) => void;
  placeholder?: string;
  /** Custom empty state. */
  emptyState?: ReactNode;
}

export const CommandBar = ({
  open,
  onClose,
  items,
  onSelect,
  query,
  onQueryChange,
  placeholder = 'Type a command…',
  emptyState,
}: CommandBarProps): ReactElement | null => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [highlight, setHighlight] = useState(0);

  // Reset highlight whenever the result set changes.
  useEffect(() => {
    setHighlight(0);
  }, [items]);

  // Focus the input on open + bind Esc / arrow handlers on the document
  // so the user can navigate without touching the input.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleListNav = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = items[highlight];
      if (picked) onSelect(picked);
    }
  };

  // Memoize for stable reference identity on rapid keypresses.
  const list = useMemo(() => items, [items]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={styles.shell}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.input}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={handleListNav}
            placeholder={placeholder}
            aria-label="Command query"
          />
          <span className={styles.kbd}>Esc</span>
        </div>

        <div className={styles.list}>
          {list.length === 0 ? (
            <div className={styles.empty}>{emptyState ?? 'No matches'}</div>
          ) : (
            list.map((item, i) => (
              <button
                key={item.id}
                type="button"
                className={styles.row}
                data-active={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => onSelect(item)}
              >
                {item.glyph && <span className={styles.rowGlyph}>{item.glyph}</span>}
                <span className={styles.rowLabel}>{item.label}</span>
                {item.hint && <span className={styles.rowHint}>{item.hint}</span>}
              </button>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.footerHint}>↑↓ navigate</span>
          <span className={styles.footerHint}>↵ select</span>
          <span className={styles.footerHint}>esc close</span>
        </div>
      </div>
    </div>
  );
};
