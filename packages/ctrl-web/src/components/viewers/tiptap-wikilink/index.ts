// Wikilink Tiptap extension — `[[target]]` → atom node with click-to-open
// behaviour, ported in spirit from seahop/kairo's wikilink plugin (MIT,
// Copyright (c) 2026 Sean Hopkins) and adapted to CTRL's kernel API.
//
// (ADR-002 substrate § vault v1 §8.5 + §8.8, 2026-06-01 — memory
// `decision_vault_adr_002_section_8`.)
//
// Surface:
//   • Typing `[[xxx]]` rewrites to a `wikilink` atom node with
//     `target='xxx'`.
//   • Renders as `<span class="tiptap-wikilink" data-target=…>[[xxx]]</span>`.
//     Broken targets receive `data-broken=""` for the CSS hook.
//   • Click handler in MarkdownViewer reads `data-target` and opens a
//     workspace `vault-md` tab.
//   • Round-trip to markdown handled in MarkdownViewer.htmlToMarkdown
//     by treating the span as the literal `[[target]]` glyph.

import { mergeAttributes, Node, InputRule } from '@tiptap/core';

export interface WikilinkAttrs {
  target: string;
  broken: boolean;
}

export const WikilinkExtension = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      target: { default: '' },
      broken: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute('data-broken') !== null,
        renderHTML: (attrs) =>
          attrs.broken ? { 'data-broken': '' } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          return {
            target: el.getAttribute('data-target') ?? '',
            broken: el.getAttribute('data-broken') !== null,
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const target = (node.attrs.target as string) ?? '';
    const className =
      'tiptap-wikilink' +
      (node.attrs.broken ? ' tiptap-wikilink-broken' : '');
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-wikilink': '',
        'data-target': target,
        class: className,
        // Make the span keyboard-focusable so click-via-Enter works.
        role: 'link',
        tabindex: '0',
      }),
      `[[${target}]]`,
    ];
  },

  addInputRules() {
    return [
      // Trigger on the closing `]]` so the user can type the target
      // freely without flickering.
      new InputRule({
        find: /\[\[([^\[\]\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const target = (match[1] ?? '').trim();
          if (!target) return;
          const node = this.type.create({ target, broken: false });
          state.tr.replaceWith(range.from, range.to, node);
        },
      }),
    ];
  },
});

/**
 * Convert raw markdown `[[stem]]` substrings to the renderHTML shape
 * we accept in parseHTML. Used by MarkdownViewer.markdownToHtml so
 * that loaded files surface as styled atoms instead of literal text.
 *
 * `target` is captured verbatim; resolution + broken-link inference
 * happens in the viewer using the kernel `vault_list` snapshot.
 */
export const renderWikilinkInline = (target: string, broken: boolean): string => {
  const safe = escapeHtml(target);
  const cls =
    'tiptap-wikilink' + (broken ? ' tiptap-wikilink-broken' : '');
  const brokenAttr = broken ? ' data-broken=""' : '';
  return `<span data-wikilink data-target="${safe}" class="${cls}" role="link" tabindex="0"${brokenAttr}>[[${safe}]]</span>`;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
