// decision-registry — the shell's second rendering registry.
//
// Content renders by ResourceDescriptor content type through the viewer
// registry. Decisions render by KIND through this one. Before this module every
// decision point was hand-built or degraded: the review gate showed internal
// tool + arg summary instead of a target and staged change, typed
// `ResourceError::Unavailable { reason, retryable }` was flattened into a
// transient string, and precondition/operation state had no surface at all.
//
// Option B scope (bao 2026-08-05): kernel-side typed facts stay the authority
// and no cross-boundary schema is added. This module owns only the kind set,
// the fact envelope those kernel facts adapt into, and the kind -> renderer
// lookup. (ADR-003 frontend § decision-registry v43)

/** Closed kind set. Adding a kind requires an ADR-003 amendment.
 *  (ADR-003 frontend § decision-registry v43) */
export const DECISION_KINDS = [
  'approval',
  'unavailable',
  'conflict',
  'progress',
  'choice',
  'capture',
] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];

/** How selecting an option changes the world. Stated so a decision surface
 *  never asks the user to choose blind. */
export type DecisionConsequence = 'commits' | 'discards' | 'retries' | 'navigates' | 'none';

export interface DecisionOption {
  id: string;
  label: string;
  consequence: DecisionConsequence;
  /** Exactly one option may be primary; a mutation's primary option is the
   *  one that commits. */
  primary?: boolean;
  /** Renders with the danger affordance. */
  destructive?: boolean;
}

/** The staged change for a proposed mutation. Supplied by the kernel fact; a
 *  decision surface never derives or guesses it. */
export interface DecisionStagedChange {
  before: string;
  after: string;
}

/** What the fact depends on remaining true at execution time (revision, hash,
 *  range identity). Surfaced so a later conflict is explainable. */
export interface DecisionPrecondition {
  label: string;
  value: string;
}

export interface DecisionProvenance {
  label: string;
  value: string;
}

/** Kernel-supplied facts shown WITHOUT a disclosure. Anything the user needs in
 *  order to decide belongs here; `provenance` is for drill-down only. On the
 *  approval kind this is what keeps the gate-derived operation and argument
 *  summary on screen at the moment of decision. */
export type DecisionKeyFact = DecisionProvenance;

/** One pending decision, adapted from a kernel-typed fact.
 *  (ADR-003 frontend § decision-registry v43) */
export interface DecisionFact {
  id: string;
  kind: DecisionKind;
  /** What this decision is about, in the user's terms — never a tool name. */
  subject: string;
  /** The concrete object acted on: document, range, ref, connector, operation. */
  target?: string;
  /** Present when a mutation is proposed. */
  staged?: DecisionStagedChange;
  preconditions?: DecisionPrecondition[];
  /** Always visible; required to make the choice. */
  facts?: DecisionKeyFact[];
  /** Drill-down only; never the sole carrier of a decision-critical fact. */
  provenance?: DecisionProvenance[];
  /** Kernel-reported retryability. Never inferred from an error string. */
  retryable?: boolean;
  /** Bounded progress for `progress`; 0..1 when known, omitted when unknown. */
  ratio?: number;
  options: DecisionOption[];
  /** The ADR-005 §12 intent this decision serves, for conformance tracing. */
  intent: string;
}

export type DecisionResolver = (optionId: string) => void;

/** Presentation contract a kind's renderer receives. Frontend-owned. */
export interface DecisionPresentation {
  /** Heading shown to the user. */
  title: string;
  /** Whether the kind blocks the flow (modal) or reports in place (inline). */
  placement: 'modal' | 'inline';
  /** Accent used by the surface; semantic, never per-feature. */
  tone: 'neutral' | 'caution' | 'positive' | 'danger';
  /** Whether the staged before/after block is shown when present. */
  showsStagedChange: boolean;
  /** Whether preconditions are shown when present. */
  showsPreconditions: boolean;
}

const REGISTRY: Record<DecisionKind, DecisionPresentation> = {
  approval: {
    title: 'Review change',
    placement: 'modal',
    tone: 'caution',
    showsStagedChange: true,
    showsPreconditions: true,
  },
  unavailable: {
    title: 'Not available',
    placement: 'inline',
    tone: 'caution',
    showsStagedChange: false,
    showsPreconditions: false,
  },
  conflict: {
    title: 'Target changed',
    placement: 'inline',
    tone: 'danger',
    showsStagedChange: true,
    showsPreconditions: true,
  },
  progress: {
    title: 'Working',
    placement: 'inline',
    tone: 'neutral',
    showsStagedChange: false,
    showsPreconditions: false,
  },
  choice: {
    title: 'Choose',
    placement: 'inline',
    tone: 'neutral',
    showsStagedChange: false,
    showsPreconditions: false,
  },
  capture: {
    title: 'Reuse this?',
    placement: 'inline',
    tone: 'positive',
    showsStagedChange: false,
    showsPreconditions: false,
  },
};

export function isDecisionKind(value: string): value is DecisionKind {
  return (DECISION_KINDS as readonly string[]).includes(value);
}

/** Resolve a kind's presentation. A kind absent from the registry is a
 *  programming error, never a silently rendered string. */
export function decisionPresentation(kind: DecisionKind): DecisionPresentation {
  const presentation = REGISTRY[kind];
  if (!presentation) {
    throw new Error(`No decision renderer registered for kind "${kind}"`);
  }
  return presentation;
}

/** The option a surface should default to. Never a committing option, so a
 *  stray Enter cannot approve a mutation. */
