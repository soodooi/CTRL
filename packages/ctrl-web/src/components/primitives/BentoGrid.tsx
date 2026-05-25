// BentoGrid + BentoTile — 12-column responsive grid. L1 primitive.
//
// Used by any dashboard-shaped workspace. Tiles declare their span
// via the `span` prop (2 / 3 / 4 / 6 / 8 / 12 — the divisors of 12)
// plus optional row span for hero tiles.

import type { ReactElement, ReactNode } from 'react';
import styles from './BentoGrid.module.css';

export interface BentoGridProps {
  gap?: 2 | 3 | 4 | 5;
  className?: string;
  children: ReactNode;
}

const cls = (v: string | undefined): string => v ?? '';

export const BentoGrid = ({
  gap = 3,
  className,
  children,
}: BentoGridProps): ReactElement => (
  <div
    className={[cls(styles.grid), cls(styles[`gap_${gap}`]), className ?? '']
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </div>
);

export type BentoSpan = 2 | 3 | 4 | 6 | 8 | 12;
export type BentoRows = 1 | 2 | 3;

export interface BentoTileProps {
  span?: BentoSpan;
  rows?: BentoRows;
  /** Strip the default card chrome (use when the child is itself a
   *  framed card and would otherwise nest borders). */
  bare?: boolean;
  className?: string;
  children: ReactNode;
}

export const BentoTile = ({
  span = 4,
  rows = 1,
  bare = false,
  className,
  children,
}: BentoTileProps): ReactElement => (
  <section
    className={[styles.tile, className ?? ''].filter(Boolean).join(' ')}
    data-span={String(span)}
    data-rows={String(rows)}
    data-bare={bare ? 'true' : undefined}
  >
    {children}
  </section>
);
