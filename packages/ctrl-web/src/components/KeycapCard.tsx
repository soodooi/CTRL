// KeycapCard — single keycap tile in the Pool grid.
// Design: hard industrial keycap aesthetic (per ADR-001 §2 OP-1/Linear/Braun).
// Each card mimics a real keycap with a bevel, embossed glyph, and the
// canonical 12px radius from the design tokens.

import { motion } from 'framer-motion';
import styles from './KeycapCard.module.css';
import type { KeycapSummary } from '@/lib/kernel';

interface Props {
  keycap: KeycapSummary;
  onActivate: (id: string) => void;
}

const colorVar = (color: string): string => `var(--keycap-${color}, var(--keycap-platinum))`;

export const KeycapCard = ({ keycap, onActivate }: Props): React.ReactElement => (
  <motion.button
    className={styles.card}
    style={{ ['--card-color' as string]: colorVar(keycap.keycap_color) }}
    whileHover={{ y: -2 }}
    whileTap={{ y: 1, scale: 0.98 }}
    transition={{ type: 'spring', stiffness: 380, damping: 22 }}
    onClick={() => onActivate(keycap.id)}
    aria-label={keycap.name}
  >
    <span className={styles.led} aria-hidden="true" />
    <span className={styles.icon} aria-hidden="true">{keycap.icon || '◆'}</span>
    <span className={styles.label}>{keycap.name}</span>
  </motion.button>
);
