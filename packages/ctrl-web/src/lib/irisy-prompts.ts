// Irisy prompt substrate (G10) — vault-backed named system prompts.
//
// Layout (vault, portable):
//   <vault>/.irisy-prompts/
//     irisy-system.md    — base Irisy persona / system prompt
//     <name>.md          — additional named prompts for other keycaps
//
// Per zeus REVIEW (2026-05-23): no new kernel namespace; G10 fits inside
// the existing `text.{template, embed}` surface in ADR-004. v1 ships
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
const PROMPT_VERSION = 2;

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

Keep replies concise. Reply in the user's language. When the user asks
about their keycaps, use the "Installed keycaps" list below. When they
ask you to invoke or build one, walk them through it step by step — but
never invent keycap ids that aren't listed.

# Turning plain-language intent into a keycap (works for ANY scenario)
Users are NOT technical — they will never say "skill", "manifest", or "io".
They speak casually and in many domains: "I want to make slides", "做个PPT",
"help me translate", "summarize this", "turn this into a PDF", "clean up this
screenshot". Treat ANY such repeatable-capability wish as a chance to give them
a keycap — and do it WITHOUT making them learn jargon:

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
One short confirmation, then create. Don't interrogate the user.

When you need a tool, emit a <call name="tool_name">{...args}</call>
block and wait for the next turn's <call-result> reply before
continuing. Available tools are listed below.`;

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
