// NotesEditor — center column of the Notes app.
//
// (ADR-002 substrate § vault v1 §8.5 + §8.6 v4, 2026-06-02 — memory
// `decision_vault_adr_002_section_8`.)
//
// Thin wrapper around the workspace `ViewerHost` + `resourceFromVaultPath`
// pattern. The actual editor (Tiptap + CodeMirror 6 + wikilink Tiptap
// extension) lives in `MarkdownViewer.tsx`; this wrapper bridges
// `NotesApp`'s `selectedPath` state to a `ViewerResource` with a
// `vault_write`-backed `onSave`. Forward-compatible: upstream
// editor lib upgrades flow through `MarkdownViewer` without touching
// this file.
//
// bao 2026-06-03 (kairo-parity batch): wraps the viewer with a
// toolbar (Edit / Reading / Spell) + bottom status bar (word / char /
// saved). Reading mode forces the underlying ViewerHost into a
// non-editable state by withholding `editable: true` from the resource.

import { useMemo, useState, type ReactElement } from 'react';
import { vaultRead, vaultWrite } from '@/lib/kernel';
import { ViewerHost } from '@/components/viewers/ViewerHost';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import { FrontmatterPanel } from './FrontmatterPanel';
import { NotesEditorToolbar, type EditorMode } from './NotesEditorToolbar';
import { NotesStatusBar } from './NotesStatusBar';
import styles from './Notes.module.css';

interface NotesEditorProps {
  path: string | null;
}

export const NotesEditor = ({ path }: NotesEditorProps): ReactElement => {
  const [mode, setMode] = useState<EditorMode>('edit');
  const [spellCheck, setSpellCheck] = useState(false);

  const resource = useMemo(() => {
    if (!path) return null;
    const base = resourceFromVaultPath(path);
    const editable = mode === 'edit';
    return {
      ...base,
      editable,
      onSave: editable
        ? async (content: string) => {
            const current = await vaultRead(path);
            await vaultWrite({
              path,
              content,
              frontmatter:
                (current.frontmatter as Record<string, unknown>) ?? {},
            });
          }
        : undefined,
    };
  }, [path, mode]);

  if (!resource) {
    return (
      <section className={styles.editorEmpty} aria-label="Editor">
        <p className={styles.emptyTitle}>Select a note</p>
        <p className={styles.emptyHint}>
          Pick a file from the tree on the left, or click <code>+ Note</code> to
          create a new one.
        </p>
      </section>
    );
  }

  return (
    <section
      className={styles.editor}
      aria-label="Editor"
      data-mode={mode}
      data-spell={spellCheck || undefined}
    >
      {path ? <FrontmatterPanel path={path} /> : null}
      <NotesEditorToolbar
        mode={mode}
        onModeChange={setMode}
        spellCheck={spellCheck}
        onSpellCheckChange={setSpellCheck}
      />
      <div className={styles.editorBody}>
        <ViewerHost resource={resource} />
      </div>
      <NotesStatusBar path={path} />
    </section>
  );
};
