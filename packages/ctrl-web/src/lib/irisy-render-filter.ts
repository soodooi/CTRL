// Irisy render filter — strip model-side reasoning scaffolds before
// Markdown renders them in the chat bubble.
//
// Why this exists (bao 2026-06-04, post-Phase-4 user test):
// qwen2.5:7b (Ollama primary) is a coder-tuned model trained to
// produce structured "Goal / Progress / Done / In Progress / Next
// Steps / Critical Context" scaffolds before its actual reply — this
// is a reasoning aid for tool-using agents, not a user-facing chat
// format. Prompt-side instructions ("DO NOT output Goal/Progress...")
// only partially hold on 7B models; bao confirmed it still leaks.
//
// The filter is also a defence-in-depth against:
//   • Pi / Claude `<thinking>` blocks that occasionally escape RPC
//     serialization
//   • internal codename leaks (Pi / Claude / Ollama / Volc / vault_*
//     / install_* / brain_status) — bao 2026-05-22
//     `decision_pi_is_sole_brain_hermes_is_mcp` + ADR-002 §3.7
//     brand-label rule
//   • bare narration lines like "Calling list_local_skills..."
//     ("show what the tool is doing in natural language" — Cursor 2.0
//     verbatim, brainstorm §0.1)
//
// ADR-002 substrate § provider v9 §3.6 (2026-06-06). PWA-side XML
// parser (`<call>` / `<call-result>` segment split) has been RETIRED —
// Pi uses each provider's native function-calling protocol and emits
// tool dispatches as separate `tool_use` / `tool_result` messages, not
// inline in the assistant's text. This filter now runs on the full
// assistant content string; the remaining hygiene (scaffolds /
// thinking / narration / codenames) still applies.

/** Headers (case-insensitive, line-anchored, optional Markdown #/##)
 *  that mark the start of a model reasoning scaffold. Encountering
 *  any of these starts a "scaffold zone" that runs until the next
 *  recognised text or end of buffer. */
const SCAFFOLD_HEADERS = [
  'Goal',
  'Goals',
  'Constraints & Preferences',
  'Constraints',
  'Progress',
  'Done',
  'In Progress',
  'Blocked',
  'Key Decisions',
  'Decisions',
  'Next Steps',
  'Next Step',
  'Critical Context',
  'Context',
  'Plan',
  'Thinking',
  'Reasoning',
];

const SCAFFOLD_HEADER_RE = new RegExp(
  '^\\s*(?:#{1,3}\\s+)?(?:' +
    SCAFFOLD_HEADERS.map((h) => h.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&')).join('|') +
    ')\\s*:?\\s*$',
  'i',
);

/** `<thinking>...</thinking>` blocks Pi sometimes emits when the
 *  model picks up a Claude-style reasoning habit. Greedy across
 *  lines; matched non-greedily across tags so multiple separate
 *  blocks aren't merged. */
const THINKING_BLOCK_RE = /<thinking>[\s\S]*?<\/thinking>/gi;

/** Standalone narration lines the model emits before tool-calling
 *  but never closes ("Calling list_local_skills..." / "I'll search
 *  for..." / "Let me check..."). Each match is one whole line. */
const NARRATION_LINE_RE = new RegExp(
  '^\\s*(?:' +
    [
      "I'?ll\\s+(?:search|check|look|run|call|fetch|invoke|find|do|use)",
      "Let me (?:search|check|look|run|call|fetch|invoke|find|do|use|think)",
      'Calling\\s+\\w+',
      'Searching\\s+\\w+',
      'Invoking\\s+\\w+',
      'Running\\s+the?\\s+\\w+\\s+(?:tool|command)',
      'Looking\\s+(?:up|for|at)\\s+\\w+',
      "I'?m\\s+(?:going\\s+to|now)\\s+",
    ].join('|') +
    ').*$',
  'gim',
);

/** Replace internal codenames with the brand-label equivalent (or
 *  delete when no good label exists). Case-insensitive whole-word.
 *
 *  Pi / claude-oauth / volc / ollama / vault_write etc. should never
 *  leak — they're implementation detail. Replacements pick the
 *  closest user-facing word. */
const CODENAME_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  // brain layer
  [/\bPi\b/g, 'the assistant'],
  [/\bclaude-oauth\b/gi, 'Claude (OAuth)'],
  [/\banthropic-api\b/gi, 'Anthropic API'],
  [/\bopenai-api\b/gi, 'OpenAI API'],
  [/\bvolc(?:-byok)?\b/gi, 'CTRL Cloud'],
  [/\bollama\b/gi, 'Ollama (local)'],
  // tool names — match the underscore form only so prose like "the
  // vault" or "your vault" survives.
  [/\bvault_write\b/g, 'save to your vault'],
  [/\bvault_read\b/g, 'open from your vault'],
  [/\bvault_search\b/g, 'search your vault'],
  [/\bvault_tags\b/g, 'list your tags'],
  [/\bvault_backlinks\b/g, 'check backlinks'],
  [/\blist_local_skills\b/g, 'look up local skills'],
  [/\binstall_mcp\b/g, 'add a key'],
  [/\blist_mcps\b/g, 'list your keys'],
  [/\bmcp_run\b/g, 'run that key'],
  [/\bbrain_status\b/g, 'check status'],
  // process plumbing
  [/\bctrl-pi-bridge\b/gi, ''],
  [/\bctrl-pi-mcp\b/gi, ''],
  [/\bRpcClient\b/g, ''],
  [/\bMCP server\b/gi, ''],
];

/** Locate the first scaffold header in `text`. Returns the match's
 *  starting offset or -1 if none. */
function findFirstScaffoldHeader(text: string): number {
  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    if (SCAFFOLD_HEADER_RE.test(line)) return offset;
    offset += line.length + 1;
  }
  return -1;
}

/** Strip everything from the first scaffold header to the end of the
 *  text. We chose "to the end" over "until next non-scaffold header"
 *  because qwen-style planners don't have a clean closing — they
 *  bleed into a `✓` marker or a fresh assistant turn. The pre-
 *  scaffold prose (often empty for qwen, since planner IS the reply)
 *  is preserved. */
function stripScaffold(text: string): string {
  const start = findFirstScaffoldHeader(text);
  if (start === -1) return text;
  return text.slice(0, start).trimEnd();
}

function stripThinking(text: string): string {
  return text.replace(THINKING_BLOCK_RE, '');
}

function stripNarration(text: string): string {
  return text.replace(NARRATION_LINE_RE, '');
}

function rewriteCodenames(text: string): string {
  let out = text;
  for (const [re, repl] of CODENAME_REPLACEMENTS) {
    out = out.replace(re, repl);
  }
  return out;
}

/** Collapse 3+ consecutive blank lines (a side effect of the strip
 *  passes) down to 2. Keeps paragraph breaks intact. */
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

/**
 * Sanitise an assistant-side text chunk before it lands in the chat
 * bubble. Order matters — strip scaffolds first (cheapest), then
 * thinking, then narration, then codename rewrite (which can
 * accidentally drop a sentence's whole subject if applied early).
 */
export function cleanReplyText(text: string): string {
  if (!text) return text;
  const a = stripScaffold(text);
  const b = stripThinking(a);
  const c = stripNarration(b);
  const d = rewriteCodenames(c);
  return collapseBlankLines(d).trim();
}
