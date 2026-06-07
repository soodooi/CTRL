// McpCard — single mcp tile in the Pool grid.
// Hard industrial mcp aesthetic (per ADR-001 spine §2 OP-1 / Linear / Braun):
// rounded square, deep bevel, embossed glyph, LED hairline.
//
// Per-color text contrast: light mcps (amber / platinum) need dark ink
// to read; dark mcps (cobalt / jade / graphite) keep paper-white text.
// Computed at render via the mcp_color string — keeps CSS theme-agnostic.

import styles from './McpCard.module.css';
import type { McpSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { IconRenderer } from '@/components/primitives';

interface Props {
  mcp: McpSummary;
  onActivate: (id: string) => void;
}

// Light mcp face → dark ink text; dark face → paper-white text.
// Picked from the OKLCH lightness of each palette entry in tokens.css.
const LIGHT_FACE_COLORS = new Set(['amber', 'platinum']);

const colorVar = (color: string): string =>
  `var(--mcp-${color}, var(--mcp-platinum))`;

export const McpCard = ({ mcp, onActivate }: Props): React.ReactElement => {
  const icon = normalizeIcon(mcp.icon, mcp.name);
  const isLightFace = LIGHT_FACE_COLORS.has(mcp.mcp_color);
  return (
    <button
      type="button"
      className={styles.card}
      data-face={isLightFace ? 'light' : 'dark'}
      style={{ ['--card-color' as string]: colorVar(mcp.mcp_color) }}
      onClick={() => onActivate(mcp.id)}
      aria-label={mcp.name}
    >
      <span className={styles.led} aria-hidden="true" />
      <span className={styles.icon} aria-hidden="true">
        <IconRenderer icon={icon} size={36} ariaLabel={mcp.name} />
      </span>
      <span className={styles.label}>{mcp.name}</span>
    </button>
  );
};
