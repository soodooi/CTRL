// note-write — the frontend half of the bounded Markdown note write contract.
//
// Before this module the Notes editor saved through `vault_write`, a private
// Tauri command: no revision recheck, no recovery point, no post-write reread,
// and no way for the user to learn that a save silently overwrote a change made
// elsewhere. The kernel already implements all of that behind
// `produce(replace_content)`; this routes the editor onto that governed path so
// the user's save and an agent's proposed save are the SAME operation, differing
// only in whether the ReviewGate stops to ask.
//
// The interpretation below is deliberately total: a typed Outcome is either a
// verified effect, a precondition conflict, or a named failure. It never
// degrades a typed Feedback into a display string, and it never reports success
// from the absence of an error. (ADR-002 substrate §15.2 v87; §15.5 v86)

import { gateInvoke, produceResource } from './kernel';

/** Mirrors the kernel `Feedback`. `details` carries the conflict operands. */
export interface OutcomeFeedback {
  code: string;
  message: string;
  severity?: string;
  field?: string | null;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

/** Mirrors the kernel `Outcome` fields this path consumes. */
export interface NoteWriteOutcome {
  resource?: string;
  target?: string | null;
  effect?: { summary?: string; verified_by?: string | null } | null;
  feedback?: OutcomeFeedback | null;
  result?: { revision?: string } | null;
}

export type NoteWriteResult =
  | {
      status: 'verified';
      /** The revision the kernel observed AFTER rereading what it wrote. */
      revision: string | null;
      /** How the kernel proved the write landed. Never frontend-authored.
       *  Non-null by construction: an Outcome without it is not `verified`. */
      verifiedBy: string;
      summary: string | null;
    }
  | {
      status: 'conflict';
      expected: string;
      actual: string;
      message: string;
    }
  | {
      status: 'failed';
      code: string;
      message: string;
      retryable: boolean;
    };

/** Vault-relative path -> canonical note ResourceRef.
 *  Each path segment is encoded independently so a separator inside a name can
 *  never widen the addressed identity. */
export function noteResourceRef(vaultPath: string): string {
  const segments = vaultPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment));
  if (segments.length === 0) {
    throw new Error('a note ResourceRef needs at least one path segment');
  }
  return `ctrl://local/note/${segments.join('/')}`;
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/** Typed Outcome -> the three states this surface can be in. */
export function interpretNoteWrite(outcome: NoteWriteOutcome): NoteWriteResult {
  const feedback = outcome.feedback;
  if (feedback) {
    if (feedback.code === 'precondition_failed') {
      const details = feedback.details ?? {};
      return {
        status: 'conflict',
        // Absent operands are reported as unknown rather than guessed; a wrong
        // revision shown here would be worse than none.
        expected: asString(details['expected']) ?? 'unknown',
        actual: asString(details['actual']) ?? 'unknown',
        message: feedback.message,
      };
    }
    return {
      status: 'failed',
      code: feedback.code,
      message: feedback.message,
      retryable: feedback.retryable === true,
    };
  }

  const verifiedBy = asString(outcome.effect?.verified_by ?? null);
  if (!verifiedBy) {
    // No feedback AND no verification is not success. The contract requires a
    // post-write reread, so its absence means we do not know what happened.
    return {
      status: 'failed',
      code: 'unverified',
      message: 'the kernel returned no verification for this write',
      retryable: true,
    };
  }
  return {
    status: 'verified',
    revision: asString(outcome.result?.revision ?? null),
    verifiedBy,
    summary: asString(outcome.effect?.summary ?? null),
  };
}

/** Read the revision this write is conditioned on. */
async function currentRevision(resourceRef: string): Promise<string> {
  const descriptor = await gateInvoke<{ freshness?: { revision?: string | null } }>(
    'describe',
    { ref: resourceRef },
  );
  const revision = descriptor.freshness?.revision;
  if (typeof revision !== 'string' || revision.length === 0) {
    // Writing without a revision would defeat the recheck clause outright.
    throw new Error('the note reported no revision, so a safe write is not possible');
  }
  return revision;
}

/** Replace a whole Resource's content through the governed produce verb.
 *  `expectedRevision` may be supplied by a caller that already read a descriptor;
 *  otherwise it is read immediately before the write, because writing without a
 *  revision would defeat the recheck clause. */
export async function writeResourceContent(
  ref: string,
  content: string,
  expectedRevision?: string,
): Promise<NoteWriteResult> {
  const revision = expectedRevision ?? (await currentRevision(ref));
  const outcome = await produceResource<NoteWriteOutcome>(ref, {
    kind: 'replace_content',
    expected_revision: revision,
    content,
  });
  return interpretNoteWrite(outcome);
}

/** Same write, addressed by vault-relative path. */
export function writeNoteContent(
  vaultPath: string,
  content: string,
  expectedRevision?: string,
): Promise<NoteWriteResult> {
  return writeResourceContent(noteResourceRef(vaultPath), content, expectedRevision);
}
