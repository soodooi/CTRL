// Form / Field — labeled control wrapper. L1 primitive.
//
// Two pieces:
//   <Form>      — flexbox column + footer slot. Owns the submit
//                 lifecycle so callers don't repeat onSubmit/event.
//   <Field>     — uniform label / control / hint / error stack,
//                 reusable across TextInput / NumberInput / Select.
//                 Children render as-is (no slot magic) so consumers
//                 keep control over the inner element.

import {
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './Form.module.css';

// ── Form shell ──────────────────────────────────────────────────

export interface FormProps {
  onSubmit?: () => void;
  /** Right-aligned action row (typically a Button). */
  footer?: ReactNode;
  /** Form-level error (e.g. server rejection). */
  error?: string | null;
  children: ReactNode;
  className?: string;
}

export const Form = ({
  onSubmit,
  footer,
  error,
  children,
  className,
}: FormProps): ReactElement => {
  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    onSubmit?.();
  };
  return (
    <form
      className={[styles.form, className ?? ''].filter(Boolean).join(' ')}
      onSubmit={handleSubmit}
      noValidate
    >
      {children}
      {(footer || error) && (
        <div className={styles.footer}>
          {error && (
            <span className={styles.footerError} role="alert">
              {error}
            </span>
          )}
          {footer}
        </div>
      )}
    </form>
  );
};

// ── Field ───────────────────────────────────────────────────────

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export const Field = ({
  label,
  hint,
  error,
  required,
  children,
  className,
}: FieldProps): ReactElement => (
  <label className={[styles.field, className ?? ''].filter(Boolean).join(' ')}>
    <span className={styles.label}>
      {label}
      {required && <span className={styles.required}>*</span>}
    </span>
    {children}
    {error ? (
      <span className={styles.error} role="alert">
        {error}
      </span>
    ) : hint ? (
      <span className={styles.hint}>{hint}</span>
    ) : null}
  </label>
);
