// Motion preference hook — single source for `prefers-reduced-motion`.
//
// Accessibility invariant: every Lottie surface must gate
// its playback through this so the OS-level accessibility toggle wins
// over any per-feature `playing` prop. Strategy: don't tear down the
// canvas; pause + speed 0 keeps the first frame readable as a static
// glyph stand-in.

import { useEffect, useState } from 'react';

const MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

export const usePrefersReducedMotion = (): boolean => {
  const [reduce, setReduce] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MEDIA_QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent): void => setReduce(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduce;
};
