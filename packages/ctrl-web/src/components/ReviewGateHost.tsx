// ReviewGateHost — human approval surface for the kernel review gate
// (ADR-002 substrate §264 + ADR-006 §4 autonomy ladder).
//
// A high-blast-radius call from an EXTERNAL caller (the BYO-CLI brain) parks
// at the :17873 gate awaiting a human decision. The kernel fans the
// gate-derived request out as a `review:pending` Tauri event; this host adapts
// it into an `approval` decision fact and sends the decision back via the
// `review_resolve` command.
//
// The presentation goes through the one decision surface registry rather than a
// hand-built dialog. The gate-derived caller, operation, and argument summary
// remain VISIBLE — the current kernel request carries no target or staged
// change, so demoting them would leave the user deciding on a frontend sentence.
// Exact target plus staged before/after (ADR-005 §12 U10) requires a fact-owner
// amendment and is tracked as open Design Acceptance, not claimed here.
// (ADR-003 frontend § decision-registry v43)
//
// C3 anti-injection unchanged: the fact is built from the gate-parsed tool +
// structured arg summary (kernel-side), never from caller/LLM prose. The
// approval travels the Tauri command surface the external brain cannot reach —
// it physically cannot approve its own call.

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '../lib/bridge';
import { DecisionSurface } from './decisions/DecisionSurface';
import { approvalFact, type KernelReviewRequest } from '../lib/decision-registry';

type ReviewRequest = KernelReviewRequest;

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
    <DecisionSurface
      fact={approvalFact(head)}
      pending={pending}
      queued={queue.length - 1}
      onResolve={(optionId) => void resolve(optionId === 'approve')}
    />
  );
};
