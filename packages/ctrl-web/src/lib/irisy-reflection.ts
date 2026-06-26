// Irisy sleep-time reflection — ADR-005 irisy v4 §5 (2026-06-04).
//
// Sleep-time subagent (Letta sleeptime_v2 lineage): runs between
// user-facing turns, never user-visible. When the previous turn looks
// notable (Detect rules below), this module fires an async reflection
// LLM call against the existing brain endpoint with the seeded
// `irisy/reflect-prompt.md` system prompt, then writes the resulting
// episode markdown into `vault/irisy/episodes/<yyyy-mm-dd>-<slug>.md`.
//
// The main Irisy turn separately reads `vault/irisy/playbook.md` and
// folds it into its system prompt as procedural memory — closing the
// self-evolution loop:
//
//   turn N runs -> Detect fires -> reflection writes episode -> later
//   playbook curation (manual or scheduled) absorbs the episode into
//   playbook.md -> turn N+1 reads playbook.md.
//
// v1 keeps this minimal: episode writes are best-effort vault writes,
// no SQLite events table (ADR-002 §11 telemetry lands separately),
// playbook curation is manual. Detect rules cover three primary cases.

import { invoke } from './bridge';
import correctionMarkersCjk from './locale/correction-markers.cjk.json';

// bao 2026-06-05 Pi-first cleanup: `isFrontierNativeProvider` lived in
// irisy-tool-dispatch which the PWA used to branch between XML overlay
// and native function-call. Pi owns tool dispatch now, so the branch
// is moot — every active provider is "frontier-native" from the PWA's
// perspective (Pi handles native tool calling internally regardless
// of which Claude/GPT/local model Pi happens to be routing to). The
// frontmatter tag is kept for episode-log forward compatibility but
// is unconditionally true.

const PLAYBOOK_PATH = 'irisy/playbook.md';
const REFLECT_PROMPT_PATH = 'irisy/reflect-prompt.md';
const EPISODES_DIR = 'irisy/episodes';
/** See the `frontier_native` field comment in writeEpisode for rationale. */
const PI_FIRST_FRONTIER_NATIVE = true;

export type ReflectTrigger =
  | 'user-correction'
  | 'tool-failure'
  | 'tool-success-novel'
  | 'session-end'
  | 'manual';

export interface ReflectTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface DetectInput {
  /** Last N turns (caller decides N; 4-8 is typical). Oldest first. */
  recentTurns: ReflectTurn[];
  /** Whether the last assistant turn ended with a tool error result. */
  lastTurnHadToolError: boolean;
  /** Whether the user's most recent turn contains correction language. */
  lastUserTurnIsCorrection: boolean;
}

/**
 * Decide whether the last exchange warrants writing an episode.
 * Returns the trigger reason, or null to skip.
 *
 * Detect rules (Phase 4 v1):
 *   - `user-correction`: the user's latest turn contains a correction
 *     marker (English or Chinese). Most valuable signal — it's a real
 *     human-labelled "do this differently".
 *   - `tool-failure`: the assistant's last turn ended on a tool error.
 *   - Otherwise null — we don't reflect on every turn.
 */
export function detectReflectTrigger(input: DetectInput): ReflectTrigger | null {
  if (input.lastUserTurnIsCorrection) return 'user-correction';
  if (input.lastTurnHadToolError) return 'tool-failure';
  return null;
}

const CORRECTION_MARKERS_EN = [
  'no,',
  "that's wrong",
  'wrong,',
  "don't",
  'stop',
  'actually',
  'i said',
  'not what i',
];
// CJK correction markers. These language-detection tokens are data, not
// developer prose, so they live in a JSON locale file
// (`locale/correction-markers.cjk.json`) — keeping this .ts source
// all-English per the project rule. `isCorrectionMessage` matches them
// verbatim against real CJK user input to detect corrections (covered by
// irisy-reflection.test.ts fixtures).
const CORRECTION_MARKERS_ZH: string[] = correctionMarkersCjk.markers;

