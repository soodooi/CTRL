// MarkdownViewer — Tiptap-powered WYSIWYG markdown editor.
//
// Tiptap stores rich content as ProseMirror JSON internally. For
// vault-file compatibility (vim test, Obsidian interop), we serialize
// to/from raw markdown via Tiptap's built-in HTML round-trip + a thin
// markdown post-pass. Bidirectional fidelity is "good-enough for the
// 90% of CTRL prose use cases" — power users still get raw markdown
// in the underlying file.
//
// Toggle button switches between WYSIWYG and source-mode (raw markdown
// in a CodeMirror buffer) — Obsidian's Live Preview / Source toggle
// muscle memory.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeMirror from '@uiw/react-codemirror';
import type { ViewerProps } from '@/lib/viewer-registry';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
import styles from './Viewer.module.css';

// Crude markdown ↔ HTML — enough to preserve headings / lists / code
// blocks / inline formatting on the round trip. Real fidelity will
// come from a remark/rehype pipeline once we install one; today the
// goal is "edits don't destroy the file".
const markdownToHtml = (md: string): string => {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  let inList = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        codeLang = line.slice(3).trim();
        out.push(`<pre><code${codeLang ? ` class="language-${codeLang}"` : ''}>`);
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    const listItem = /^[-*]\s+(.*)$/.exec(line);
    if (listItem) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(listItem[1]!)}</li>`);
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    if (line.trim() === '') {
      out.push('');
      continue;
    }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const inline = (s: string): string =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');

const htmlToMarkdown = (html: string): string => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return serializeNode(div).trim() + '\n';
};

const serializeNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const inner = Array.from(el.childNodes).map(serializeNode).join('');
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n${'#'.repeat(Number(tag[1]))} ${inner}\n\n`;
    case 'p':
      return `${inner}\n\n`;
    case 'strong':
    case 'b':
      return `**${inner}**`;
    case 'em':
    case 'i':
      return `*${inner}*`;
    case 'code':
      return el.parentElement?.tagName.toLowerCase() === 'pre'
        ? inner
        : `\`${inner}\``;
    case 'pre': {
      const lang =
        el.querySelector('code')?.className.replace(/^language-/, '') ?? '';
      return `\n\`\`\`${lang}\n${inner}\n\`\`\`\n\n`;
    }
    case 'ul':
      return `${inner}\n`;
    case 'ol':
      return `${inner}\n`;
    case 'li':
      return `- ${inner}\n`;
    case 'a':
      return `[${inner}](${el.getAttribute('href') ?? ''})`;
    case 'br':
      return '\n';
    case 'hr':
      return '\n---\n';
    default:
      return inner;
  }
};

export const MarkdownViewer = ({ resource }: ViewerProps): ReactElement => {
  const { content, setContent, save, dirty, saving, error } =
    useViewerResource(resource);
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg');

  const editor = useEditor(
    {
      extensions: [StarterKit],
      editable: resource.editable,
      content: '',
      onUpdate: ({ editor: ed }) => {
        if (!resource.editable) return;
        // IME guard: do not propagate while a CJK composition is in
        // progress — the markdown round-trip below would re-enter
        // setContent() mid-composition and corrupt the input ("ni hao"
        // pinyin leaks through as raw characters next to "你好").
        if (ed.view.composing) return;
        setContent(htmlToMarkdown(ed.getHTML()));
      },
    },
    [resource.uri, resource.editable],
  );

  // Hydrate editor when content arrives. Strict-mode safe — Tiptap
  // diffs the doc, so re-set on same content is cheap.
  //
  // Skip while the user is actively typing (focused or composing) —
  // markdown ↔ HTML round-trip is lossy and tears the cursor / IME
  // state. External content changes still apply once the editor blurs.
  useEffect(() => {
    if (!editor || content == null) return;
    if (editor.view.composing) return;
    if (editor.isFocused) return;
    const html = markdownToHtml(content);
    if (editor.getHTML() !== html) {
      editor.commands.setContent(html, { emitUpdate: false });
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
        onSave={save}
        rightActions={rightActions}
      />
      <div className={styles.scroll}>
        {content === null && !error ? (
          <pre className={styles.markdownStub}>loading…</pre>
        ) : mode === 'wysiwyg' ? (
          <div className={styles.prose}>
            <EditorContent editor={editor} />
          </div>
        ) : (
          <CodeMirror
            value={content ?? ''}
            theme="light"
            basicSetup={{ lineNumbers: true, foldGutter: true }}
            onChange={(value) => setContent(value)}
            readOnly={!resource.editable}
            className={styles.codeMirror}
          />
        )}
      </div>
    </div>
  );
};
