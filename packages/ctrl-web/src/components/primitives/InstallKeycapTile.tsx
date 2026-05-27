// InstallKeycapTile — a single keycap-sized "empty slot" tile that opens
// the keycap install flow. Anchors the `/` route just above ChatInput.
//
// Per bao 2026-05-26 "三路全开 抽象化处理, 最极简方式做, 都是一个 id
// 能解决问题的":
//   1. click           → navigate /pool (browse + install)
//   2. drop  keycap-id → already-installed payload, surface a hint
//   3. drop  manifest  → defer to /pool (Phase 1D wires the manifest
//                        parsing inside Pool's install drawer)
//
// All three paths funnel into the same `onActivate` callback so the
// consumer keeps a single install entry-point. The tile is presentation
// only; it never invokes `install_keycap` directly.

import {
  useCallback,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react';
import { cx } from './cx';
import styles from './InstallKeycapTile.module.css';

const KEYCAP_DRAG_MIME = 'application/x-ctrl-keycap-id';
const URI_MIME = 'text/uri-list';

export interface InstallKeycapTilePayload {
  kind: 'click' | 'keycap-id' | 'uri' | 'file';
  /** For 'keycap-id': the dragged keycap id. For 'uri': the URL. */
  value?: string;
  /** For 'file': the dropped file (manifest JSON). */
  file?: File;
}

export interface InstallKeycapTileProps {
  /** Called for click + every accepted drop. Consumer routes the payload
   *  through the kernel mutation. Defaults to a no-op so the tile stays
   *  usable in fixtures. */
  onActivate?: (payload: InstallKeycapTilePayload) => void;
  /** Tile label below the glyph. */
  label?: string;
  /** Tile aria-label, defaults to "Install a keycap". */
  ariaLabel?: string;
  /** Visual size. 72 reads as a slot next to the 64-pixel Keyboard cap;
   *  bump to 88 to match the keycap silhouette directly. */
  size?: 64 | 72 | 88;
  className?: string;
}

const acceptsDrag = (e: DragEvent<HTMLElement>): boolean => {
  const types = Array.from(e.dataTransfer.types);
  return (
    types.includes(KEYCAP_DRAG_MIME) ||
    types.includes(URI_MIME) ||
    types.includes('Files')
  );
};

export const InstallKeycapTile = ({
  onActivate,
  label = 'Install',
  ariaLabel = 'Install a keycap',
  size = 72,
  className,
}: InstallKeycapTileProps): ReactElement => {
  const [dragOver, setDragOver] = useState(false);

  const handleClick = useCallback(() => {
    onActivate?.({ kind: 'click' });
  }, [onActivate]);

  const handleDragOver = useCallback((e: DragEvent<HTMLButtonElement>) => {
    if (!acceptsDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLButtonElement>) => {
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLButtonElement>) => {
      if (!acceptsDrag(e)) return;
      e.preventDefault();
      setDragOver(false);
      const dt = e.dataTransfer;
      const keycapId = dt.getData(KEYCAP_DRAG_MIME);
      if (keycapId) {
        onActivate?.({ kind: 'keycap-id', value: keycapId });
        return;
      }
      const uri = dt.getData(URI_MIME);
      if (uri) {
        onActivate?.({ kind: 'uri', value: uri.split('\n')[0]?.trim() });
        return;
      }
      const file = dt.files?.[0];
      if (file) {
        onActivate?.({ kind: 'file', file });
      }
    },
    [onActivate],
  );

  return (
    <button
      type="button"
      className={cx(styles.tile, dragOver && styles.dragOver, className)}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-label={ariaLabel}
    >
      <span className={styles.glyph} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className={styles.label}>{label}</span>
    </button>
  );
};
