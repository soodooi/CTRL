import type { Tool } from './tools';

// Pinyin first-letter map covering Chinese characters used in v0.1 builtin tool names.
// Extend as more manifests land; missing chars fall through (searched by literal char).
const PINYIN_FIRST: Record<string, string> = {
  总: 'z', 结: 'j', 百: 'b', 度: 'd', 搜: 's', 索: 's',
  解: 'j', 码: 'm', 编: 'b', 美: 'm', 化: 'h',
  小: 'x', 写: 'x', 转: 'z', 换: 'h',
  代: 'd', 标: 'b', 题: 't', 引: 'y', 用: 'y',
  大: 'd', 字: 'z', 数: 's', 统: 't', 计: 'j',
  知: 'z', 乎: 'h',
};

function toPinyinAbbr(s: string): string {
  let out = '';
  for (const ch of s) {
    const py = PINYIN_FIRST[ch];
    if (py) {
      out += py;
      continue;
    }
    if (/[a-z0-9]/i.test(ch)) {
      out += ch.toLowerCase();
    }
    // whitespace/punct: drop
  }
  return out;
}

function fuzzyIncludes(query: string, target: string): boolean {
  if (!query) return true;
  if (target.includes(query)) return true;
  // non-contiguous fuzzy: each char of query appears in order
  let qi = 0;
  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

export function matchesTool(tool: Tool, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  const fields: string[] = [
    tool.name.toLowerCase(),
    tool.id.toLowerCase(),
    tool.description.short.toLowerCase(),
    tool.tags.join(' ').toLowerCase(),
    toPinyinAbbr(tool.name),
  ];
  return fields.some((f) => fuzzyIncludes(q, f));
}

// Exported for tests / debugging / future highlight rendering.
export const __internal = { toPinyinAbbr, fuzzyIncludes };
