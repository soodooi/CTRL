// KV — key/value list. L1 primitive.
//
// For showing manifest details, env metadata, capability props, etc.
// Mono uppercase keys + mono values. 3 widths via layout prop.

import type { ReactElement, ReactNode } from 'react';
import styles from './KV.module.css';

export interface KVPair {
  key: string;
  value: ReactNode;
  /** Soft / muted tone tint for less important values. */
  tone?: 'normal' | 'soft' | 'muted';
}

export interface KVProps {
  pairs: ReadonlyArray<KVPair>;
  layout?: 'normal' | 'compact' | 'wide';
  className?: string;
}

const cls = (v: string | undefined): string => v ?? '';

export const KV = ({ pairs, layout = 'normal', className }: KVProps): ReactElement => (
  <dl
    className={[
      cls(styles.list),
      cls(styles[`layout_${layout}`]),
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {pairs.map((p) => (
      <div key={p.key} className={styles.row}>
        <dt className={styles.key}>{p.key}</dt>
        <dd
          className={[
            cls(styles.value),
            p.tone === 'soft' ? cls(styles.valueSoft) : '',
            p.tone === 'muted' ? cls(styles.valueMuted) : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {p.value}
        </dd>
      </div>
    ))}
  </dl>
);
