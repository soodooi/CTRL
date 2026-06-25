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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeMirror from '@uiw/react-codemirror';
import type { ViewerProps } from '@/lib/viewer-registry';
import { parseSmartTable } from '@/lib/smart-table';
import { SmartTableViewer } from './SmartTableViewer';
import { useViewerResource } from './useViewerResource';
import { ViewerChrome } from './ViewerChrome';
// ADR-002 substrate § vault v1 §8.5 + §8.8 (2026-06-01, memory
// `decision_vault_adr_002_section_8`) — wikilink Tiptap extension
// ported from seahop/kairo MIT. Renders `[[target]]` as a clickable
// atom; broken-link styling sourced from `vault_list`.
import {
  WikilinkExtension,
  renderWikilinkInline,
} from './tiptap-wikilink';
import { useQuery } from '@tanstack/react-query';
import { vaultList } from '@/lib/kernel';
import { useWorkspaceStore } from '@/lib/workspace-store';
// ADR-002 v5 §10 + product spec §5.2 / P2 / P7 — Block AI ops floating
// menu wired against the live Tiptap editor handle.
import { BlockAiOps, type BlockAiResult } from '@/components/notes/BlockAiOps';
import { stampAiBlock } from '@/lib/ai-block-metadata';
import { vaultRelativePath } from '@/lib/viewer-uri';
import styles from './Viewer.module.css';

// Crude markdown ↔ HTML — enough to preserve headings / lists / code
// blocks / inline formatting on the round trip. Real fidelity will
// come from a remark/rehype pipeline once we install one; today the
// goal is "edits don't destroy the file".
//
// The wikilink resolver is threaded explicitly through every inline()
// call. The previous draft cached it in a module-level let, which
// raced between concurrent viewer instances — the last-mounted
// viewer would overwrite the earlier viewer's resolver and the
// earlier viewer would paint broken-link styling against the wrong
// vault snapshot. Passing the resolver removes the global side-channel.
type WikilinkResolver = (target: string) => boolean;

