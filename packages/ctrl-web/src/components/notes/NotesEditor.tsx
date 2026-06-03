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

import { useMemo, type ReactElement } from 'react';
import { vaultRead, vaultWrite } from '@/lib/kernel';
import { ViewerHost } from '@/components/viewers/ViewerHost';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import styles from './Notes.module.css';

interface NotesEditorProps {
  path: string | null;
}

export const NotesEditor = ({ path }: NotesEditorProps): ReactElement => {
  const resource = useMemo(() => {
    if (!path) return null;
    const base = resourceFromVaultPath(path);
    return {
      ...base,
      onSave: async (content: string) => {
        const current = await vaultRead(path);
        await vaultWrite({
          path,
          content,
          frontmatter: current.frontmatter,
        });
      },
    };
  }, [path]);

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
    <section className={styles.editor} aria-label="Editor">
      <ViewerHost resource={resource} />
    </section>
  );
};
