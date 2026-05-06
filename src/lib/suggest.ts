// Detect what kind of content the clipboard holds and surface relevant tools.
// Returns a Set of tool IDs to highlight on the keyboard.
//
// Heuristics are best-effort — false positives are cheap (extra glow on a key),
// false negatives are also cheap (key looks normal). Don't over-engineer.

const URL_RE = /^https?:\/\/\S+$/i;
const URL_LIKE_RE = /https?:\/\/\S+/i;
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const URL_ENCODED_RE = /(%[0-9A-Fa-f]{2}){2,}/;
const HAS_CHINESE_RE = /[一-鿿]/;

const TOOL_IDS = {
  AI_SUMMARIZE: 'ctrl.builtin.ai-summarize',
  BAIDU: 'ctrl.builtin.baidu-search',
  BASE64_DECODE: 'ctrl.builtin.base64-decode',
  BASE64_ENCODE: 'ctrl.builtin.base64-encode',
  GITHUB: 'ctrl.builtin.github-search',
  GOOGLE: 'ctrl.builtin.google-search',
  JSON_PRETTY: 'ctrl.builtin.json-pretty',
  LOWERCASE: 'ctrl.builtin.lowercase',
  MD_CODEBLOCK: 'ctrl.builtin.markdown-codeblock',
  MD_HEADING: 'ctrl.builtin.markdown-heading',
  MD_QUOTE: 'ctrl.builtin.markdown-quote',
  UPPERCASE: 'ctrl.builtin.uppercase',
  URL_DECODE: 'ctrl.builtin.url-decode',
  URL_ENCODE: 'ctrl.builtin.url-encode',
  WORD_COUNT: 'ctrl.builtin.word-count',
  ZHIHU: 'ctrl.builtin.zhihu-search',
} as const;

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeBase64(text: string): boolean {
  const t = text.trim();
  if (t.length < 20) return false;
  if (t.length % 4 !== 0) return false;
  if (!BASE64_RE.test(t)) return false;
  // Avoid matching plain ASCII text that happens to fit base64 alphabet.
  // Real base64 has high entropy / mixed case + digits in most samples.
  const hasUpper = /[A-Z]/.test(t);
  const hasLower = /[a-z]/.test(t);
  const hasDigit = /[0-9]/.test(t);
  // Require at least 2 of 3 character classes
  return Number(hasUpper) + Number(hasLower) + Number(hasDigit) >= 2;
}

function looksLikeCodeBlock(text: string): boolean {
  // Multi-line + braces / brackets / common code keywords
  const lines = text.split('\n');
  if (lines.length < 3) return false;
  const codeIndicators = /[{}();]|\b(function|class|const|let|var|def|fn|import|return)\b/;
  let hits = 0;
  for (const line of lines) {
    if (codeIndicators.test(line)) hits += 1;
    if (hits >= 2) return true;
  }
  return false;
}

export interface SuggestionResult {
  toolIds: Set<string>;
  /** Brief one-line label describing the detected kind (for status / debug). */
  label: string | null;
}

const EMPTY: SuggestionResult = { toolIds: new Set(), label: null };

export function detectClipboardSuggestions(text: string): SuggestionResult {
  if (!text || text.length === 0) return EMPTY;
  const trimmed = text.trim();
  if (trimmed.length === 0) return EMPTY;

  const ids = new Set<string>();
  const labels: string[] = [];

  // Pure URL — strongest single signal
  if (URL_RE.test(trimmed)) {
    ids.add(TOOL_IDS.GOOGLE);
    ids.add(TOOL_IDS.GITHUB);
    ids.add(TOOL_IDS.BAIDU);
    ids.add(TOOL_IDS.MD_QUOTE);
    ids.add(TOOL_IDS.URL_ENCODE);
    labels.push('链接');
  }

  // JSON
  if (looksLikeJson(trimmed)) {
    ids.add(TOOL_IDS.JSON_PRETTY);
    labels.push('JSON');
  }

  // Base64
  if (looksLikeBase64(trimmed)) {
    ids.add(TOOL_IDS.BASE64_DECODE);
    labels.push('base64');
  }

  // URL-encoded
  if (URL_ENCODED_RE.test(trimmed)) {
    ids.add(TOOL_IDS.URL_DECODE);
    labels.push('URL 编码');
  }

  // Code block (multi-line code-ish)
  if (looksLikeCodeBlock(trimmed)) {
    ids.add(TOOL_IDS.MD_CODEBLOCK);
    labels.push('代码');
  }

  // Long Chinese text — almost always wants summarize / word-count
  if (HAS_CHINESE_RE.test(trimmed) && trimmed.length >= 80) {
    ids.add(TOOL_IDS.AI_SUMMARIZE);
    ids.add(TOOL_IDS.WORD_COUNT);
    ids.add(TOOL_IDS.ZHIHU);
    labels.push('中文长文');
  }

  // Long English text
  if (!HAS_CHINESE_RE.test(trimmed) && trimmed.length >= 200 && !URL_RE.test(trimmed)) {
    ids.add(TOOL_IDS.AI_SUMMARIZE);
    ids.add(TOOL_IDS.WORD_COUNT);
    labels.push('长文');
  }

  // Single short URL inside longer text → still suggest search/quote
  if (!URL_RE.test(trimmed) && URL_LIKE_RE.test(trimmed) && trimmed.length < 500) {
    ids.add(TOOL_IDS.MD_QUOTE);
  }

  // ALL CAPS short string → lowercase
  if (trimmed.length >= 10 && trimmed.length <= 200 && /^[A-Z\s\d.,!?'"-]+$/.test(trimmed) && /[A-Z]/.test(trimmed)) {
    ids.add(TOOL_IDS.LOWERCASE);
    labels.push('大写');
  }

  // All lowercase ASCII letters → uppercase / sentence case helpers
  if (trimmed.length >= 10 && trimmed.length <= 200 && /^[a-z\s\d.,!?'"-]+$/.test(trimmed) && /[a-z]/.test(trimmed)) {
    ids.add(TOOL_IDS.UPPERCASE);
    labels.push('小写');
  }

  return { toolIds: ids, label: labels.length > 0 ? labels.join(' · ') : null };
}
