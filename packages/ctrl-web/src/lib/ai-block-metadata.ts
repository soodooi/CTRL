// AI block metadata — frontmatter persistence for accepted Irisy ops.
//
// (ADR-002 substrate v5 §10 + product spec §6.4 / §8.7 transparency,
// 2026-06-03 — brainstorm `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md`.)
//
// Every time the user accepts a block AI op, the host note's
// frontmatter `ai_blocks:` array gets a new entry. Format mirrors the
// brainstorm §6.4 shape so future drill-down popups can read it
// directly. Failures here are non-blocking (a stamp miss is a
// transparency gap, not a content loss).

import { vaultRead, vaultWrite } from './kernel';
import type { BlockActionId } from './block-ai-ops';

export interface AiBlockEntry {
  id: string;
  ts: string;
  action: BlockActionId;
  provider: string;
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  original_text: string;
  rewritten_text: string;
  accepted_at: string;
  user_input?: string;
}

export interface StampArgs {
  path: string;
  action: BlockActionId;
  original: string;
  rewritten: string;
  user_input?: string;
  /** Best-known provider id at acceptance time. Empty string when the
   *  caller has not resolved it yet (still useful as a placeholder). */
  provider?: string;
  /** Best-known model id. Same caveat as provider. */
  model?: string;
}

function nextId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `blk_${ts}_${rand}`;
}

/** Append one ai_blocks entry to the host note's frontmatter. Read +
 *  append + write — single best-effort cycle. */
export async function stampAiBlock(args: StampArgs): Promise<void> {
  try {
    const entry = await vaultRead(args.path);
    const fm = (entry.frontmatter ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(fm.ai_blocks)
      ? (fm.ai_blocks as AiBlockEntry[])
      : [];
    const nextEntry: AiBlockEntry = {
      id: nextId(),
      ts: new Date().toISOString(),
      action: args.action,
      provider: args.provider ?? '',
      model: args.model ?? '',
      original_text: args.original,
      rewritten_text: args.rewritten,
      accepted_at: new Date().toISOString(),
      ...(args.user_input ? { user_input: args.user_input } : {}),
    };
    const updated = [...existing, nextEntry];
    await vaultWrite({
      path: args.path,
      content: entry.body,
      frontmatter: { ...fm, ai_blocks: updated },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('stampAiBlock failed', err);
  }
}

/** Pull the ai_blocks array from a path's current frontmatter. Returns
 *  empty array when missing / malformed. Caller uses this to render the
 *  drill-down popup / FrontmatterPanel badge. */
export async function readAiBlocks(path: string): Promise<AiBlockEntry[]> {
  try {
    const entry = await vaultRead(path);
    const fm = (entry.frontmatter ?? {}) as Record<string, unknown>;
    const list = fm.ai_blocks;
    if (!Array.isArray(list)) return [];
    return list as AiBlockEntry[];
  } catch {
    return [];
  }
}
