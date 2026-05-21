// [H-2026-05-18-001] Patience pip — Lv1-4 dwell indicator for streaming.
//
// Lv thresholds (per Athena v0.2):
//   Lv1   0-1s    "Thinking…"
//   Lv2   1-3s    "Thinking…"
//   Lv3   3-8s    "Working through it…"
//   Lv4   8s+     "Almost there. Hang on."
//
// Visual: 4 small dots; filled count = Lv. Subtle pulse on the rightmost
// filled dot via CSS animation.

import { useEffect, useState } from 'react';
import styles from './PatiencePip.module.css';

interface PatiencePipProps {
  /** Wall-clock start of the current turn. Resets on each new assistant turn. */
  startedAt: number | null;
}

function levelFor(elapsedMs: number): 1 | 2 | 3 | 4 {
  if (elapsedMs < 1000) return 1;
  if (elapsedMs < 3000) return 2;
  if (elapsedMs < 8000) return 3;
  return 4;
}

function labelFor(level: 1 | 2 | 3 | 4): string {
  if (level <= 2) return 'Thinking…';
  if (level === 3) return 'Working through it…';
  return 'Almost there. Hang on.';
}

export function PatiencePip({ startedAt }: PatiencePipProps): React.ReactElement | null {
  const [, force] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => force((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [startedAt]);

  if (startedAt === null) return null;
  const elapsed = Date.now() - startedAt;
  const level = levelFor(elapsed);

  return (
    <div className={styles.pip} aria-live="polite" role="status">
      <div className={styles.dots} aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`${styles.dot} ${i <= level ? styles.filled : ''} ${i === level ? styles.active : ''}`}
          />
        ))}
      </div>
      <span className={styles.label}>{labelFor(level)}</span>
    </div>
  );
}
