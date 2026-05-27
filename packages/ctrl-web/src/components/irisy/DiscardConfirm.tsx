// DiscardConfirm — confirm modal for "Throw away the conversation".
//
// Thin wrapper over the shared `ConfirmDialog` primitive (bao
// 2026-05-26). The old bespoke backdrop + bespoke button styles were
// retired when the dialog surface migrated to the shared primitive —
// only the prompt copy + destructive variant choice live here now.

import type { ReactElement } from 'react';
import { ConfirmDialog } from '@/components/primitives';

interface DiscardConfirmProps {
  open: boolean;
  onCancel(): void;
  onConfirm(): void;
}

export function DiscardConfirm({
  open,
  onCancel,
  onConfirm,
}: DiscardConfirmProps): ReactElement {
  return (
    <ConfirmDialog
      open={open}
      title="Throw away the conversation?"
      body={
        <>
          This clears the chat, the manifest draft, and the generated server
          code. You&rsquo;ll start from an empty Irisy.
        </>
      }
      cancelLabel="Cancel"
      confirmLabel="Discard"
      destructive
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
