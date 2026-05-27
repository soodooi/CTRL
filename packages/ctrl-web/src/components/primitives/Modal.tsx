// Modal — primitive overlay surface with portal + focus trap + esc.
//
// Replaces the three ad-hoc dialog backdrops that drifted across the
// codebase (NewEnvModal, DiscardConfirm, CommandBar) — each invented
// its own backdrop alpha, border radius, shadow depth, and entry
// animation. Modal is now the single source of truth for those choices.
//
// Use this as the structural shell; render whatever body content the
// surface needs as children. ConfirmDialog wraps Modal for the
// common cancel/confirm case.
//
// Accessibility:
//   - Portaled to `document.body` so parent z-index / overflow can't
//     clip the overlay.
//   - `role="dialog"` + `aria-modal="true"`, labelled via `titleId` or
//     `aria-label`.
//   - Esc closes (unless `dismissOnEsc=false`).
//   - Backdrop click closes (unless `dismissOnBackdropClick=false`).
//   - Focus on open: first focusable child OR `initialFocusRef`, with
//     a fallback to the dialog card itself.
//   - Tab/Shift+Tab cycle inside the dialog (focus trap).
//   - Restores focus to the previously-active element on close.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import styles from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional title used as the dialog's accessible name. If omitted,
   *  pass `ariaLabel` instead. */
  title?: ReactNode;
  /** Subtitle / short description under the title. */
  subtitle?: ReactNode;
  children: ReactNode;
  /** Footer slot — typically a row of Buttons. */
  footer?: ReactNode;
  /** Maximum card width. Defaults to 480px (good for forms / confirms). */
  maxWidth?: number;
  /** Set to false to opt out of backdrop-click dismissal — useful when
   *  the body holds a pending mutation that mustn't be cancelled by a
   *  mis-click. */
  dismissOnBackdropClick?: boolean;
  /** Set to false to opt out of Esc dismissal (same reasoning). */
  dismissOnEsc?: boolean;
  /** Forced ARIA label when no visible title is present. */
  ariaLabel?: string;
  /** Element to focus when the modal opens. Defaults to the first
   *  focusable child inside the card. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Optional className for the card itself; visual tokens stay
   *  centralised, this is layout-only. */
  cardClassName?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute('aria-hidden') && el.offsetParent !== null,
  );

export const Modal = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = 480,
  dismissOnBackdropClick = true,
  dismissOnEsc = true,
  ariaLabel,
  initialFocusRef,
  cardClassName,
}: ModalProps): ReactElement | null => {
  const cardRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const subtitleId = useId();

  // Esc dismissal + focus trap. One keydown listener handles both.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dismissOnEsc) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const focusables = getFocusable(card);
      if (focusables.length === 0) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !card.contains(active)) {
          e.preventDefault();
          last?.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissOnEsc]);

  // Initial focus + restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (!card) return;
    // Defer to next frame so initial render layouts before we focus.
    const raf = requestAnimationFrame(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
        return;
      }
      const focusables = getFocusable(card);
      (focusables[0] ?? card).focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, initialFocusRef]);

  const handleBackdropClick = useCallback(() => {
    if (dismissOnBackdropClick) onClose();
  }, [dismissOnBackdropClick, onClose]);

  if (!open) return null;

  const labelledBy = title ? titleId : undefined;
  const describedBy = subtitle ? subtitleId : undefined;

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
        className={cx(styles.card, cardClassName)}
        style={{ maxWidth: `${maxWidth}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || subtitle) && (
          <header className={styles.head}>
            {title && (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            )}
            {subtitle && (
              <p id={subtitleId} className={styles.subtitle}>
                {subtitle}
              </p>
            )}
          </header>
        )}
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};
