// [H-2026-05-18-001] DiscardConfirm — confirm modal for "Discard & restart".

import { useEffect } from 'react';
import styles from './DiscardConfirm.module.css';

interface DiscardConfirmProps {
  open: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function DiscardConfirm({
  open,
  onCancel,
  onConfirm,
}: DiscardConfirmProps): React.ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="discard-title">
      <div className={styles.panel}>
        <h2 id="discard-title" className={styles.title}>
          Throw away the conversation?
        </h2>
        <p className={styles.body}>
          This clears the chat, the manifest draft, and the generated server code.
          You&rsquo;ll start from an empty Irisy.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.confirm} onClick={onConfirm}>
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
