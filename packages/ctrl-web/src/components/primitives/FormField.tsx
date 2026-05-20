// FormField — wraps a single input with label + optional hint + optional error.
//
// Generates a unique id when none is supplied so the <label htmlFor> +
// aria-describedby wiring stays correct without callers having to manage
// ids manually. Pass the input as children — FormField clones in the
// id / aria-describedby / aria-invalid props.

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './FormField.module.css';

interface FormFieldProps {
  label: string;
  /** Optional id; auto-generated if omitted. */
  id?: string;
  hint?: string;
  error?: string;
  /** Rendered as the field input — exactly one element expected. */
  children: ReactNode;
}

interface InjectedProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export const FormField = ({
  label,
  id: idProp,
  hint,
  error,
  children,
}: FormFieldProps): ReactElement => {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const only = Children.only(children);
  const input = isValidElement(only)
    ? cloneElement(only as ReactElement<InjectedProps>, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })
    : only;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {input}
      {hint && !error && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
