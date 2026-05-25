// KeycapCard — single keycap tile in the Pool grid.
// Hard industrial keycap aesthetic (per ADR-001 §2 OP-1 / Linear / Braun):
// rounded square, deep bevel, embossed glyph, LED hairline.
//
// Per-color text contrast: light keycaps (amber / platinum) need dark ink
// to read; dark keycaps (cobalt / jade / graphite) keep paper-white text.
// Computed at render via the keycap_color string — keeps CSS theme-agnostic.

import styles from './KeycapCard.module.css';
import type { KeycapSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { IconRenderer } from '@/components/primitives';

interface Props {
  keycap: KeycapSummary;
  onActivate: (id: string) => void;
}

// Light keycap face → dark ink text; dark face → paper-white text.
// Picked from the OKLCH lightness of each palette entry in tokens.css.
const LIGHT_FACE_COLORS = new Set(['amber', 'platinum']);

const colorVar = (color: string): string =>
  `var(--keycap-${color}, var(--keycap-platinum))`;

export const KeycapCard = ({ keycap, onActivate }: Props): React.ReactElement => {
  const icon = normalizeIcon(keycap.icon, keycap.name);
  const isLightFace = LIGHT_FACE_COLORS.has(keycap.keycap_color);
  return (
    <button
      type="button"
      className={styles.card}
      data-face={isLightFace ? 'light' : 'dark'}
      style={{ ['--card-color' as string]: colorVar(keycap.keycap_color) }}
      onClick={() => onActivate(keycap.id)}
      aria-label={keycap.name}
    >
      <span className={styles.led} aria-hidden="true" />
      <span className={styles.icon} aria-hidden="true">
        <IconRenderer icon={icon} size={36} ariaLabel={keycap.name} />
      </span>
      <span className={styles.label}>{keycap.name}</span>
    </button>
  );
};
