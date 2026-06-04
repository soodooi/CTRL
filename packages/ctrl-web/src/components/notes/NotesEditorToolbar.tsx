// NotesEditorToolbar — toolbar above the markdown editor.
//
// bao 2026-06-03 (kairo-parity batch): kairo's editor toolbar has
// quick switches for view density (Editor / Reading) + per-tool
// triggers (Git / Versions). In CTRL we already expose Git/Diagram
// via the top-level ViewSwitcher (so the toolbar doesn't repeat
// those), but the Edit / Read mode lives inside the editor surface —
// that's where the toggle belongs.
//
// `mode` controls the editor's read/write state. `reading=true` makes
// MarkdownViewer hide the source pane + flip Tiptap to readOnly.
// Spell is browser-native (`spellCheck` attribute on contenteditable)
// — exposed here so the user has a single discoverable on/off.

import { type ReactElement } from 'react';
import styles from './Notes.module.css';

export type EditorMode = 'edit' | 'reading';

interface NotesEditorToolbarProps {
  mode: EditorMode;
  onModeChange: (next: EditorMode) => void;
  spellCheck: boolean;
  onSpellCheckChange: (next: boolean) => void;
}

export const NotesEditorToolbar = ({
  mode,
  onModeChange,
  spellCheck,
  onSpellCheckChange,
}: NotesEditorToolbarProps): ReactElement => (
  <div className={styles.notesEditorToolbar} role="toolbar" aria-label="Editor toolbar">
    <div className={styles.notesEditorToolbarGroup}>
      <button
        type="button"
        className={styles.notesEditorToolbarBtn}
        data-active={mode === 'edit' || undefined}
        onClick={() => onModeChange('edit')}
        title="Edit mode (Tiptap WYSIWYG)"
      >
        Edit
      </button>
      <button
        type="button"
        className={styles.notesEditorToolbarBtn}
        data-active={mode === 'reading' || undefined}
        onClick={() => onModeChange('reading')}
        title="Reading mode (read-only render)"
      >
        Reading
      </button>
    </div>
    <button
      type="button"
      className={styles.notesEditorToolbarBtn}
      data-active={spellCheck || undefined}
      onClick={() => onSpellCheckChange(!spellCheck)}
      title="Toggle browser-native spellcheck"
    >
      ✓ Spell
    </button>
    <span className={styles.notesEditorToolbarSpacer} aria-hidden />
  </div>
);
