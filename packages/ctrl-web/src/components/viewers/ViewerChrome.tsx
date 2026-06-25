// ViewerChrome — shared header strip (location · path · read-only badge
// · save button · status). Every viewer mounts this on top so the
// behaviour stays consistent regardless of which viewer body renders.

import type { ReactElement, ReactNode } from 'react';
import type { ViewerResource } from '@/lib/viewer-registry';
import styles from './Viewer.module.css';

interface ViewerChromeProps {
  resource: ViewerResource;
  dirty?: boolean;
  saving?: boolean;
  error?: string | null;
  onSave?: () => void;
  /** Right-aligned action slot — viewers can drop a "render" button
   *  (mermaid), "open external" link, etc. */
  rightActions?: ReactNode;
}

export const ViewerChrome = ({
  resource,
  dirty,
  saving,
  error,
  onSave,
  rightActions,
}: ViewerChromeProps): ReactElement => {
  const canSave = resource.editable && !!onSave && !!dirty && !saving;
  return (
    <div className={styles.meta}>
      <span className={styles.metaLocation}>{resource.location}</span>
      <span className={styles.metaPath}>{resource.uri}</span>
      {!resource.editable && (
        <span className={styles.metaReadOnly}>read-only</span>
      )}
      {error && (
        <span className={styles.metaError} role="alert" title={error}>
          ! {error.length > 60 ? `${error.slice(0, 60)}…` : error}
        </span>
      )}
      <span className={styles.metaSpacer} />
      {rightActions}
      {resource.editable && onSave && (
        <button
          type="button"
          className={styles.saveButton}
          disabled={!canSave}
          onClick={onSave}
        >
          {saving ? 'Saving…' : dirty ? 'Auto-saving…' : 'Saved'}
        </button>
      )}
    </div>
  );
};
