// record-write — one reading of a canonical write Outcome.
//
// Tasks, calendar events, and smart-table cells are three sources with one write
// story, and their failures must read identically to the user: a stale source is
// a conflict they can act on, and an unverified write is not a write. Three
// hand-written interpreters would drift, and the first divergence would present
// the same kernel state as a different kind of problem.
// (ADR-002 substrate §15.2 v87; ADR-002 substrate §15.5.2 v86)

import { describeResource, produceResource } from './kernel';

/** What the owner reported. `conflict` carries both revisions so a surface can
 *  show a real conflict rather than a vague failure. */
export type RecordWriteResult =
  | { kind: 'verified'; verifiedBy: string; revision?: string; row?: Record<string, unknown> }
  | { kind: 'conflict'; expected?: string; current?: string; message: string }
  | { kind: 'failed'; code: string; message: string; retryable: boolean };

export interface RecordOutcome {
  target?: string;
  effect?: { summary: string; verified_by?: string | null } | null;
  feedback?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  } | null;
  result?: { revision?: string; row?: Record<string, unknown> } | null;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Total by construction: every Outcome maps to exactly one of three states, and
 *  an Outcome that verified nothing is never read as done. */
export function interpretRecordWrite(outcome: RecordOutcome): RecordWriteResult {
  if (outcome.feedback) {
    const { code, message, retryable, details } = outcome.feedback;
    if (code === 'precondition_failed') {
      return {
        kind: 'conflict',
        message,
        expected: text(details?.expected_revision),
        current: text(details?.current_revision),
      };
    }
    return { kind: 'failed', code, message, retryable };
  }
  const verifiedBy = outcome.effect?.verified_by;
  if (!verifiedBy) {
    return {
      kind: 'failed',
      code: 'unverified',
      message: 'the change was not confirmed as written',
      retryable: true,
    };
  }
  return {
    kind: 'verified',
    verifiedBy,
    revision: outcome.result?.revision,
    row: outcome.result?.row,
  };
}

/** Encode each path segment so a separator stays a separator and a space in a
 *  note name does not break the ref. */
export const resourceRefFor = (kind: string, path: string): string =>
  `ctrl://local/${kind}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** The revision a write must be conditioned on: the state of the source as the
 *  caller read it. A source that reports none is not written to blind. */
export async function readRevision(ref: string): Promise<string> {
  const descriptor = await describeResource(ref);
  const revision = descriptor.freshness?.revision;
  if (!revision) throw new Error('the source reported no revision to write against');
  return revision;
}

/** Read the revision, then produce one bounded change against it. Failures on
 *  the read half are reported in the same shape as failures on the write half,
 *  so a caller has one thing to handle. */
export async function writeRecord(
  ref: string,
  operation: (expectedRevision: string) => Record<string, unknown>,
): Promise<RecordWriteResult> {
  let expectedRevision: string;
  try {
    expectedRevision = await readRevision(ref);
  } catch (error) {
    return {
      kind: 'failed',
      code: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
  try {
    const outcome = await produceResource<RecordOutcome>(ref, operation(expectedRevision));
    return interpretRecordWrite(outcome);
  } catch (error) {
    // A transport or authorization failure is still a typed failure to the
    // caller; it is never reported as a completed write.
    return {
      kind: 'failed',
      code: 'write_failed',
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
}
