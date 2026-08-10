// fct-capture — turn a verified outcome into a reusable FCT.
//
// The reuse offer is derived STRICTLY from the owner's Outcome: the Resource that
// was actually changed and the kernel's own verification. It deliberately does
// not record a transcript, a step list, prompt parameters, or a trigger — that
// would be a workflow definition, which is outside CTRL's product boundary, and
// it would also be a fiction, because the same phrasing does not reproduce the
// same steps on the next turn.
//
// What a captured FCT therefore is: a named selection that brings this Resource
// back into a future session. That is reproducible, and it is exactly what the
// catalogue can project.
// (ADR-002 substrate §15.4 v84; §15.5 v86; ADR-005 irisy §12 v42 U23)

import { installPack } from './feature-pack';
import type { DecisionFact } from './decision-registry';

export interface CapturedOutcome {
  /** The canonical ref that was changed. */
  resource: string;
  /** Owner-meaningful target, e.g. the note name. */
  target?: string;
  /** The kernel's own post-commit verification. Required: an unverified outcome
   *  is not offered for reuse. */
  verifiedBy: string;
}

/** Derive the FCT name from the target rather than asking the user to invent one
 *  at the moment they just wanted to save. */
export function capturedFctName(outcome: CapturedOutcome): string {
  const base = outcome.target ?? outcome.resource;
  // Strip a trailing extension so "Budget.md" reads as "Budget" on a shelf.
  return base.replace(/\.[a-z0-9]+$/i, '') || 'Saved work';
}

/** Stable pack id derived from the name. */
export function capturedFctId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `fct-${slug || 'saved-work'}`;
}

/** The manifest an outcome projects. One Resource dependency, no actions, no
 *  commands, no secrets: this pack exists to be SELECTED, not to execute. */
export function outcomeToFctManifest(
  outcome: CapturedOutcome,
): Record<string, unknown> {
  const name = capturedFctName(outcome);
  return {
    manifest_version: 2,
    id: capturedFctId(name),
    name,
    version: '1.0.0',
    author: { name: 'You (saved from a verified change)' },
    description: {
      short: `Brings ${name} back into a session. Saved after CTRL verified a change to it.`,
    },
    icon: '✦',
    mcp_color: 'graphite',
    variant: 'builtin',
    // The dependency that makes this selectable. The catalogue projects a pack
    // with a Resource without needing any server or Skill.
    resources: [outcome.resource],
    actions: [],
  };
}

/** Install the derived FCT. Returns the name it was saved under. */
export async function saveOutcomeAsFct(outcome: CapturedOutcome): Promise<string> {
  if (!outcome.verifiedBy) {
    // Refuse rather than save something CTRL never confirmed happened.
    throw new Error('only a verified change can be saved for reuse');
  }
  const manifest = outcomeToFctManifest(outcome);
  await installPack(manifest);
  return manifest['name'] as string;
}

export const CAPTURE_SAVE_OPTION = 'capture:save';
export const CAPTURE_DISMISS_OPTION = 'capture:dismiss';

/** The `capture` decision offering reuse. Dismiss is the safe default: the user
 *  just finished a change and must not be pushed into a second commitment. */
export function outcomeCaptureFact(outcome: CapturedOutcome): DecisionFact {
  const name = capturedFctName(outcome);
  return {
    id: `capture:${outcome.resource}`,
    kind: 'capture',
    subject: `Save ${name} as an FCT so you can bring it back later?`,
    target: outcome.target ?? outcome.resource,
    facts: [
      { label: 'Brings back', value: outcome.resource },
      // What it does NOT do, stated plainly, so nobody expects a replay.
      { label: 'Does not replay', value: 'the steps you just took' },
      { label: 'Verified by', value: outcome.verifiedBy },
    ],
    options: [
      { id: CAPTURE_DISMISS_OPTION, label: 'Not now', consequence: 'discards' },
      { id: CAPTURE_SAVE_OPTION, label: 'Save as FCT', consequence: 'commits', primary: true },
    ],
    intent: 'U23',
  };
}
