// MarkdownViewer — Tiptap (WYSIWYG) + CodeMirror (source) markdown
// editor. Lazy chunk; loaded when the workspace first opens a
// `text/markdown` resource.
//
// Design notes
// -------------
// CTRL's plain-text 哲学 (CLAUDE.md): the file on disk is the canonical
// truth. Tiptap stores rich content as ProseMirror JSON internally,
// which would diverge from the markdown source. To keep the vim test
// honest, we treat the markdown source as authoritative and only round-
// trip through ProseMirror for editing:
//
//   1. Load: file body (markdown text) → markdownToHtml() → editor.
//   2. Edit (WYSIWYG): editor.onUpdate → htmlToMarkdown() → buffer.
//   3. Edit (Source): CodeMirror text change → buffer directly.
//   4. Save: buffer → vault_write (file on disk = markdown).
//
// The HTML round-trip is intentionally conservative: headings / lists /
// inline / code / links / blockquotes / hr — the 95% set that Obsidian
// users actually edit. Power users who care about deep markdown
// extensions (footnotes, math, custom syntax) drop into Source mode,
// which is a pure CodeMirror buffer with no transformation.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import { markdownToHtml, htmlToMarkdown } from './markdownConvert';
import styles from './Viewer.module.css';

export const MarkdownViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error, writable } =
    useViewerResource(resource);
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg');

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // codeBlock comes from StarterKit; lowlight is a follow-up
          // wire-up so highlighting works inside the editor.
        }),
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        }),
        Image,
      ],
      editable: resource.editable,
      content: '',
      // Tiptap re-renders on every keystroke; debounce-by-content keeps
      // CPU usage steady on large docs without a manual setTimeout.
      onUpdate: ({ editor: ed }) => {
        if (!resource.editable) return;
        setContent(htmlToMarkdown(ed.getHTML()));
      },
    },
    [resource.uri, resource.editable],
  );

  // Hydrate the editor once content has loaded. Tiptap diffs the doc
  // tree internally, so re-applying the same HTML is cheap.
  useEffect(() => {
    if (!editor || content == null) return;
    const html = markdownToHtml(content);
    if (editor.getHTML() !== html) {
      editor.commands.setContent(html, false);
    }
  }, [editor, content]);

  const rightActions = useMemo(
    () => (
      <div className={styles.modeToggle}>
        <button
          type="button"
          className={styles.modeButton}
          data-active={mode === 'wysiwyg'}
          onClick={() => setMode('wysiwyg')}
        >
          Preview
        </button>
        <button
          type="button"
          className={styles.modeButton}
          data-active={mode === 'source'}
          onClick={() => setMode('source')}
        >
          Source
        </button>
      </div>
    ),
    [mode],
  );

  return (
    <div className={styles.frame}>
      <ViewerChrome
        resource={resource}
        dirty={dirty}
        saving={saving}
        error={error}
        writable={writable}
        onSave={save}
        rightActions={rightActions}
      />
      <div className={styles.scroll}>
        {content === null && !error ? (
          <pre className={styles.markdownStub}>loading…</pre>
        ) : error && content === null ? (
          <pre className={styles.markdownStub} role="alert">
            {error}
          </pre>
        ) : mode === 'wysiwyg' ? (
          <div className={styles.prose}>
            <EditorContent editor={editor} />
          </div>
        ) : (
          <CodeMirror
            value={content ?? ''}
            extensions={[markdown()]}
            basicSetup={{ lineNumbers: true, foldGutter: true }}
            onChange={(value) => setContent(value)}
            readOnly={!resource.editable}
            className={styles.codeMirror}
            height="100%"
          />
        )}
      </div>
    </div>
  );
};
