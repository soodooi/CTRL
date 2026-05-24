// KeycapCard — single keycap tile in the Pool grid.
// Design: hard industrial keycap aesthetic (per ADR-001 §2 OP-1/Linear/Braun).
// Each card mimics a real keycap with a bevel, embossed glyph, and the
// canonical 12px radius from the design tokens.
//
// Pure CSS hover/active animations — framer-motion previously drove this but
// was the only consumer of the 36 KB framer chunk. CSS transitions match the
// brand motion curves (--ease-out-expo) closely enough that the visual feel
// is preserved without the JS animation runtime in the Pool critical path.

import styles from './KeycapCard.module.css';
import type { KeycapSummary } from '@/lib/kernel';
import { normalizeIcon } from '@/lib/icon';
import { IconRenderer } from '@/components/primitives';

interface Props {
  keycap: KeycapSummary;
  onActivate: (id: string) => void;
}

const colorVar = (color: string): string => `var(--keycap-${color}, var(--keycap-platinum))`;

export const KeycapCard = ({ keycap, onActivate }: Props): React.ReactElement => {
  const icon = normalizeIcon(keycap.icon, keycap.name);
  return (
    <button
      type="button"
      className={styles.card}
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
