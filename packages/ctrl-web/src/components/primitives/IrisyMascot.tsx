// IrisyMascot — Irisy's visible form. SVG stub today; Rive in Phase 1B.
//
// Public contract preserved across the swap:
//   - <IrisyMascot state="idle" size={44} />
//   - state ∈ IrisyState (6 values matching the Rive state machine)
//
// Phase 1B will replace the SVG with @rive-app/react-canvas pointing at
// irisy.riv, with the same prop surface. Until then this renders a 24×24
// vector portrait — breathe loop and blink driven by CSS keyframes.

import type { ReactElement } from 'react';
import styles from './IrisyMascot.module.css';

export type IrisyState =
  | 'idle'
  | 'watching'
  | 'thinking'
  | 'happy'
  | 'worried'
  | 'sleeping';

interface IrisyMascotProps {
  state?: IrisyState;
  size?: number;
}

export const IrisyMascot = ({
  state = 'idle',
  size = 44,
}: IrisyMascotProps): ReactElement => (
  <svg
    className={styles.mascot}
    data-state={state}
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    role="img"
    aria-label={`Irisy — ${state}`}
  >
    <defs>
      <clipPath id="eye-l-clip">
        <circle cx="12" cy="16" r="3.2" />
      </clipPath>
      <clipPath id="eye-r-clip">
        <circle cx="20" cy="16" r="3.2" />
      </clipPath>
    </defs>

    {/* Face — rounded square, signature CTRL keycap shape */}
    <rect
      className={styles.face}
      x="3"
      y="4"
      width="26"
      height="24"
      rx="8"
    />

    <g className={styles.eyes}>
      {/* Eye whites */}
      <circle cx="12" cy="16" r="3.2" fill="var(--paper)" />
      <circle cx="20" cy="16" r="3.2" fill="var(--paper)" />
      {/* Pupils */}
      <circle className={styles.pupil} cx="12" cy="16" r="1.8" />
      <circle className={styles.pupil} cx="20" cy="16" r="1.8" />
      {/* Eyelids — clipped to the eye circle so the close animation
          stays inside the eye shape. */}
      <g clipPath="url(#eye-l-clip)">
        <rect className={styles.lid} x="8.5" y="12.8" width="7" height="6.4" />
      </g>
      <g clipPath="url(#eye-r-clip)">
        <rect className={styles.lid} x="16.5" y="12.8" width="7" height="6.4" />
      </g>
    </g>

    {/* Optional mouth — only when happy */}
    {state === 'happy' && (
      <path
        d="M12 22 Q16 25 20 22"
        stroke="var(--color-success)"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    )}
    {state === 'worried' && (
      <path
        d="M12 24 Q16 22 20 24"
        stroke="var(--color-warning)"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    )}
  </svg>
);
