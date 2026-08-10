// irisy-turn — the per-turn context a request carries.
//
// This is the one place that decides what a turn is grounded in, and it was
// inline in the composer with no check on it. That mattered more than it looks:
// if the user's explicitly opened Resource does not reach the request, an answer
// from the model's memory is indistinguishable from one read out of the user's
// own file, and nothing on screen would reveal the difference.
//
// Extracted so the grounding and least-privilege properties are asserted
// directly, without needing the desktop streaming transport.
// (ADR-002 substrate §15.4 v84; ADR-005 irisy §11 v40, §12 v42 U1)

import { mergeFctResources, type FctSelectionProjection } from './fct';
import type { IrisyTurnContext } from './llm-transport';

/** Scope every turn holds: the three canonical verbs and nothing else. An FCT
 *  selection may add exact grants on top; it never replaces this floor.
 *  (ADR-002 substrate §15.4 v84) */
export const BASE_TURN_SCOPE = ['tool:describe', 'tool:query', 'tool:produce'];

/** The projection used when the session is on Auto: no FCT dependencies and no
 *  widened scope. */
export function autoProjection(): FctSelectionProjection {
  return {
    ref: '',
    resources: [],
    capability_scope: [...BASE_TURN_SCOPE],
    policy: 'review-gated-writes',
    install_state: 'available',
    install_ref: '',
  };
}

export interface TurnContextInput {
  sessionId: string;
  /** Resources the user explicitly has open. These always survive. */
  workResources: readonly string[];
  /** Live FCT projection for this turn. */
  projection: FctSelectionProjection;
  /** The user's request, verbatim. */
  task: string;
}

/** Assemble the turn context. The user's Work Resources come first and are never
 *  dropped or replaced by an FCT's dependencies. */
export function buildTurnContext(input: TurnContextInput): IrisyTurnContext & {
  policy: string;
  task: string;
} {
  return {
    session_id: input.sessionId,
    resources: mergeFctResources([...input.workResources], input.projection.resources),
    skill_id: input.projection.skill_id,
    capability_scope: input.projection.capability_scope,
    policy: input.projection.policy,
    task: input.task,
  };
}
