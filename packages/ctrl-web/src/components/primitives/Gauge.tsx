// Gauge — circular progress arc. L1 data-viz primitive.
//
// Render a 56×56 SVG arc with a -90° rotation so the progress starts
// at 12 o'clock. Inline number badge in the center. Three tones map to
// the brand semantic palette; pass `tone="amber"` for caution etc.

import type { ReactElement } from 'react';

export type GaugeTone = 'cobalt' | 'jade' | 'amber' | 'danger';

const TONE_STROKE: Record<GaugeTone, string> = {
  cobalt: 'var(--color-accent)',
  jade: 'var(--color-success)',
  amber: 'var(--color-warning)',
  danger: 'var(--color-danger)',
};

export interface GaugeProps {
  value: number;
  max?: number;
  tone?: GaugeTone;
  /** Show the percentage label in the center. */
  showLabel?: boolean;
  /** Side length in px; SVG is square. Default 56. */
  size?: number;
  className?: string;
}

export const Gauge = ({
  value,
  max = 100,
  tone = 'cobalt',
  showLabel = true,
  size = 56,
  className,
}: GaugeProps): ReactElement => {
  // Guard max <= 0: value / 0 yields NaN/Infinity, which poisons the arc
  // offset and the label. Treat a non-positive max as an empty (0%) gauge.
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - 12) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden={!showLabel}
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke="var(--color-border-soft)"
        strokeWidth={3}
        fill="none"
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={TONE_STROKE[tone]}
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 600ms ease' }}
      />
      {showLabel && (
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fontFamily="var(--font-mono)"
          fontSize={size >= 56 ? 11 : 9}
          fill="var(--color-text)"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {Math.round(pct * 100)}%
        </text>
      )}
    </svg>
  );
};
