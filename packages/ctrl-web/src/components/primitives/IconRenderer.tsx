// IconRenderer — single rendering target for every icon surface in CTRL.
//
// Static variants render natively (zero deps):
//   - glyph → CSS span
//   - svg   → <img src> (browser-native SVG decode)
//
// Animated variants render via ThorVG WASM (via @lottiefiles/dotlottie-react).
// Implementation invariants:
//   - single primitive surface
//   - lazy WASM import (static-only callers pay 0 bytes)
//   - brand theme injection (CSS OKLCh tokens → setThemeData)
//   - state machine pipe (stateMachineId + stateMachineInputs)
//   - prefers-reduced-motion gate (pause + speed 0, keep first frame)
//   - three backends: CPU default, WebGL auto ≥256px, Worker opt-in

import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { DotLottie, DotLottieWorker } from '@lottiefiles/dotlottie-web';
import type { Icon } from '@/lib/icon';
import { deriveGlyph } from '@/lib/icon';
import { usePrefersReducedMotion } from '@/lib/motion';
import { useBrandThemeData } from '@/lib/icon-theme';
import styles from './IconRenderer.module.css';

// Each backend is its own lazy boundary so only the chosen variant
// enters the chunk. CPU + Worker share the main entry point; WebGL is
// a separate sub-export.
const CpuDotLottieReact = lazy(() =>
  import('@lottiefiles/dotlottie-react').then((m) => ({
    default: m.DotLottieReact,
  })),
);
const WorkerDotLottieReact = lazy(() =>
  import('@lottiefiles/dotlottie-react').then((m) => ({
    default: m.DotLottieWorkerReact,
  })),
);
const WebGlDotLottieReact = lazy(() =>
  import('@lottiefiles/dotlottie-react/webgl').then((m) => ({
    default: m.DotLottieReact,
  })),
);

export type IconRendererMode = 'auto' | 'cpu' | 'worker' | 'webgl';
export type StateMachineInput = string | number | boolean;

// Sentinel string opting out of theming; using `null` runs afoul of
// useState defaulting + React props convention, so an explicit value
// keeps the prop API honest.
export const THEME_NONE = 'none' as const;
export type IconRendererTheme = 'auto' | typeof THEME_NONE | string;

interface IconRendererProps {
  icon: Icon;
  /** Render size in CSS pixels. Square. */
  size?: number;
  /** When true, animated icons autoplay + loop. Defaults to true. */
  playing?: boolean;
  /** Speed multiplier for animated icons. Defaults to 1. */
  speed?: number;
  /** Accessibility label. Defaults to the icon variant. */
  ariaLabel?: string;
  /** Glyph string used while ThorVG WASM hydrates. */
  fallbackGlyph?: string;
  /** Load + start a named state machine from the .lottie manifest. */
  stateMachineId?: string;
  /** Inputs synced into the running state machine — keys = input names. */
  stateMachineInputs?: Readonly<Record<string, StateMachineInput>>;
  /**
   * 'auto' (default) injects CTRL brand OKLCh tokens into the slot_*
   * rules per SKILL.md §3.3. THEME_NONE opts out. Any other string is
   * treated as a baked themeId from the .lottie manifest.
   */
  theme?: IconRendererTheme;
  /**
   * 'auto' picks CPU under 256 px and WebGL at/above. 'worker' offloads
   * to a worker thread (per SKILL.md §6, recommended for >4 instances).
   */
  mode?: IconRendererMode;
}

const pickBackend = (
  mode: IconRendererMode,
  size: number,
): 'cpu' | 'worker' | 'webgl' => {
  if (mode === 'cpu' || mode === 'worker' || mode === 'webgl') return mode;
  return size >= 256 ? 'webgl' : 'cpu';
};

const GlyphView = ({
  char,
  size,
  ariaLabel,
}: {
  char: string;
  size: number;
  ariaLabel: string;
}): ReactElement => (
  <span
    className={styles.glyph}
    style={{ width: size, height: size, fontSize: size * 0.55 }}
    role="img"
    aria-label={ariaLabel}
  >
    {char}
  </span>
);

const SvgView = ({
  src,
  size,
  ariaLabel,
}: {
  src: string;
  size: number;
  ariaLabel: string;
}): ReactElement => (
  <img
    className={styles.svg}
    src={src}
    width={size}
    height={size}
    alt={ariaLabel}
    decoding="async"
    loading="lazy"
    draggable={false}
  />
);

