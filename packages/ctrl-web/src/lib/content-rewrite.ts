// content-rewrite — rewrite, summarize, or translate the open content.
//
// The previous preview was component-local: it rendered a before/after inside one
// editor component, approved itself, and wrote through a private path. So the
// most consequential moment in the product — a model proposing to replace the
// user's words — had no typed staged change, no decision surface, and no
// verified commit.
//
// This routes the whole thing onto paths that already exist: one non-streaming
// governed `llm_chat` for the proposal, the decision registry's `approval` kind
// for the choice, and the canonical `produce` write for the commit. It adds no
// new transport, and it never writes without the user saying so.
// (ADR-002 substrate §15.2 v87; ADR-003 frontend § decision-registry v43;
// ADR-005 irisy §12 v42 U2)

import { gateInvoke } from './kernel';
import type { DecisionFact } from './decision-registry';

export const REWRITE_KINDS = ['rewrite', 'summarize', 'translate'] as const;
export type RewriteKind = (typeof REWRITE_KINDS)[number];

export const REWRITE_APPLY_OPTION = 'rewrite:apply';
export const REWRITE_DISCARD_OPTION = 'rewrite:discard';

const LABELS: Record<RewriteKind, string> = {
  rewrite: 'Rewrite',
  summarize: 'Summarize',
  translate: 'Translate',
};

export function rewriteLabel(kind: RewriteKind): string {
  return LABELS[kind];
}

/** The instruction sent for each kind. Kept here, not in a component, so the
 *  request is reviewable and identical wherever it is invoked. */
export function rewriteInstruction(kind: RewriteKind, content: string): string {
  const rule =
    'Return ONLY the resulting Markdown document body. No preamble, no code fence, no commentary.';
  switch (kind) {
    case 'summarize':
      return `Summarize the following Markdown document, preserving its heading structure. ${rule}\n\n${content}`;
    case 'translate':
      return `Translate the following Markdown document into English, preserving its Markdown structure exactly. ${rule}\n\n${content}`;
    case 'rewrite':
    default:
      return `Rewrite the following Markdown document to be clearer and more concise, preserving every fact and its heading structure. ${rule}\n\n${content}`;
  }
}

interface LlmChatReply {
  content?: unknown;
  text?: unknown;
}

/** Strip a fence the model added despite being told not to. Tolerating this is
 *  not the same as trusting it: the result is still shown before it is written. */
export function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  return (fenced ? fenced[1] ?? '' : trimmed).trim();
}

/** Keep the original's trailing-newline convention. Silently dropping a file's
 *  final newline is a real change to the file: it shows up in every later diff
 *  and in `git`'s "no newline at end of file". */
export function matchTrailingNewline(proposal: string, original: string): string {
  const body = proposal.replace(/\n+$/, '');
  return /\n$/.test(original) ? `${body}\n` : body;
}

/** Ask for a proposal. Returns the proposed content; never writes anything. */
export async function proposeRewrite(
  kind: RewriteKind,
  content: string,
): Promise<string> {
  const reply = await gateInvoke<LlmChatReply | string>('llm_chat', {
    messages: [{ role: 'user', content: rewriteInstruction(kind, content) }],
  });
  const raw =
    typeof reply === 'string'
      ? reply
      : typeof reply.content === 'string'
        ? reply.content
        : typeof reply.text === 'string'
          ? reply.text
          : '';
  const proposal = matchTrailingNewline(unfence(raw), content);
  if (proposal.trim().length === 0) {
    // An empty proposal must not be offered as a change; approving it would
    // silently empty the user's document.
    throw new Error('the model returned no replacement text');
  }
  if (proposal.trim() === content.trim()) {
    throw new Error('the model returned the document unchanged');
  }
  return proposal;
}

/** Bounded preview of one side of the change. */
export function previewOf(text: string, limit = 600): string {
  const trimmed = text.trim();
  return trimmed.length > limit
    ? `${trimmed.slice(0, limit)}… (${trimmed.length} characters)`
    : trimmed;
}

export interface RewriteProposal {
  kind: RewriteKind;
  /** The Resource the change would be written to. */
  resource: string;
  /** Owner-meaningful target, e.g. the document name. */
  target?: string;
  /** The revision the proposal was made against. */
  revision?: string;
  before: string;
  after: string;
}

/** The approval decision for a proposed rewrite. The staged before/after are the
 *  real document text, and discarding is the safe default: a model proposal is
 *  never applied by a stray Enter. */
export function rewriteApprovalFact(proposal: RewriteProposal): DecisionFact {
  return {
    id: `rewrite:${proposal.resource}`,
    kind: 'approval',
    subject: `${rewriteLabel(proposal.kind)} ${proposal.target ?? proposal.resource}?`,
    target: proposal.target ?? proposal.resource,
    staged: {
      before: previewOf(proposal.before),
      after: previewOf(proposal.after),
    },
    preconditions: proposal.revision
      ? [{ label: 'Revision', value: proposal.revision }]
      : [],
    facts: [
      { label: 'Proposed by', value: 'your model, from the text below' },
      { label: 'Replaces', value: 'the whole document' },
    ],
    options: [
      { id: REWRITE_DISCARD_OPTION, label: 'Discard', consequence: 'discards' },
      {
        id: REWRITE_APPLY_OPTION,
        label: 'Apply',
        consequence: 'commits',
        primary: true,
        destructive: true,
      },
    ],
    intent: 'U2',
  };
}
