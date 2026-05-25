// Sparkline — minimal inline SVG trend line.
//
// One of CTRL's L1 data-viz primitives. No external chart lib; ~50 LOC.
// Use for any keycap workspace that wants to glance a 24-point trend
// inside a stat tile / sidebar item / activity card.
//
// Public surface intentionally tiny:
//   <Sparkline values={[..]} color="var(--color-accent)" fill />

import type { CSSProperties, ReactElement } from 'react';

export interface SparklineProps {
  values: ReadonlyArray<number>;
  color?: string;
  /** Fill under the line at low opacity. */
  fill?: boolean;
  /** Override the default 100x100 viewBox aspect. */
  width?: number;
  height?: number;
  /** Inline style passthrough — most consumers set height via CSS. */
  style?: CSSProperties;
  className?: string;
}

export const Sparkline = ({
  values,
  color = 'currentColor',
  fill = false,
  width,
  height,
  style,
  className,
}: SparklineProps): ReactElement => {
  if (values.length === 0) {
    return (
      <svg
        className={className}
        style={style}
        width={width}
        height={height}
        aria-hidden="true"
      />
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = 100 / Math.max(1, values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = 100 - ((v - min) / range) * 90 - 5;
      return `${x},${y}`;
    })
    .join(' ');
  const area = `0,100 ${points} 100,100`;
  return (
    <svg
      className={className}
      style={style}
      width={width}
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill && <polygon points={area} fill={color} opacity={0.12} />}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};