// Imperative wiring against a live instance. The DotLottieWorker mirror
// returns Promises for these methods; `void` discards the return value
// for both branches uniformly. State machine inputs MUST be imperative
// because the config schema only takes the machine id, not initial
// input values.
const useDotLottieIntegration = (
  instance: DotLottie | DotLottieWorker | null,
  theme: IconRendererTheme,
  stateMachineId: string | undefined,
  stateMachineInputs: Readonly<Record<string, StateMachineInput>> | undefined,
): void => {
  useEffect(() => {
    if (!instance) return;
    if (theme === THEME_NONE) {
      // resetTheme exists only on DotLottie (sync). DotLottieWorker omits
      // it — we fall back to clearing themeData via setThemeData('').
      if ('resetTheme' in instance) {
        void instance.resetTheme();
      } else {
        void instance.setThemeData('');
      }
      return;
    }
    if (theme === 'auto') {
      // Brand theme is fed through the `themeData` prop on the React
      // wrapper — nothing to do here.
      return;
    }
    void instance.setTheme(theme);
  }, [instance, theme]);

  useEffect(() => {
    if (!instance || !stateMachineId || !stateMachineInputs) return;
    // The instance ref fires during construction — before WASM init and
    // before the state machine has loaded. stateMachineSet*Input on a
    // not-yet-loaded core silently returns false and DROPS the value.
    // We apply once optimistically (cheap when SM is already up) and
    // also replay on 'load' + 'stateMachineStart' so the FIRST sync
    // lands on a live machine. Without this, IrisyMascot mounts with
    // mood='happy' but stays at the manifest default forever.
    const apply = (): void => {
      for (const [name, value] of Object.entries(stateMachineInputs)) {
        if (typeof value === 'string') {
          void instance.stateMachineSetStringInput(name, value);
        } else if (typeof value === 'number') {
          void instance.stateMachineSetNumericInput(name, value);
        } else {
          void instance.stateMachineSetBooleanInput(name, value);
        }
      }
    };
    apply();
    instance.addEventListener('load', apply);
    instance.addEventListener('stateMachineStart', apply);
    return () => {
      instance.removeEventListener('load', apply);
      instance.removeEventListener('stateMachineStart', apply);
    };
  }, [instance, stateMachineId, stateMachineInputs]);
};

interface LottieViewProps {
  src: string;
  size: number;
  playing: boolean;
  speed: number;
  fallback: ReactElement;
  stateMachineId: string | undefined;
  stateMachineInputs: Readonly<Record<string, StateMachineInput>> | undefined;
  theme: IconRendererTheme;
  mode: IconRendererMode;
}

const LottieView = ({
  src,
  size,
  playing,
  speed,
  fallback,
  stateMachineId,
  stateMachineInputs,
  theme,
  mode,
}: LottieViewProps): ReactElement => {
  const reduceMotion = usePrefersReducedMotion();
  const brandThemeData = useBrandThemeData(theme === 'auto');
  const [instance, setInstance] = useState<DotLottie | DotLottieWorker | null>(
    null,
  );

  useDotLottieIntegration(instance, theme, stateMachineId, stateMachineInputs);

  // Reduce-motion gate: keep the canvas mounted so layout stays stable,
  // freeze playback by killing autoplay + speed.
  const effectivePlaying = playing && !reduceMotion;
  const effectiveSpeed = reduceMotion ? 0 : speed;

  const sharedProps = {
    src,
    loop: true,
    autoplay: effectivePlaying,
    speed: effectiveSpeed,
    style: { width: size, height: size },
    themeData: theme === 'auto' ? brandThemeData ?? undefined : undefined,
    stateMachineId,
  };

  // Single ref callback works for both DotLottie and DotLottieWorker
  // because the parameter type is contravariant — accepting the union
  // is assignable to each specific RefCallback<T | null>.
  const handleInstance = (i: DotLottie | DotLottieWorker | null): void => {
    setInstance(i);
  };

  const backend = pickBackend(mode, size);
  let canvas: ReactNode;
  if (backend === 'worker') {
    canvas = (
      <WorkerDotLottieReact
        {...sharedProps}
        dotLottieRefCallback={handleInstance}
      />
    );
  } else if (backend === 'webgl') {
    canvas = (
      <WebGlDotLottieReact
        {...sharedProps}
        dotLottieRefCallback={handleInstance}
      />
    );
  } else {
    canvas = (
      <CpuDotLottieReact
        {...sharedProps}
        dotLottieRefCallback={handleInstance}
      />
    );
  }
  return <Suspense fallback={fallback}>{canvas}</Suspense>;
};

export const IconRenderer = ({
  icon,
  size = 32,
  playing = true,
  speed = 1,
  ariaLabel,
  fallbackGlyph,
  stateMachineId,
  stateMachineInputs,
  theme = 'auto',
  mode = 'auto',
}: IconRendererProps): ReactElement => {
  const label = ariaLabel ?? `icon-${icon.kind}`;

  switch (icon.kind) {
    case 'glyph':
      return <GlyphView char={icon.char} size={size} ariaLabel={label} />;
    case 'svg':
      return <SvgView src={icon.src} size={size} ariaLabel={label} />;
    case 'lottie':
    case 'dotlottie': {
      const glyph = fallbackGlyph ?? deriveGlyph(label);
      const fallback = <GlyphView char={glyph} size={size} ariaLabel={label} />;
      return (
        <LottieView
          src={icon.src}
          size={size}
          playing={playing}
          speed={speed}
          fallback={fallback}
          stateMachineId={stateMachineId}
          stateMachineInputs={stateMachineInputs}
          theme={theme}
          mode={mode}
        />
      );
    }
  }
};
