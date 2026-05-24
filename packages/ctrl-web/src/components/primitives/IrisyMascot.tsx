// IrisyMascot — Irisy's visible form.
//
// Rendering path (per .olym/skills/thorvg/SKILL.md §3.4 + brand-tokens §12.4):
//   - default: inline SVG stub (geometric abstract face — rounded square,
//     dot eyes, geometric mouth; CSS breathe + blink keyframes)
//   - upgrade: pass `src="/lottie/irisy.lottie"` to render via IconRenderer
//     → ThorVG WASM with state machine input synced to the `state` prop
//
// The SVG path stays until designer ships the canonical irisy.lottie; both
// paths satisfy VI v0.2 §12.4 mascot lock.

import type { ReactElement } from 'react';
import { IconRenderer } from './IconRenderer';
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
  /**
   * When set, render through IconRenderer (ThorVG) instead of the SVG
   * stub. Expected to be a `.lottie` file with a state machine that
   * accepts `mood` input matching IrisyState. Until designer ships the
   * canonical irisy.lottie, leave this unset.
   */
  src?: string;
}

export const IrisyMascot = ({
  state = 'idle',
  size = 44,
  src,
}: IrisyMascotProps): ReactElement => {
  if (src) {
    // Per SKILL.md §3.4: 6 emotion states drive a dotLottie state machine
    // input rather than React-side if-switch. The canonical asset bundles
    // an "emotion" state machine that accepts a string "mood" input
    // matching IrisyState. Brand color slots are auto-injected by
    // IconRenderer (theme="auto" default).
    return (
      <IconRenderer
        icon={{ kind: 'dotlottie', src }}
        size={size}
        playing
        ariaLabel={`Irisy — ${state}`}
        fallbackGlyph="I"
        stateMachineId="emotion"
        stateMachineInputs={{ mood: state }}
      />
    );
  }
  return (
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
};
