// Card — surface container. Token-driven padding / border / radius / background.
//
// Use for any standalone visual group (settings panels, list items, modal
// bodies). Sections inside a Card stack vertically via a gap; consumers
// control internal layout themselves.

import type { HTMLAttributes, ReactElement } from 'react';
import { cx } from './cx';
import styles from './Card.module.css';

type Elevation = 'flat' | 'raised';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: Elevation;
}

export const Card = ({
  elevation = 'flat',
  className,
  children,
  ...rest
}: CardProps): ReactElement => (
  <div
    className={cx(styles.card, styles[`elevation_${elevation}`], className)}
    {...rest}
  >
    {children}
  </div>
);
