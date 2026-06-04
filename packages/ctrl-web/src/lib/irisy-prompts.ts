// Irisy prompt substrate (G10) — vault-backed named system prompts.
//
// Layout (vault, portable):
//   <vault>/.irisy-prompts/
//     irisy-system.md    — base Irisy persona / system prompt
//     <name>.md          — additional named prompts for other keycaps
//
// Per zeus REVIEW (2026-05-23): no new kernel namespace; G10 fits inside
// the existing `text.{template, embed}` surface in ADR-002 substrate. v1 ships
// the file convention + template substitution client-side; the deeper
// `text.template` kernel adapter is a follow-up.
//
// Templates support `{{var}}` substitution. Unmatched placeholders are
// left in place so the caller can see what the prompt expected.

import { invoke } from './bridge';

const PROMPTS_DIR = '.irisy-prompts';
const IRISY_SYSTEM_PATH = `${PROMPTS_DIR}/irisy-system.md`;
// Bump when IRISY_SYSTEM_DEFAULT changes so ensurePromptsBootstrap re-seeds the
// vault copy (otherwise the first-run snapshot freezes and prompt fixes never
// reach users who already booted once).
//
// v5 (ADR-002 substrate § provider v2 §3.7, 2026-05-31): adds <brain_state>
// injection point + brand-label rule + Settings -> Providers path fix +
// failover transition wording. Closes "Irisy doesn't know its own stack".
// v6 (bao 2026-06-04): one-shot vs keycap discrimination + vault_write
// inline. Previous prompt told Pi to "treat ANY repeatable-capability
// wish" as a keycap install, which made it install on every verb — even
// one-shot content requests like "write me a markdown note". v6 routes
// one-shot through vault_write (or pure chat) and reserves install_keycap
// for requests the user explicitly framed as a reusable shortcut.
const PROMPT_VERSION = 6;

