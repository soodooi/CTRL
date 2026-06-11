// CapabilityFloor — the low-barrier "floor" of the Irisy chat empty state.
//
// ADR-003 §8 v6 + bao 2026-06-11: CTRL is a low-barrier assistant for
// general users. A blank prompt is high-effort — users don't know what to
// type. Instead we SHOW concrete, clickable capabilities (effect-first),
// so the user sees what's possible and picks. The conversation input
// below stays the ceiling (flexible / power path).
//
// Floor = zero-install capabilities only (work with just a configured
// provider — no MCP/skill install). Highest general-user usage first.
// Curated catalog: lib/capability-catalog.ts.

import type { ReactElement } from 'react';
import { floorCapabilities, type Capability } from '@/lib/capability-catalog';
import styles from './CapabilityFloor.module.css';

interface CapabilityFloorProps {
  /** Click a card -> pre-fill the composer with the capability's starter. */
  onPick: (capability: Capability) => void;
  disabled?: boolean;
}

// Cap the floor to the top cards — too many choices is its own barrier
// (the Genspark "feature potpourri" anti-pattern). Highest-usage first.
const MAX_FLOOR_CARDS = 8;

export function CapabilityFloor({ onPick, disabled }: CapabilityFloorProps): ReactElement {
  const cards = floorCapabilities().slice(0, MAX_FLOOR_CARDS);
  return (
    <div className={styles.floor}>
      <h2 className={styles.greeting}>Hi, I&rsquo;m Irisy.</h2>
      <p className={styles.sub}>Pick something to start — or just type below.</p>
      <div className={styles.grid} role="list">
        {cards.map((cap) => (
          <button
            key={cap.id}
            type="button"
            role="listitem"
            className={styles.card}
            onClick={() => onPick(cap)}
            disabled={disabled}
            title={cap.hint}
          >
            <span className={styles.cardLabel}>{cap.label}</span>
            <span className={styles.cardHint}>{cap.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
