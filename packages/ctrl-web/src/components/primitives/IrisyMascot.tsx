// IrisyMascot — Irisy's visible form.
//
// Renders via IconRenderer (ThorVG WASM). The canonical asset is
// `/lottie/irisy.json` (geometric square face + dot eyes + breath + blink).
// Per .olym/skills/thorvg/SKILL.md §3.4 + §5.3, Irisy is a brand mascot
// at the decoration tier — the breath sets the cockpit's ambient cadence.
//
// State today drives `speed` modulation (the manifest doesn't yet bake an
// `emotion` state machine; passing the machine id is best-effort so when
// the canonical .lottie ships with one the wire is already plumbed).
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

// Breathing rate hints at the mood until the state machine ships.
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
      stateMachineId="emotion"
      stateMachineInputs={{ mood: state }}
    />
  );
};
