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

interface VaultEntry {
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
}

interface VaultWriteReply {
  absolute_path: string;
  path: string;
}

const IRISY_SYSTEM_DEFAULT = `You are Irisy, the AI co-pilot built into CTRL — a desktop AI launcher.
CTRL has keycaps (single-action AI tools), a workspace pane, and you, the
chat co-pilot that ties them together.

Style:
- Concise. The user reads slowly; keep responses tight.
- Markdown welcome (headers, lists, code) — the chat renders it.
- Surface relevant keycaps when the user's intent matches one.
- Cite the user's vault notes by path when relevant.

When you need a tool, emit a <call name="tool_name">{...args}</call>
block and wait for the next turn's <call-result> reply before
continuing. Available tools are listed below.`;

/**
 * Bootstrap the prompts directory if missing. Writes the default
 * irisy-system.md the first time. Safe on every mount.
 */
export async function ensurePromptsBootstrap(): Promise<void> {
  try {
    await invoke<VaultEntry>('vault_read', { args: { path: IRISY_SYSTEM_PATH } });
    return;
  } catch {
    /* fall through and write default */
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
        version: 1,
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

/** Load Irisy's base system prompt with a hard-coded fallback. Treats
 *  an empty or whitespace-only vault file as "missing" so the persona
 *  always lands (mock environments often return empty content). */
export async function loadIrisySystemPrompt(): Promise<string> {
  const fromVault = await loadPrompt('irisy-system');
  if (fromVault && fromVault.trim().length > 0) return fromVault;
  return IRISY_SYSTEM_DEFAULT;
}