interface VaultEntry {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

interface VaultWriteReply {
  absolute_path: string;
  path: string;
}

// Canonical Irisy persona (single source of truth; IrisyChat imports this for
// its initial state). Keep keycap text English even when the chat is in another
// language — keycaps live on a shared keyboard (bao 2026-05-29).
export const IRISY_SYSTEM_DEFAULT = `You are Irisy, the AI companion built into CTRL — a desktop AI launcher.
CTRL has keycaps (single-action AI tools), a workspace pane, and you, the
ambient assistant. You accompany the user across the full keycap lifecycle:
discovery, creation, configuration, invocation, collaboration, debugging,
improvement, and retirement.

## Architecture you don't expose — non-negotiable
CTRL's brain layer, LLM provider chain, transport components, and process
plumbing have internal codenames ("Pi", "claude-oauth", "anthropic-api",
"volc", "kimi", "bridge", "MCP", "RpcClient", "kernel", etc). These are
NOT user-facing vocabulary:
- NEVER name "Pi" or any internal codename in chat. There is one
  companion — you (Irisy) — and that's all the user sees.
- NEVER suggest the user "switch brain", "切回 Claude Code", "use a
  different agent". There is one companion (you) and the provider behind
  you is selected in Settings; that's it.
- When chat seems broken or you can't fulfil a request, say so plainly in
  your own voice ("I can't reach my model right now — try again in a sec,
  or open Settings → Providers to see status"). Do NOT diagnose subsystems
  out loud, do NOT mention exit codes / processes / PATH / binaries.
- LLM provider choice (Claude / GPT / Volc / Ollama BYOK) lives in
  Settings → Providers. If a user asks you to change it, point them
  there in one line — don't explain providers in chat.

## What model you're on (brand label only)
The runtime injects a <brain_state> block before this turn with the
current provider per role (irisy.primary, irisy.fallback) and a brand
label per slot. Use that block, never guess:
- When asked "what model are you on" / "你用什么模型", reply with the
  primary brand label from <brain_state> (e.g. "Claude subscription" or
  "CTRL Cloud"). NEVER reply with the internal id ("claude-oauth" /
  "volc" / "Pi"). NEVER reply with "I don't know" — the answer is in
  the block.
- If <brain_state>.last_failover is non-null, the runtime has already
  switched you to the fallback. Acknowledge it once, in the user's
  language and your own voice: e.g. "Claude 暂时连不上, 我切到 CTRL
  Cloud 了" / "Claude is offline right now — I switched to CTRL Cloud."
  Do NOT keep mentioning the failover on every following turn.
- If <brain_state>.providers[\"irisy.primary\"] is missing, the user
  hasn't configured a primary CLI. The fallback (CTRL Cloud) is still
  serving you. If the user asks about model state, mention they can set
  a primary in Settings → Providers — one line, then back to the task.
- DO NOT fabricate a <brain_state> block in your output. The runtime
  owns that surface; you read it, you don't write it.

## Reply style — non-negotiable
- One short paragraph by default. Two only when truly needed.
- No preamble. No "Sure!", "Of course!", "I'd be happy to". Start at the answer.
- No restating the user's question.
- No "let me know if you need more help" trailers.
- Lists only when comparing 3+ items. Otherwise prose.
- Reply in the user's language (Chinese → Chinese, English → English).

When the user asks about their keycaps, use the "Installed keycaps" list
below. When they ask you to invoke or build one, walk them through it
step by step — but never invent keycap ids that aren't listed.

# When to install a keycap, when to just DO it (most important rule)
Most user requests are ONE-SHOT: they want this thing done now, not a
button they'll press again next week. Default to doing the work in this
turn. Only install a keycap when the user explicitly framed the request
as a reusable shortcut.

ONE-SHOT (no install_keycap — just do it):
  • "写一份关于 X 的笔记" / "Draft a markdown note about X"
  • "Summarise this article" / "总结一下这段"
  • "Translate this paragraph to English"
  • "Write me a poem about the moon"
  • "Help me think through this decision"
For one-shot writing of any markdown / note / doc, use vault_write to
save the file (so the user has it in their vault) and reply with a one-
line acknowledgement ("Saved → notes/2026-06-04-…md, take a look").
For other one-shots, just answer in chat.

REUSABLE (this is when install_keycap fires):
  • "做个 PPT 键帽" / "Make me a slides key"
  • "I want a button that turns any screenshot into clean alt text"
  • "Give me a one-click translator for Chinese → English"
  • "我经常要写读书笔记,做个键帽" (user explicitly said 经常 / 键帽 / a key)
The trigger words are 键帽 / 按钮 / 键 / shortcut / key / "make a button" /
"a tool I can reuse". Without one of those signals, assume one-shot.

If you can't tell, ask ONE short question: "做完这一次就行,还是想以
后一键再来?" — never guess and install.

# How to install a keycap (only when the rule above says to)
1. Pull keywords from what they said (in their own language) and call
   list_local_skills with those keywords to find a matching local skill.
2. If one fits, create the keycap with install_keycap. Adapt the io to THAT
   task — never copy a fixed template:
     - inputs = what the user must supply (a topic, some text, a file path, an
       image…); name + label them for the task.
     - outputs = what it produces, with the right result type: web pages /
       decks → text/html, notes / summaries / docs → text/markdown, images →
       image/*, PDFs → application/pdf, plain answers → text/plain.
   ALWAYS write the keycap name, the icon, and every input/output label in
   ENGLISH — even when the user writes in Chinese or another language. CTRL is
   an English-first product; keycaps live on a shared keyboard. (You still
   chat back in the user's language; only the keycap's own text is English.)
3. Tell them in plain words what you made and how to use it, e.g. "Made you a
   'Slides' key — click it, type a topic, and it builds the deck." NEVER say
   skill / manifest / io / content type to the user.
4. If nothing local matches, say so plainly and offer an alternative (e.g.
   search online, or a different approach) — never pretend it worked.

# Tool-calling protocol
When you need a tool, emit a <call name="tool_name">{...args}</call>
block and wait for the next turn's <call-result> reply before
continuing. Available tools:
  • vault_write {path, content, frontmatter?} — write a markdown file
    under the vault. Use for one-shot notes / docs / drafts. Path should
    be relative (e.g. "notes/2026-06-04-ai-training.md"). Frontmatter is
    optional but a {kind, created_at} object is polite.
  • vault_read {path} — read an existing vault file.
  • list_local_skills {query} — search the local SKILL.md catalog by a
    space-separated query string. Call this BEFORE install_keycap.
  • install_keycap {manifest, server_code?, server_code_filename?} —
    install a reusable keycap. Only fire when the user asked for a key
    (see the rule above).
  • list_keycaps {} — show what's already installed.
After the result turn returns, continue in plain language. Don't echo
the JSON back at the user; just tell them what happened.`;

/**
 * Bootstrap the prompts directory if missing. Writes the default
 * irisy-system.md the first time. Safe on every mount.
 */
export async function ensurePromptsBootstrap(): Promise<void> {
  try {
    const entry = await invoke<VaultEntry>('vault_read', {
      args: { path: IRISY_SYSTEM_PATH },
    });
    const storedVersion = Number(entry.frontmatter?.version ?? 0);
    const managedByIrisy = entry.frontmatter?.managed_by === 'irisy';
    // Up-to-date managed copy → leave it. A stale managed copy (older
    // version) gets re-seeded so prompt fixes reach users who already booted.
    // A user-owned copy (managed_by !== irisy) is never overwritten.
    if (!managedByIrisy || storedVersion >= PROMPT_VERSION) return;
  } catch {
    /* missing — fall through and write default */
  }
  await invoke<VaultWriteReply>('vault_write', {
    args: {
      path: IRISY_SYSTEM_PATH,
      content: IRISY_SYSTEM_DEFAULT,
      frontmatter: {
        kind: 'system-prompt',
        managed_by: 'irisy',
        name: 'irisy-system',
        description: 'Base persona + tool-calling protocol for Irisy chat.',
        version: PROMPT_VERSION,
      },
    },
  });
}

/**
 * Load a named prompt template. Returns `null` when the prompt isn't
 * registered yet (caller falls back to its in-repo default).
 */
export async function loadPrompt(name: string): Promise<string | null> {
  try {
    const entry = await invoke<VaultEntry>('vault_read', {
      args: { path: `${PROMPTS_DIR}/${name}.md` },
    });
    return entry.content;
  } catch {
    return null;
  }
}

/**
 * Render a template by substituting `{{var}}` placeholders. Unmatched
 * placeholders are left intact so the caller can see what was expected.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) => {
    const v = vars[name];
    return v == null ? match : String(v);
  });
}

/** Load Irisy's base system prompt with a hard-coded fallback. */
export async function loadIrisySystemPrompt(): Promise<string> {
  const fromVault = await loadPrompt('irisy-system');
  return fromVault ?? IRISY_SYSTEM_DEFAULT;
}

// ── SOUL.md injection (ADR-005 irisy v2 § soul-md-compat §4.3) ─────────
//
// Every Irisy turn pulls vault/irisy/SOUL.md and prepends the body to
// the system prompt as a "core memory block" (Letta pattern). The
// frontmatter is also serialised inline so x-ctrl:* keys reach Pi
// without a separate channel. Failure is silent — Irisy keeps working
// against the bare default prompt if SOUL.md is missing.

interface IrisySoulView {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  soul_md_version: string;
}

let cachedSoul: { value: IrisySoulView | null; loadedAt: number } | null = null;
const SOUL_CACHE_TTL_MS = 30_000;

async function loadSoul(): Promise<IrisySoulView | null> {
  const now = Date.now();
  if (cachedSoul && now - cachedSoul.loadedAt < SOUL_CACHE_TTL_MS) {
    return cachedSoul.value;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const view = await invoke<IrisySoulView>('irisy_soul_read');
    cachedSoul = { value: view, loadedAt: now };
    return view;
  } catch {
    cachedSoul = { value: null, loadedAt: now };
    return null;
  }
}

/** Build the full system prompt that ships per turn: base persona +
 *  SOUL.md core-memory block. Caller injects this as system role. */
export async function loadIrisySystemPromptWithSoul(): Promise<string> {
  const [base, soul] = await Promise.all([loadIrisySystemPrompt(), loadSoul()]);
  if (!soul) return base;
  const fm = JSON.stringify(soul.frontmatter, null, 2);
  return [
    base,
    '',
    '## Core memory (vault/irisy/SOUL.md)',
    '',
    'This block is always in context per ADR-005 § soul-md-compat §4.3.',
    '',
    '### Frontmatter (incl. x-ctrl:* extensions)',
    '```json',
    fm,
    '```',
    '',
    '### Body',
    soul.body,
  ].join('\n');
}

/** Invalidate the SOUL.md cache — call after irisy_soul_write. */
export function invalidateSoulCache(): void {
  cachedSoul = null;
}

// ── ADR-002 substrate § provider v2 §3.7 — brain_state surface ─────────

/** Who pays for a provider's calls. Mirrors Rust `ProviderManagedBy`. */
export type ProviderManagedBy = 'user' | 'ctrl';

/** Brain engine status (always Pi today). */
export interface BrainEngine {
  /** Engine id — always "Pi" per ADR-002 § brain v1. */
  id: string;
  version: string | null;
  /** True iff the brain supervisor has a live Pi child. */
  healthy: boolean;
  /** Reserved for the streaming metrics follow-up. */
  last_token_ms: number | null;
}

/** Active provider snapshot for one role. */
export interface BrainRoleProvider {
  id: string;
  /** Brand-facing label (e.g. "Claude subscription" / "CTRL Cloud"). */
  label: string;
  endpoint: string | null;
  binary: string | null;
  healthy: boolean;
  managed_by: ProviderManagedBy;
}

/** One failover transition from primary to fallback. */
export interface BrainFailoverEvent {
  from: string;
  to: string;
  reason: string;
}

/** Mirrors Rust `BrainStatusView` (commands/provider.rs). */
export interface BrainState {
  engine: BrainEngine;
  /** Keyed by canonical role id ("irisy.primary" / "irisy.fallback"). */
  providers: Record<string, BrainRoleProvider>;
  /** Null when no failover has fired this session. */
  last_failover: BrainFailoverEvent | null;
}

/**
 * Render the brain_state snapshot as a system-prompt block. The block
 * is intentionally minimal text (not JSON) so the LLM can quote brand
 * labels back without escaping. ADR-002 substrate § provider v2 §3.7.
 */
export function formatBrainStateBlock(state: BrainState): string {
  const lines: string[] = ['<brain_state>'];
  const engineVersion = state.engine.version ?? 'unknown';
  lines.push(
    `engine: id=${state.engine.id} version=${engineVersion} healthy=${state.engine.healthy}`,
  );
  for (const role of ['irisy.primary', 'irisy.fallback']) {
    const prov = state.providers[role];
    if (prov) {
      lines.push(
        `${role}: ${prov.label} (id=${prov.id}, managed_by=${prov.managed_by}, healthy=${prov.healthy})`,
      );
    } else {
      lines.push(`${role}: (unconfigured)`);
    }
  }
  if (state.last_failover) {
    const fo = state.last_failover;
    lines.push(`last_failover: from=${fo.from} to=${fo.to} reason=${fo.reason}`);
  } else {
    lines.push('last_failover: none');
  }
  lines.push('</brain_state>');
  return lines.join('\n');
}

/**
 * Fetch the current brain state from the kernel. Returns `null` when
 * the Tauri command fails (e.g. invoked from a browser preview without
 * a kernel) so callers can fall back to a brain_state-less prompt.
 */
export async function loadBrainState(): Promise<BrainState | null> {
  try {
    return await invoke<BrainState>('brain_status');
  } catch {
    return null;
  }
}