export function safeDefaultOption(fact: DecisionFact): DecisionOption | undefined {
  return (
    fact.options.find((option) => option.consequence === 'discards') ??
    fact.options.find((option) => !option.primary) ??
    fact.options[0]
  );
}

// ── Adapters from kernel-typed facts ────────────────────────────────────────
// Each adapter maps one existing kernel fact into the envelope. The kernel
// remains the authority; these add no new schema. (ADR-003 § decision-registry v43)

/** The gate-derived review request already delivered as `review:pending`.
 *  `tool`/`arg_summary` stay kernel-built; they are shown as provenance
 *  drill-down rather than as the decision itself. */
export interface KernelReviewRequest {
  id: string;
  caller: string;
  tool: string;
  arg_summary: string;
  /** Staged Outcome facts, present only when the addressed owner staged the
   *  change. Absent means the operation produced no preview — the surface says
   *  so rather than implying it reviewed something.
   *  (ADR-002 substrate §15.5.3 v86; §15.2 v87) */
  outcome?: KernelReviewOutcome;
}

/** Mirrors the kernel's `ReviewOutcomeFacts`. No second schema is invented here;
 *  these are exactly the fields the owner's staged Outcome projects. */
export interface KernelReviewOutcome {
  resource: string;
  target?: string;
  before: string;
  after: string;
  preconditions?: { label: string; value: string }[];
}

export function approvalFact(request: KernelReviewRequest): DecisionFact {
  const outcome = request.outcome;
  const staged = outcome ? { before: outcome.before, after: outcome.after } : undefined;
  const preconditions: DecisionPrecondition[] = outcome?.preconditions
    ? outcome.preconditions.map((row) => ({ label: row.label, value: row.value }))
    : [];
  // The gate-derived operation and argument summary stay VISIBLE. They are the
  // only injection-resistant facts the current kernel request carries, so
  // demoting them behind a disclosure would leave the user deciding on a
  // frontend-authored sentence. Richer target/staged facts require a fact-owner
  // amendment; until then this surface must not imply it has them.
  // (ADR-003 frontend § decision-registry v43; ADR-005 §12 U10)
  const facts: DecisionKeyFact[] = [
    { label: 'Requested by', value: request.caller },
    { label: 'Operation', value: request.tool },
    { label: 'Arguments', value: request.arg_summary },
  ];
  if (!outcome) {
    // Say it plainly. An operation that staged nothing gives the user no preview,
    // and pretending otherwise is worse than admitting it.
    facts.push({
      label: 'Preview',
      value: 'none — this operation did not stage a change',
    });
  }
  return {
    id: request.id,
    kind: 'approval',
    subject: outcome
      ? `${request.caller} is asking to change ${outcome.target ?? outcome.resource}.`
      : `${request.caller} is asking to run a high-impact action.`,
    target: outcome?.target ?? outcome?.resource,
    staged,
    preconditions,
    facts,
    options: [
      { id: 'deny', label: 'Deny', consequence: 'discards' },
      {
        id: 'approve',
        label: 'Approve',
        consequence: 'commits',
        primary: true,
        // High blast radius from an external caller keeps the danger affordance.
        destructive: true,
      },
    ],
    intent: 'U10',
  };
}

/** Typed `ResourceError::Unavailable { reason, retryable }` and equivalents. */
export interface KernelUnavailable {
  id: string;
  subject: string;
  reason: string;
  retryable: boolean;
  target?: string;
  /** When the recovery is an explicit connect/enable action. */
  recoveryLabel?: string;
  /** False when the surface has nothing to fall back to, so dismissing would
   *  leave the user staring at an empty pane. Offering a control that resolves
   *  to nothing is worse than offering none. Defaults to dismissible. */
  dismissible?: boolean;
}

export function unavailableFact(error: KernelUnavailable): DecisionFact {
  const options: DecisionOption[] =
    error.dismissible === false
      ? []
      : [{ id: 'dismiss', label: 'Dismiss', consequence: 'discards' }];
  if (error.recoveryLabel) {
    options.push({
      id: 'recover',
      label: error.recoveryLabel,
      consequence: 'navigates',
      primary: true,
    });
  } else if (error.retryable) {
    options.push({ id: 'retry', label: 'Try again', consequence: 'retries', primary: true });
  }
  return {
    id: error.id,
    kind: 'unavailable',
    subject: error.subject,
    target: error.target,
    // The subject already states the outcome; the raw reason is drill-down.
    provenance: [{ label: 'Reason', value: error.reason }],
    retryable: error.retryable,
    options,
    intent: error.recoveryLabel ? 'U19' : 'U12',
  };
}

/** A precondition that no longer holds: revision/hash/range moved under us. */
export interface KernelConflict {
  id: string;
  subject: string;
  target?: string;
  expected: string;
  current: string;
}

export function conflictFact(conflict: KernelConflict): DecisionFact {
  return {
    id: conflict.id,
    kind: 'conflict',
    subject: conflict.subject,
    target: conflict.target,
    staged: { before: conflict.expected, after: conflict.current },
    preconditions: [
      { label: 'Expected', value: conflict.expected },
      { label: 'Current', value: conflict.current },
    ],
    retryable: true,
    options: [
      { id: 'dismiss', label: 'Dismiss', consequence: 'discards' },
      { id: 'review', label: 'Review current state', consequence: 'retries', primary: true },
    ],
    intent: 'U12',
  };
}
