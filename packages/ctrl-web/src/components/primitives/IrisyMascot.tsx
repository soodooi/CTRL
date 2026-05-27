// IrisyMascot — Irisy's visible form.
//
// Renders via IconRenderer (ThorVG WASM). The canonical asset is
// `/lottie/irisy.json` — a 2-second loop (60fps × 120 frames) with:
//   - whole-body breath: scale 100→104→100 over the full loop
//   - eye blink at frames 88→94→100: EyeWhite scaleY 100→8→100 +
//     pupil opacity 100→0→100 (the blink "closes" the eye)
//
// Verified 2026-05-26 (see memory `feedback_irisy_blink_lottie_baked`):
// the blink keyframes ARE in the lottie. If you don't see blink at
// runtime, it's a rendering issue (reduce-motion, WASM load failure,
// or props interfering), NOT missing animation data.
//
// State today drives `speed` only. The lottie doesn't carry a state
// machine, so `stateMachineId` / `stateMachineInputs` are deliberately
// NOT passed — earlier sessions passed `stateMachineId="emotion"` which
// caused dotlottie-react to try loading a non-existent state machine
// and silently fall through to first-frame-static (no breath, no blink).
// `sleeping` freezes the canvas on its first frame.

import type { ReactElement } from 'react';
import { IconRenderer } from './IconRenderer';

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
  /** Override the default lottie. Pass `.lottie` once designer ships
   *  the canonical state-machine asset. */
  src?: string;
}

const DEFAULT_IRISY_SRC = '/lottie/irisy.json';

// Breathing rate hints at the mood. Speed multiplies the whole loop,
// including the blink — `thinking` (0.7×) blinks slower, `happy`
// (1.4×) blinks more often.
const SPEED_BY_STATE: Readonly<Record<IrisyState, number>> = {
  idle: 1,
  watching: 1.2,
  thinking: 0.7,
  happy: 1.4,
  worried: 0.85,
  sleeping: 0.25,
};

export const IrisyMascot = ({
  state = 'idle',
  size = 44,
  src = DEFAULT_IRISY_SRC,
}: IrisyMascotProps): ReactElement => {
  const isDotLottie = src.toLowerCase().endsWith('.lottie');
  return (
    <IconRenderer
      icon={isDotLottie ? { kind: 'dotlottie', src } : { kind: 'lottie', src }}
      size={size}
      playing={state !== 'sleeping'}
      speed={SPEED_BY_STATE[state]}
      ariaLabel={`Irisy — ${state}`}
      fallbackGlyph="I"
    />
  );
};
