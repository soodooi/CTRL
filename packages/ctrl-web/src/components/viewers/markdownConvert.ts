// markdownConvert — bidirectional markdown ↔ HTML used by MarkdownViewer.
//
// Why hand-rolled instead of pulling marked/turndown:
//   1. Bundle size — the closest pair of libs adds ~50KB gzip on top of
//      Tiptap. We only need the 95% Obsidian-edit subset (headings /
//      lists / inline / code / links / blockquotes / hr), not a full
//      CommonMark parser.
//   2. Round-trip control — converters built for HTML→Markdown
//      sanitisation (turndown) lossily normalise whitespace and reorder
//      list-item attributes; our parser keeps the markdown source
//      structure intact when nothing semantically changed.
//   3. Source-mode escape valve — power users editing footnotes or
//      math switch to Source mode, which bypasses this converter
//      entirely.
//
// Out of scope on purpose: tables (rendered via the smart-table viewer
// on a separate tab), GFM task lists (TODO once Tiptap task-list ext is
// added), tag autocomplete, wikilinks.

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inlineToHtml = (s: string): string =>
  // Inline rules apply on already-escaped text so user code/HTML doesn't
  // break out. Order matters: code first (protects its contents), then
  // bold (** before *), then italic, then links.
  escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
    );

export const markdownToHtml = (md: string): string => {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;

  const closeBlocks = (): void => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
    if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      closeBlocks();
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        codeLang = line.slice(3).trim();
        out.push(
          `<pre><code${codeLang ? ` class="language-${codeLang}"` : ''}>`,
        );
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
      closeBlocks();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inlineToHtml(heading[2]!)}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      closeBlocks();
      out.push('<hr/>');
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inlineToHtml(ul[1]!)}</li>`);
      continue;
    }
    const ol = /^(\d+)\.\s+(.*)$/.exec(line);
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inlineToHtml(ol[2]!)}</li>`);
      continue;
    }
    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inBlockquote) { out.push('<blockquote>'); inBlockquote = true; }
      out.push(`<p>${inlineToHtml(bq[1]!)}</p>`);
      continue;
    }
    if (line.trim() === '') {
      closeBlocks();
      continue;
    }
    closeBlocks();
    out.push(`<p>${inlineToHtml(line)}</p>`);
  }

  closeBlocks();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
};

export const htmlToMarkdown = (html: string): string => {
  if (typeof document === 'undefined') return html;
  const div = document.createElement('div');
  div.innerHTML = html;
  const text = serializeNode(div).trim();
  // Collapse triple+ blank lines to a single blank — Tiptap can emit
  // empty <p> sequences when the user mashes Enter.
  return text.replace(/\n{3,}/g, '\n\n') + '\n';
};

const serializeNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const childrenText = Array.from(el.childNodes).map(serializeNode).join('');
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n${'#'.repeat(Number(tag[1]))} ${childrenText}\n\n`;
    case 'p':
      return `${childrenText}\n\n`;
    case 'strong':
    case 'b':
      return `**${childrenText}**`;
    case 'em':
    case 'i':
      return `*${childrenText}*`;
    case 'code':
      return el.parentElement?.tagName.toLowerCase() === 'pre'
        ? childrenText
        : `\`${childrenText}\``;
    case 'pre': {
      const codeEl = el.querySelector('code');
      const langClass = codeEl?.className.match(/language-(\S+)/);
      const lang = langClass ? langClass[1] : '';
      const body = codeEl?.textContent ?? childrenText;
      return `\n\`\`\`${lang}\n${body}\n\`\`\`\n\n`;
    }
    case 'ul':
      return `${childrenText}\n`;
    case 'ol':
      // Re-number for stable output even when the editor shuffles items.
      return Array.from(el.children)
        .map((li, i) => `${i + 1}. ${serializeInline(li)}`)
        .join('\n')
        .concat('\n\n');
    case 'li':
      return `- ${serializeInline(el)}\n`;
    case 'a':
      return `[${childrenText}](${el.getAttribute('href') ?? ''})`;
    case 'br':
      return '\n';
    case 'hr':
      return '\n---\n\n';
    case 'blockquote':
      return childrenText
        .split('\n')
        .map((l) => (l.length > 0 ? `> ${l}` : '>'))
        .join('\n')
        .replace(/(^|\n)>\s*$/gm, '')
        .replace(/(^>.*)/, '$1') + '\n';
    case 'img':
      return `![${el.getAttribute('alt') ?? ''}](${el.getAttribute('src') ?? ''})`;
    default:
      return childrenText;
  }
};

const serializeInline = (el: Element): string =>
  Array.from(el.childNodes).map(serializeNode).join('').trim();