const markdownToHtml = (md: string, resolver?: WikilinkResolver): string => {
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
      out.push(`<h${level}>${inline(heading[2]!, resolver)}</h${level}>`);
      continue;
    }
    const listItem = /^[-*]\s+(.*)$/.exec(line);
    if (listItem) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(listItem[1]!, resolver)}</li>`);
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
    out.push(`<p>${inline(line, resolver)}</p>`);
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

const inline = (s: string, resolver?: WikilinkResolver): string => {
  // Convert `[[target]]` first — before the `[label](href)` rule —
  // so wikilink syntax never gets caught by the markdown-link regex.
  // Absent resolver = assume target resolves (paints as a normal
  // wikilink). Broken-link styling requires the caller to pass an
  // actual resolver.
  const wikilinked = s.replace(/\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g, (_, raw: string) => {
    const target = raw.trim();
    const resolved = resolver ? resolver(target) : true;
    return renderWikilinkInline(target, !resolved);
  });
  return escapeHtml(wikilinked)
    // The wikilink HTML we just emitted contains `<` `>` etc — undo
    // that escape pass by detecting the literal token. Escape is
    // necessary on the rest of the line, but our token is a single
    // span fragment we trust.
    .replace(
      /&lt;span data-wikilink[\s\S]+?&lt;\/span&gt;/g,
      (m) =>
        m
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&'),
    )
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
};

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
  // Wikilink atom — emit `[[target]]` verbatim regardless of inner
  // text, since the renderHTML puts the literal glyph inside and the
  // attribute carries the canonical target.
  if (
    tag === 'span' &&
    (el.getAttribute('data-wikilink') !== null ||
      el.classList.contains('tiptap-wikilink'))
  ) {
    const target = el.getAttribute('data-target') ?? el.textContent ?? '';
    return `[[${target.replace(/^\[\[|\]\]$/g, '')}]]`;
  }
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

  // Content-based upgrade: a `.md` whose frontmatter declares a `schema:` block
  // is a smart table (ADR-003 §6). Content-type inference is path-only, so any
  // smart-table `.md` arrives here as text/markdown; detect the schema and hand
  // off to the SmartTableViewer (query bar + grid/kanban) instead of rendering
  // it as plain prose.
  // A real smart table has at least one USER-declared column. `parseSmartTable`
  // always injects a system `ID` column (ensureRowIds), so `.length > 0` is true
  // for EVERY note (incl. plain prose / empty) — that false positive made every
  // note open as a smart table. Require a non-system column instead.
  const isSmartTable = useMemo(
    () => content != null && parseSmartTable(content).schema.some((c) => !c.system),
    [content],
  );
  const [mode, setMode] = useState<'wysiwyg' | 'source'>('wysiwyg');
  const openTab = useWorkspaceStore((s) => s.openTab);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Vault tree snapshot — broken-link inference for wikilinks. We
  // poll the vault list once per minute so freshly-created notes
  // resolve without forcing a viewer reload.
  const { data: vaultPaths = [] } = useQuery({
    queryKey: ['vault-list'],
    queryFn: () => vaultList(),
    staleTime: 60_000,
  });

  // Indices for wikilink target resolution. `pathSet` covers the
  // `Folder/Sub` and exact-filename cases in O(1); `stemIndex`
  // matches kernel `vault_graph` — first hit wins, longer-match
  // preferred when the target has a folder segment.
  const pathSet = useMemo(() => new Set(vaultPaths), [vaultPaths]);
  const stemIndex = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of vaultPaths) {
      const name = p.split('/').pop() ?? p;
      const stem = name.replace(/\.md$/, '');
      const existing = map.get(stem) ?? [];
      existing.push(p);
      map.set(stem, existing);
    }
    return map;
  }, [vaultPaths]);

  const resolveTarget = useCallback(
    (target: string): string | null => {
      if (pathSet.has(target)) return target;
      const withExt = `${target}.md`;
      if (pathSet.has(withExt)) return withExt;
      const stem = target.split('/').pop() ?? target;
      const cands = stemIndex.get(stem);
      if (!cands || cands.length === 0) return null;
      if (target.includes('/')) {
        const suffix = `${target}.md`;
        const exact = cands.find((p) => p.endsWith(suffix));
        if (exact) return exact;
      }
      return cands[0] ?? null;
    },
    [pathSet, stemIndex],
  );

  // Stable resolver for markdownToHtml — recomputed only when
  // resolveTarget changes (which means vaultPaths refreshed).
  const wikiResolver = useCallback(
    (target: string) => resolveTarget(target) !== null,
    [resolveTarget],
  );

  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const node = e.target as HTMLElement | null;
      if (!node) return;
      const wiki = node.closest<HTMLElement>('[data-wikilink]');
      if (!wiki) return;
      const target = wiki.getAttribute('data-target');
      if (!target) return;
      e.preventDefault();
      const resolved = resolveTarget(target);
      if (!resolved) return;
      const baseName = resolved.split('/').pop() ?? resolved;
      // The clicked wikilink opens the target as a regular workspace
      // vault-md tab. The Notes app already owns the active workspace,
      // so no explicit window-expand is required.
      openTab(
        {
          id: `vault:${resolved}`,
          kind: 'vault-md',
          title: baseName.replace(/\.md$/, ''),
          vaultPath: resolved,
        },
        { activate: true },
      );
    },
    [openTab, resolveTarget],
  );

  const editor = useEditor(
    {
      extensions: [StarterKit, WikilinkExtension],
      editable: resource.editable,
      content: '',
      onUpdate: ({ editor: ed }) => {
        if (!resource.editable) return;
        // IME guard: do not propagate while a CJK composition is in
        // progress — the markdown round-trip below would re-enter
        // setContent() mid-composition and corrupt the input ("ni hao"
        // pinyin leaks through as raw characters next to the composed CJK text).
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
    const html = markdownToHtml(content, wikiResolver);
    if (editor.getHTML() !== html) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [editor, content, wikiResolver]);

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

  if (isSmartTable) {
    return <SmartTableViewer resource={resource} />;
  }

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
          <div
            ref={containerRef}
            className={styles.prose}
            onClick={handleClick}
          >
            <EditorContent editor={editor} />
            {resource.editable ? (
              <BlockAiOps
                editor={editor as unknown as never}
                onAccept={(result: BlockAiResult) => {
                  // §8.7 transparency stamping — best-effort frontmatter
                  // append; never blocks the editor.
                  if (resource.uri.startsWith('vault://')) {
                    const path = vaultRelativePath(resource.uri);
                    void stampAiBlock({
                      path,
                      action: result.action,
                      original: result.original,
                      rewritten: result.rewritten,
                      user_input: result.user_input,
                    });
                  }
                }}
              />
            ) : null}
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
