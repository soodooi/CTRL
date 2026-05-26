// KeycapMenu — hover-reveal 3-dot popover on a keycap cell.
//
// Per the UX research (PlayCanvas right-click → Duplicate, n8n hover
// ellipsis → context menu, Dify card 3-dot → Duplicate): a small
// popover above the cell with the canonical row of actions. Keyboard
// focus + ArrowUp/Down navigation, Esc to dismiss, click outside to
// dismiss. NOT a context menu — a peer cluster of buttons.

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import styles from './KeycapMenu.module.css';

export interface KeycapMenuItem {
  id: string;
  label: string;
  /** Optional keyboard shortcut hint shown right-aligned. */
  shortcut?: string;
  /** When true the item renders muted + click is a no-op. */
  disabled?: boolean;
  /** Marks the item as destructive (Remove etc.) — gets danger color. */
  destructive?: boolean;
  onSelect: () => void;
}

interface KeycapMenuProps {
  /** Element the menu is anchored under. Used for outside-click detection
   *  and for the popover's positioning ref. */
  anchorRef: RefObject<HTMLElement | null>;
  items: ReadonlyArray<KeycapMenuItem>;
  onDismiss: () => void;
}

export const KeycapMenu = ({
  anchorRef,
  items,
  onDismiss,
}: KeycapMenuProps): ReactElement => {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Outside click + Esc dismissal. Capture-phase listener so it fires
  // before the synthetic event reaches a sibling keycap's onClick.
  useEffect(() => {
    const onPointer = (e: PointerEvent): void => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onDismiss();
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, onDismiss]);

  // First enabled item gets initial focus so keyboard users land
  // somewhere meaningful.
  useEffect(() => {
    const first = popoverRef.current?.querySelector<HTMLButtonElement>(
      'button:not([disabled])',
    );
    first?.focus();
  }, []);

  const handleNav = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const buttons = Array.from(
        popoverRef.current?.querySelectorAll<HTMLButtonElement>(
          'button:not([disabled])',
        ) ?? [],
      );
      if (buttons.length === 0) return;
      const current = document.activeElement;
      const idx = buttons.findIndex((b) => b === current);
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (idx + delta + buttons.length) % buttons.length;
      buttons[next]?.focus();
    },
    [],
  );

  return (
    <div
      ref={popoverRef}
      className={styles.menu}
      role="menu"
      aria-label="Keycap actions"
      onKeyDown={handleNav}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className={styles.item}
          data-destructive={item.destructive || undefined}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onDismiss();
          }}
        >
          <span className={styles.itemLabel}>{item.label}</span>
          {item.shortcut && (
            <span className={styles.itemShortcut}>{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
};

const DotsIcon = (): ReactElement => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="currentColor"
    aria-hidden="true"
  >
    <circle cx="3" cy="7" r="1.4" />
    <circle cx="7" cy="7" r="1.4" />
    <circle cx="11" cy="7" r="1.4" />
  </svg>
);

interface MenuTriggerProps {
  /** Click handler — parent owns whether the menu is open. */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
}

/** The visible 3-dot button that opens the menu. Hover-revealed via
 *  CSS in the cell that contains it (set `.cap:hover .menuTrigger`). */
export const KeycapMenuTrigger = ({
  onClick,
  ariaLabel = 'Keycap actions',
}: MenuTriggerProps): ReactElement => (
  <button
    type="button"
    className={styles.trigger}
    onClick={(e) => {
      e.stopPropagation();
      onClick(e);
    }}
    aria-label={ariaLabel}
    title={ariaLabel}
  >
    <DotsIcon />
  </button>
);
