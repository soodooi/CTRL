// IconRenderer — single rendering target for every icon surface in CTRL.
//
// Static variants render natively (zero deps):
//   - glyph → CSS span
//   - svg   → <img src> (browser-native SVG decode)
//
// Animated variants render via ThorVG WASM (via @lottiefiles/dotlottie-react):
//   - lottie    → raw Lottie .json
//   - dotlottie → .lottie zip bundle (themes / state machines / slots)
//
// The ThorVG bundle is lazy-imported so any keycap with a static icon
// pays 0 bytes for the WASM payload. While WASM hydrates a glyph fallback
// renders instantly — no layout shift, no blank cell.

import { lazy, Suspense, type ReactElement } from 'react';
import type { Icon } from '@/lib/icon';
import { deriveGlyph } from '@/lib/icon';
import styles from './IconRenderer.module.css';

// Lazy boundary: ThorVG WASM + dotlottie-react only enters the bundle
// when the first lottie/dotlottie icon mounts. Subsequent mounts reuse
// the singleton WASM instance.
const DotLottieReact = lazy(() =>
  import('@lottiefiles/dotlottie-react').then((m) => ({
    default: m.DotLottieReact,
  })),
);

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
}

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

const LottieView = ({
  src,
  size,
  playing,
  speed,
  fallback,
}: {
  src: string;
  size: number;
  playing: boolean;
  speed: number;
  fallback: ReactElement;
}): ReactElement => (
  <Suspense fallback={fallback}>
    <DotLottieReact
      src={src}
      loop
      autoplay={playing}
      speed={speed}
      style={{ width: size, height: size }}
    />
  </Suspense>
);

export const IconRenderer = ({
  icon,
  size = 32,
  playing = true,
  speed = 1,
  ariaLabel,
  fallbackGlyph,
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
        />
      );
    }
  }
};
