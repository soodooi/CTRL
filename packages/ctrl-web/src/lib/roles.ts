// Irisy functional roles (ADR-003 frontend §8.6 + ADR-005 irisy v6).
//
// bao 2026-06-25: each function = a role (persona) + a feature pack, FLEXIBLY
// configured — not welded. The persona pool and the feature-pack pool are
// decoupled; a role just COMPOSES one persona with a toolset and a knowledge
// base. Swapping a persona or adding a pack is config here, not new code.
//
// A role has three configurable dimensions:
//   1. persona     — which voice/system-prompt Irisy speaks with
//   2. toolset     — which feature packs are in scope (ids; [] = none extra)
//   3. kbScope     — which knowledge base (vault subpath; null = whole vault)
//
// Same persona + different (toolset, kbScope) = a different role. e.g. a future
// "Stocks" role = the KB persona + a stocks pack + a stocks vault. That is the
// point of flexible config: data is a role axis too, not only persona+toolset.
//
// Design SSOT: vault/ctrl/irisy-roles.md. Single brand voice stays (Irisy is
// always Irisy, ADR-005 single-brand lock) — switching a role is NOT switching
// personality; the conversation persists across switches.

import { IRISY_SYSTEM_DEFAULT } from './irisy-prompts';
import { CODE_COMPANION_SYSTEM_PROMPT } from '../personas/irisy/code-companion';
import { IRISY_MCP_CREATOR_PROMPT } from '../personas/irisy/mcp-creator';

/** L1 scenes that can auto-link a role (ADR-003 §8.6 lock 5). */
export type SceneKind = 'notes' | 'tables' | 'coding';

/** Initial role set = the PERSONA layer ONLY (bao 2026-06-25: a role IS a
 *  persona, NOT a persona+pack+kb bundle — don't weld). A dedicated knowledge
 *  base + feature packs are orthogonal config the assistant role composes per
 *  task (e.g. stocks = kb-assistant + a Stocks/ KB + the ghostfolio pack), NOT
 *  a new role. v1 ships no user-created roles; the registry shape is reserved. */
export type RoleId = 'kb-assistant' | 'code-companion' | 'tool-maker';

export interface Role {
  id: RoleId;
  /** Shown in the switcher above the chat box. English (ADR-006 §2). */
  label: string;
  /** One-line description shown in the dropdown. */
  hint: string;
  /** The persona = this role's base system prompt. */
  persona: string;
  /** Feature-pack ids in scope ([] = no extra packs in v1). */
  toolset: string[];
  /** Knowledge-base scope = vault subpath; null = whole vault. */
  kbScope: string | null;
}

export const DEFAULT_ROLE_ID: RoleId = 'kb-assistant';

// The flat role pool. persona ⊥ toolset ⊥ kbScope — each row just composes
// existing personas with a toolset and a KB. kb-assistant.persona mirrors the
// canonical default; AmbientHome lets the default role keep its vault override
// (so a user-edited irisy-system.md still wins for it) and uses role.persona
// verbatim for the others.
const KB_ASSISTANT: Role = {
  id: 'kb-assistant',
  label: 'Knowledge Base',
  hint: 'Your personal KB assistant',
  persona: IRISY_SYSTEM_DEFAULT,
  toolset: [],
  kbScope: null,
};
const CODE_COMPANION: Role = {
  id: 'code-companion',
  label: 'Code Companion',
  hint: 'Pairs with the Coding terminal',
  persona: CODE_COMPANION_SYSTEM_PROMPT,
  // Dev-focused pack ids this role whitelists, so the coding session stays
  // uncluttered. Convention-only ids: a pack with one of these ids (from the
  // registry or Irisy's create flow) is in scope; ones the user hasn't
  // installed simply don't appear. Not a dev-hardcoded catalog.
  toolset: ['dev-box', 'git-box', 'cf-workers', 'disk-box'],
  kbScope: null,
};
const TOOL_MAKER: Role = {
  id: 'tool-maker',
  label: 'Tool Maker',
  hint: 'Build a CTRL mcp from a description',
  persona: IRISY_MCP_CREATOR_PROMPT,
  toolset: [],
  kbScope: null,
};
// Stocks is NOT a role (bao 2026-06-25: the assistant role is enough). It's the
// kb-assistant persona + a dedicated Stocks/ knowledge base + the ghostfolio
// pack — orthogonal config, not a new persona. The pool stays at 3 persona roles.
export const ROLES: Role[] = [KB_ASSISTANT, CODE_COMPANION, TOOL_MAKER];

/** Look up a role; falls back to the default so callers never get null. */
export function roleById(id: RoleId): Role {
  return ROLES.find((r) => r.id === id) ?? KB_ASSISTANT;
}

/** L1 ↔ role linkage (bao 2026-06-25: linked + manually switchable). Returns
 *  the role an L1 scene auto-selects, or null when the scene carries no role
 *  (the switcher then keeps whatever the user has). Notes/Tables are both KB
 *  data, so both link the KB assistant; Coding links the code companion. */
export function roleForScene(scene: SceneKind | null): RoleId | null {
  switch (scene) {
    case 'notes':
    case 'tables':
      return 'kb-assistant';
    case 'coding':
      return 'code-companion';
    default:
      return null;
  }
}

/** The role that owns a feature pack = the role whose toolset whitelists it.
 *  When an L1 opens a specific pack, Irisy switches to the role that can
 *  actually use it (bao 2026-06-25). Falls back to the default role, which is
 *  unconstrained (empty toolset = sees every pack). */
export function roleForPack(packId: string): RoleId {
  const owner = ROLES.find((r) => r.toolset.includes(packId));
  return owner ? owner.id : DEFAULT_ROLE_ID;
}

/** The feature packs this role exposes, filtered from what's installed.
 *  An empty toolset means the role is unconstrained (sees ALL installed packs);
 *  a non-empty toolset is a whitelist of pack ids. Generic over the pack shape
 *  so both the Sidebar (FeaturePack) and the prompt (McpSummary) can use it. */
export function packsForRole<T extends { id: string }>(
  role: Role,
  installed: readonly T[],
): T[] {
  if (role.toolset.length === 0) return [...installed];
  const allow = new Set(role.toolset);
  return installed.filter((p) => allow.has(p.id));
}

/** A system-context line pinning Irisy to a dedicated knowledge base, or null
 *  for the whole vault. The scope comes from whatever is active — a feature
 *  pack's dedicated kb (bao 2026-06-25: stocks = assistant + Stocks/ + ghostfolio)
 *  or a role's kbScope — so this takes the scope string, not a role. */
export function kbScopeAmbient(kbScope: string | null): string | null {
  if (!kbScope) return null;
  return (
    `Knowledge base scope: work within "${kbScope}" in the vault. ` +
    `Read, search and cite notes under that path; treat it as the active knowledge base.`
  );
}

/** Whether a vault path falls inside a dedicated knowledge base. A null scope
 *  spans the whole vault (always true); otherwise the path must sit at or under
 *  the prefix. This is what makes a knowledge base RELATIVELY INDEPENDENT (bao
 *  2026-06-25) — out-of-scope search results are dropped, so a pack's data view
 *  (e.g. ghostfolio's Stocks/) only ever sees its own data. Scope-string param
 *  (from the active pack or role), not a role. */
export function inKbScope(kbScope: string | null, path: string): boolean {
  if (!kbScope) return true;
  const prefix = kbScope.endsWith('/') ? kbScope : `${kbScope}/`;
  return path === kbScope || path.startsWith(prefix);
}
