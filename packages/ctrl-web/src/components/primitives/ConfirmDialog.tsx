// ConfirmDialog — Modal wrapper for the canonical cancel/confirm flow.
//
// Use this when the surface is "do you want to do this?" — destructive
// resets, irreversible writes, anything where a single misclick on a
// scattered backdrop should not commit. For form-style modals (Code
// Space new env, keycap editor) reach for `Modal` directly and own the
// body markup.

import { useRef, type ReactElement, type ReactNode } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  /** Body content — either a single paragraph (passed as string) or
   *  richer JSX when extra context is needed. */
  body?: ReactNode;
  /** Label for the confirm action. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel action. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Renders the confirm button with the danger variant. Use for
   *  destructive actions (delete, discard, sign out, …). */
  destructive?: boolean;
  /** Disables both buttons while a parent mutation is in flight; the
   *  surface also stops responding to Esc / backdrop click. */
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmDialog = ({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  pending = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): ReactElement => {
  // Park initial focus on the cancel button — destructive defaults
  // never bait the user into a fatal Enter keypress.
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      maxWidth={440}
      dismissOnBackdropClick={!pending}
      dismissOnEsc={!pending}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? '…' : confirmLabel}
          </Button>
        </>
      }
    >
      {typeof body === 'string' ? <p>{body}</p> : body}
    </Modal>
  );
};
