// ViewerChrome — the slim toolbar every editable viewer shares.
//
// Renders:
//   - resource location badge + relative path (so the user always knows
//     what file they're editing — Obsidian-style breadcrumb)
//   - dirty/saving/error indicator (right of the path)
//   - optional save button (only when the buffer is writable + dirty)
//   - viewer-specific right-side actions slot (mode toggles, etc.)
//
// Lightweight so that lazy viewer chunks reusing it don't double-count
// chrome bytes — the component is intentionally pure DOM, no portal /
// no animation library.

import type { ReactElement, ReactNode } from 'react';
import type { ViewerResource } from '@/lib/viewer-registry';
import styles from './Viewer.module.css';

interface ViewerChromeProps {
  resource: ViewerResource;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  writable: boolean;
  onSave: () => Promise<void>;
  /** Optional right-aligned actions (mode toggles, lib-specific buttons). */
  rightActions?: ReactNode;
}

export const ViewerChrome = ({
  resource,
  dirty,
  saving,
  error,
  writable,
  onSave,
  rightActions,
}: ViewerChromeProps): ReactElement => {
  const handleSave = (): void => {
    void onSave().catch(() => {
      /* error is surfaced through the `error` prop already */
    });
  };

  return (
    <div className={styles.meta}>
      <span className={styles.metaLocation}>{resource.location}</span>
      <span className={styles.metaPath}>{displayUri(resource.uri)}</span>
      {dirty && !saving && (
        <span className={styles.metaDirty} aria-label="unsaved changes">
          •
        </span>
      )}
      {saving && <span className={styles.metaSaving}>saving…</span>}
      {error && (
        <span className={styles.metaError} role="alert" title={error}>
          error
        </span>
      )}
      <div className={styles.metaSpacer} />
      {rightActions}
      {!writable && (
        <span className={styles.metaReadOnly}>read-only</span>
      )}
      {writable && (
        <button
          type="button"
          className={styles.saveButton}
          onClick={handleSave}
          disabled={!dirty || saving}
        >
          {saving ? 'saving' : 'save'}
        </button>
      )}
    </div>
  );
};

/** Trim noisy URI prefixes for breadcrumb display. */
const displayUri = (uri: string): string => {
  if (uri.startsWith('vault://')) return uri.slice('vault://'.length);
  return uri;
};
