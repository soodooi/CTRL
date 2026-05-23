// FileDropzone — drag/click upload area. L1 primitive for T3 file
// keycaps (OCR, PDF assist, screenshot annotate, …) and any
// composer that needs an image attachment.

import {
  useCallback,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react';
import styles from './FileDropzone.module.css';

export interface FileDropzoneProps {
  /** Comma-separated accept hint, e.g. "image/*,.pdf". */
  accept?: string;
  /** Allow multiple files in one drop / pick. */
  multiple?: boolean;
  /** Fires for both drag-drop and click-pick. */
  onFiles: (files: ReadonlyArray<File>) => void;
  /** Override the primary CTA copy. */
  label?: string;
  /** Override the secondary hint copy. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

const UploadGlyph = (): ReactElement => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={styles.icon}
  >
    <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </svg>
);

export const FileDropzone = ({
  accept,
  multiple = false,
  onFiles,
  label = 'Drop a file or click to browse',
  hint,
  disabled = false,
  className,
}: FileDropzoneProps): ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  const handleClick = useCallback((): void => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLButtonElement>): void => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) onFiles(files);
    },
    [onFiles, disabled],
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLButtonElement>): void => {
      e.preventDefault();
      if (!disabled) setDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    setDragging(false);
  }, []);

  return (
    <button
      type="button"
      className={[styles.zone, className ?? ''].filter(Boolean).join(' ')}
      data-dragging={dragging}
      data-disabled={disabled}
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      aria-disabled={disabled}
      aria-label={label}
    >
      <UploadGlyph />
      <span>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className={styles.input}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFiles(files);
          e.target.value = '';
        }}
        tabIndex={-1}
      />
    </button>
  );
};
