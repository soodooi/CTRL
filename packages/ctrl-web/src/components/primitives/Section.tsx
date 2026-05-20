// Section — labeled vertical region with a mono uppercase heading.
//
// Used inside Card (or standalone) to group related form fields, settings,
// or descriptive content. The heading is rendered as <h2> by default; pass
// `as="h3"` etc. when nesting under an existing h2 to keep document
// outline correct.

import type { HTMLAttributes, ReactElement } from 'react';
import styles from './Section.module.css';

type HeadingTag = 'h2' | 'h3' | 'h4';

interface SectionProps extends HTMLAttributes<HTMLElement> {
  title: string;
  hint?: string;
  as?: HeadingTag;
}

const cx = (...parts: Array<string | undefined | false>): string =>
  parts.filter(Boolean).join(' ');

export const Section = ({
  title,
  hint,
  as: HeadingTag = 'h2',
  className,
  children,
  ...rest
}: SectionProps): ReactElement => (
  <section className={cx(styles.section, className)} {...rest}>
    <HeadingTag className={styles.heading}>{title}</HeadingTag>
    {hint && <p className={styles.hint}>{hint}</p>}
    <div className={styles.body}>{children}</div>
  </section>
);
