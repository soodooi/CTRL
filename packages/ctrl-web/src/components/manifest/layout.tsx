// Manifest layout primitives — Stack / Heading / Text.
//
// Presentation-only utility wrappers a keycap manifest can name in its
// JSON layout spec. These bridge the gap between "I want a vertical
// column with gap-3 padding" and the React DOM without forcing the
// manifest author to write CSS.

import type { CSSProperties, ReactElement, ReactNode } from 'react';
import styles from './layout.module.css';

type SpaceToken = 2 | 3 | 4 | 5 | 6;

const cls = (v: string | undefined): string => v ?? '';

// ── Stack ───────────────────────────────────────────────────────

export interface StackProps {
  direction?: 'vertical' | 'horizontal';
  align?: 'start' | 'center' | 'end';
  justify?: 'start' | 'center' | 'between' | 'end';
  /** Gap between children (multiple of --space-1 = 4px). */
  gap?: number;
  /** Padding tokens (left/right and top/bottom independently). */
  padX?: SpaceToken;
  padY?: SpaceToken;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export const Stack = ({
  direction = 'vertical',
  align,
  justify,
  gap,
  padX,
  padY,
  className,
  style,
  children,
}: StackProps): ReactElement => (
  <div
    className={[
      cls(styles.stack),
      padX !== undefined ? cls(styles[`padX_${padX}`]) : '',
      padY !== undefined ? cls(styles[`padY_${padY}`]) : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
    data-direction={direction}
    data-align={align}
    data-justify={justify}
    style={
      gap !== undefined
        ? { gap: `calc(var(--space-1) * ${gap})`, ...style }
        : style
    }
  >
    {children}
  </div>
);

// ── Heading ─────────────────────────────────────────────────────

export interface HeadingProps {
  level?: 1 | 2 | 3 | 4;
  children?: ReactNode;
}

export const Heading = ({ level = 2, children }: HeadingProps): ReactElement => {
  const Tag = (`h${level}` as const) as 'h1' | 'h2' | 'h3' | 'h4';
  return (
    <Tag className={`${cls(styles.heading)} ${cls(styles[`heading_${level}`])}`}>
      {children}
    </Tag>
  );
};

// ── Text ────────────────────────────────────────────────────────

export interface TextProps {
  tone?: 'normal' | 'soft' | 'muted';
  mono?: boolean;
  children?: ReactNode;
}

export const Text = ({
  tone = 'normal',
  mono = false,
  children,
}: TextProps): ReactElement => (
  <p
    className={[
      cls(styles.text),
      tone === 'soft' ? cls(styles.text_soft) : '',
      tone === 'muted' ? cls(styles.text_muted) : '',
      mono ? cls(styles.text_mono) : '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </p>
);

// ── Card ────────────────────────────────────────────────────────
// Re-export under a manifest-friendly name to keep node names
// stable across atom + layout primitives.
export const ManifestCard = ({ children }: { children?: ReactNode }): ReactElement => (
  <div className={styles.card}>{children}</div>
);
