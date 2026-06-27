// ReviewGateHost — human approval surface for the kernel review gate
// (ADR-002 substrate §264 + ADR-006 §4 autonomy ladder).
//
// A high-blast-radius call from an EXTERNAL caller (the BYO-CLI brain) parks
// at the :17873 gate awaiting a human decision. The kernel fans the
// gate-derived request out as a `review:pending` Tauri event; this host pops
// a confirm and sends the decision back via the `review_resolve` command.
//
// C3 anti-injection: the modal shows ONLY the gate-parsed tool + structured
// arg summary (built kernel-side), never any caller/LLM prose. The approval
// travels the Tauri command surface the external brain cannot reach — it
// physically cannot approve its own call.

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '../lib/bridge';
import { ConfirmDialog } from './primitives/ConfirmDialog';

interface ReviewRequest {
  id: string;
  caller: string;
  tool: string;
  arg_summary: string;
}

export const ReviewGateHost = (): React.ReactElement | null => {
  const [queue, setQueue] = useState<ReviewRequest[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let alive = true;
    const enqueue = (req: ReviewRequest) =>
      setQueue((q) => (q.some((r) => r.id === req.id) ? q : [...q, req]));

    // Seed any calls already parked before this host mounted.
    invoke<ReviewRequest[]>('review_pending')
      .then((reqs) => {
        if (alive) reqs.forEach(enqueue);
      })
      .catch(() => {
        /* kernel not up yet — the live listener will catch new ones */
      });

    const off = listen<ReviewRequest>('review:pending', (e) => enqueue(e.payload));
    return () => {
      alive = false;
      off.then((fn) => fn());
    };
  }, []);

  const head = queue[0];
  if (!head) return null;

  const resolve = async (approved: boolean) => {
    setPending(true);
    try {
      await invoke('review_resolve', { id: head.id, approved });
    } catch {
      /* the kernel call timed out / already resolved — drop it locally */
    } finally {
      setQueue((q) => q.filter((r) => r.id !== head.id));
      setPending(false);
    }
  };

  return (
    <ConfirmDialog
      open
      title="Approve this action?"
      destructive
      pending={pending}
      confirmLabel="Approve"
      cancelLabel="Deny"
      body={
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            <strong>{head.caller}</strong> wants to run a high-impact action.
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 13,
              background: 'var(--surface-sunken, rgba(0,0,0,0.06))',
              borderRadius: 6,
              padding: '8px 10px',
              wordBreak: 'break-word',
            }}
          >
            <div>
              <span style={{ opacity: 0.6 }}>tool </span>
              {head.tool}
            </div>
            <div>
              <span style={{ opacity: 0.6 }}>args </span>
              {head.arg_summary}
            </div>
          </div>
          {queue.length > 1 && (
            <div style={{ fontSize: 12, opacity: 0.6 }}>
              +{queue.length - 1} more waiting
            </div>
          )}
        </div>
      }
      onConfirm={() => void resolve(true)}
      onCancel={() => void resolve(false)}
    />
  );
};
