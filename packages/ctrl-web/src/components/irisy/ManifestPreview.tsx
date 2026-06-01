// [H-2026-05-18-001] ManifestPreview — right top pane.
//
// Renders the in-progress manifest as a tree of clickable spans. Clicking
// a leaf field sets `fieldPending` on the store and focuses the chat
// input (ChatPane handles the focus side via effect). The user never
// edits values directly (ADR-004 cap § execution v1 §6) — they describe the change in chat
// and Irisy emits a <keycap-patch> token.

import { useKeycapCreatorStore } from '@/lib/irisy-keycap-store';
import styles from './ManifestPreview.module.css';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface TreeProps {
  value: unknown;
  path: string;
  pending: string | null;
  onClickField(path: string): void;
}

function renderValue(props: TreeProps, indent: number): React.ReactNode {
  const { value, path, pending, onClickField } = props;
  const pad = '  '.repeat(indent);

  if (value === undefined || value === null) {
    return (
      <span
        className={`${styles.leaf} ${path === pending ? styles.pending : ''}`}
        onClick={() => onClickField(path)}
        role="button"
        tabIndex={0}
        data-field={path}
      >
        ⟦pending⟧
      </span>
    );
  }

  if (typeof value === 'string') {
    return (
      <span
        className={`${styles.leaf} ${path === pending ? styles.pending : ''}`}
        onClick={() => onClickField(path)}
        role="button"
        tabIndex={0}
        data-field={path}
      >
        {path === pending ? '⟦…⟧' : `"${value}"`}
      </span>
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <span
        className={`${styles.leaf} ${path === pending ? styles.pending : ''}`}
        onClick={() => onClickField(path)}
        role="button"
        tabIndex={0}
        data-field={path}
      >
        {path === pending ? '⟦…⟧' : String(value)}
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>;
    return (
      <>
        <span>[</span>
        {value.map((item, i) => (
          <span key={i} className={styles.row}>
            {'\n'}
            {pad}
            {'  '}
            {renderValue(
              { value: item, path: `${path}[${i}]`, pending, onClickField },
              indent + 1,
            )}
            {i < value.length - 1 ? <span>,</span> : null}
          </span>
        ))}
        {'\n'}
        {pad}
        <span>]</span>
      </>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span>{'{}'}</span>;
    return (
      <>
        <span>{'{'}</span>
        {entries.map(([k, v], i) => (
          <span key={k} className={styles.row}>
            {'\n'}
            {pad}
            {'  '}
            <span className={styles.key}>&quot;{k}&quot;</span>
            <span>: </span>
            {renderValue(
              {
                value: v,
                path: path === '' ? k : `${path}.${k}`,
                pending,
                onClickField,
              },
              indent + 1,
            )}
            {i < entries.length - 1 ? <span>,</span> : null}
          </span>
        ))}
        {'\n'}
        {pad}
        <span>{'}'}</span>
      </>
    );
  }

  return <span>{String(value)}</span>;
}

export function ManifestPreview(): React.ReactElement {
  const draft = useKeycapCreatorStore((s) => s.manifestDraft);
  const pending = useKeycapCreatorStore((s) => s.fieldPending);
  const validated = useKeycapCreatorStore((s) => s.validated);
  const errors = useKeycapCreatorStore((s) => s.errors);
  const setFieldPending = useKeycapCreatorStore((s) => s.setFieldPending);

  const isEmpty = Object.keys(draft).length === 0;

  return (
    <section className={styles.pane} aria-label="Manifest preview">
      <header className={styles.header}>
        <span className={styles.title}>manifest.json</span>
        <span
          className={`${styles.status} ${
            validated
              ? styles.statusOk
              : errors.length > 0
                ? styles.statusErr
                : styles.statusPending
          }`}
        >
          {validated
            ? '✓ valid'
            : errors.length > 0
              ? `✗ ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`
              : '⊙ pending'}
        </span>
      </header>
      <pre className={styles.body}>
        {isEmpty ? (
          <span className={styles.placeholder}>// awaiting your description</span>
        ) : (
          renderValue({ value: draft, path: '', pending, onClickField: setFieldPending }, 0)
        )}
      </pre>
    </section>
  );
}