/** Heuristic check on a user message body. Case-insensitive for the
 *  English markers; Chinese markers are compared verbatim. */
export function isCorrectionMessage(content: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase();
  if (CORRECTION_MARKERS_EN.some((m) => lower.includes(m))) return true;
  if (CORRECTION_MARKERS_ZH.some((m) => content.includes(m))) return true;
  return false;
}

interface VaultEntry {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

interface VaultWriteReply {
  absolute_path: string;
  path: string;
}

async function readVaultText(path: string): Promise<string | null> {
  try {
    const entry = await invoke<VaultEntry>('vault_read', { args: { path } });
    return entry.content ?? null;
  } catch {
    return null;
  }
}

/** Load the playbook body. Returns null when the file isn't seeded yet
 *  (fresh install racing with kernel seed). */
export async function loadPlaybook(): Promise<string | null> {
  return readVaultText(PLAYBOOK_PATH);
}

/** Load the reflection-subagent system prompt body. */
async function loadReflectPrompt(): Promise<string | null> {
  const raw = await readVaultText(REFLECT_PROMPT_PATH);
  if (!raw) return null;
  // The seeded file has YAML frontmatter; vault_read returns frontmatter
  // separately, so `content` here is body-only already. Return as-is.
  return raw;
}

function todayDateSlug(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shortSlug(trigger: ReflectTrigger): string {
  const ts = Date.now().toString(36);
  return `${trigger}-${ts}`;
}

export interface ReflectionResult {
  /** Vault path the episode was written to, relative to vault root. */
  episodePath: string;
  /** The trigger that fired this reflection. */
  trigger: ReflectTrigger;
}

/** Drive one reflection round: load prompt + playbook, call the brain
 *  via `irisy_chat_stream`-equivalent path, write episode to vault.
 *  Best-effort — any failure is swallowed (the main chat never blocks
 *  on reflection). Returns null if anything went wrong.
 *
 *  `streamFn` is injected so the caller can pass its existing brain
 *  pipeline. It must yield text chunks and resolve when streaming
 *  finishes. We assemble the full text and use that as the episode
 *  markdown body. */
export async function runReflection(args: {
  trigger: ReflectTrigger;
  recentTurns: ReflectTurn[];
  activeProviderId: string | null;
  streamFn: (systemPrompt: string, userPrompt: string) => Promise<string>;
}): Promise<ReflectionResult | null> {
  try {
    const reflectPrompt = await loadReflectPrompt();
    if (!reflectPrompt) return null;
    const playbook = (await loadPlaybook()) ?? '';

    const transcript = args.recentTurns
      .map((t) => `<${t.role}>\n${t.content}\n</${t.role}>`)
      .join('\n\n');

    const userPrompt = [
      `trigger_reason: ${args.trigger}`,
      `active_provider_id: ${args.activeProviderId ?? 'unknown'}`,
      '',
      '## recent_turns',
      transcript,
      '',
      '## existing_playbook',
      playbook.trim().length > 0 ? playbook : '(empty)',
    ].join('\n');

    const episodeBody = await args.streamFn(reflectPrompt, userPrompt);
    if (!episodeBody || episodeBody.trim().length === 0) return null;

    const episodePath = `${EPISODES_DIR}/${todayDateSlug()}-${shortSlug(args.trigger)}.md`;
    await invoke<VaultWriteReply>('vault_write', {
      args: {
        path: episodePath,
        content: episodeBody.trim(),
        frontmatter: {
          kind: 'irisy-episode',
          trigger: args.trigger,
          provider: args.activeProviderId ?? 'unknown',
          // Pi-first era: every provider routed through Pi gets native
          // tool calling, so this telemetry tag is uniformly true. Kept
          // in frontmatter so older episode files stay queryable on the
          // same key as new ones.
          frontier_native: PI_FIRST_FRONTIER_NATIVE,
          created_at: new Date().toISOString(),
        },
      },
    });
    return { episodePath, trigger: args.trigger };
  } catch {
    // Reflection is best-effort; never propagate.
    return null;
  }
}
