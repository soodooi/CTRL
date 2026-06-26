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
import { CODE_COMPANION_SYSTEM_PROMPT } from '@/personas/irisy/code-companion';
import { IRISY_MCP_CREATOR_PROMPT } from '@/personas/irisy/mcp-creator';

/** L1 scenes that can auto-link a role (ADR-003 §8.6 lock 5). */
export type SceneKind = 'notes' | 'tables' | 'coding';

/** Initial role set (bao 2026-06-25). v1 does NOT ship user-created roles —
 *  the registry shape below is the reserved interface for that follow-up. */
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
  toolset: [],
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
