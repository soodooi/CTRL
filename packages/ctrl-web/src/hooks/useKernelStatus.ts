// useKernelStatus — poll `kernel_status` every N ms and surface the
// last good snapshot. Keeps the most recent successful poll on
// failure so a transient kernel pause doesn't blank the cockpit
// chrome — per Zeus' guidance on the system endpoint.
//
// Default cadence 3000ms is what the StatusBar instruments + uptime
// readout need; consumers can shorten (e.g. 1000ms) when they need
// near-realtime latency feedback. Anything < 500ms is rude to the
// kernel and will be clamped.

import { useEffect, useState } from 'react';
import { kernelStatus, type KernelStatus } from '@/lib/kernel';

export interface UseKernelStatusOptions {
  intervalMs?: number;
  /** When false the hook does not poll (useful for routes that don't
   *  need live data). The hook still returns the last known snapshot. */
  enabled?: boolean;
}

const MIN_INTERVAL_MS = 500;
const DEFAULT_INTERVAL_MS = 3000;

export function useKernelStatus(
  options: UseKernelStatusOptions = {},
): KernelStatus | null {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;
  const safe = Math.max(MIN_INTERVAL_MS, intervalMs);
  const [snapshot, setSnapshot] = useState<KernelStatus | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const tick = async (): Promise<void> => {
      try {
        const next = await kernelStatus();
        if (mounted) setSnapshot(next);
      } catch {
        // Keep last good — silently dropping a single failed poll is
        // friendlier than flashing "—" in the chrome.
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), safe);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [enabled, safe]);

  return snapshot;
}
