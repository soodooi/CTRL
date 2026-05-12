/**
 * Default {@link Reducer} — applies CTRL ST-SS envelopes to a cell
 * tree.
 *
 * Semantics:
 * - `keyframe` — replace cell map with payload.cells; record
 *   `lastKeyframeSeq` for subsequent delta validation
 * - `delta` — apply payload.cells as insert-or-update by id; apply
 *   payload.ops where `kind === 'delete'` as structural removal;
 *   return remaining ops as `semanticOps` for the consumer's audit
 *   handler
 * - `error` — return the envelope on `errors` so the consumer can
 *   react; snapshot unchanged
 * - `heartbeat` / `control` / `hello` / `welcome` / `bye` — return
 *   current snapshot unchanged with empty `semanticOps` / `errors`
 *
 * Throws {@link MissingKeyframeError} if a delta arrives before any
 * keyframe has been applied. Throws {@link EnvelopeInvalidError} on
 * cross-source delta or a malformed `'delete'` op missing target.
 *
 * @packageDocumentation
 */

import type { Cell } from '../protocol/cell.js';
import {
  type Envelope,
  type ErrorEnvelope,
  isDelta,
  isError,
  isKeyframe,
} from '../protocol/envelope.js';
import {
  EnvelopeInvalidError,
  MissingKeyframeError,
} from '../protocol/error.js';
import { type Op, isDeleteOp } from '../protocol/op.js';

import type { CellTreeSnapshot, Reducer, ReducerResult } from './types.js';

function emptySnapshot(): CellTreeSnapshot {
  return {
    cells: new Map(),
    lastSeq: -1,
    lastKeyframeSeq: null,
    source: null,
    updatedAtMs: 0,
  };
}

const NO_OPS: readonly Op[] = [];
const NO_ERRORS: readonly ErrorEnvelope[] = [];

/**
 * Default CTRL cell-tree reducer.
 *
 * Single-source: a delta whose `envelope.source` does not match the
 * source of the last applied keyframe is rejected with
 * {@link EnvelopeInvalidError}. Apps that aggregate multiple streams
 * keep one reducer per source.
 *
 * @public
 */
export class DefaultReducer implements Reducer {
  private snapshot: CellTreeSnapshot = emptySnapshot();

  apply(envelope: Envelope): ReducerResult {
    if (isKeyframe(envelope)) {
      const cells = new Map<string, Cell>();
      for (const c of envelope.payload.cells) cells.set(c.id, c);
      this.snapshot = {
        cells,
        lastSeq: envelope.seq,
        lastKeyframeSeq: envelope.seq,
        source: envelope.source,
        updatedAtMs: envelope.ts_ms,
      };
      return { snapshot: this.snapshot, semanticOps: NO_OPS, errors: NO_ERRORS };
    }

    if (isDelta(envelope)) {
      if (this.snapshot.lastKeyframeSeq === null) {
        throw new MissingKeyframeError(envelope.ref);
      }
      if (
        this.snapshot.source !== null &&
        this.snapshot.source !== envelope.source
      ) {
        throw new EnvelopeInvalidError(
          `Cross-source delta: snapshot source="${this.snapshot.source}", ` +
            `delta source="${envelope.source}". Use one reducer per source.`,
        );
      }
      const next = new Map(this.snapshot.cells);
      const semanticOps: Op[] = [];

      if (envelope.payload.cells) {
        for (const c of envelope.payload.cells) next.set(c.id, c);
      }
      if (envelope.payload.ops) {
        for (const op of envelope.payload.ops) {
          if (op.kind === 'delete') {
            if (!isDeleteOp(op)) {
              throw new EnvelopeInvalidError(
                `Delete op missing non-empty target at seq ${envelope.seq}`,
              );
            }
            next.delete(op.target);
          } else {
            semanticOps.push(op);
          }
        }
      }

      this.snapshot = {
        cells: next,
        lastSeq: envelope.seq,
        lastKeyframeSeq: this.snapshot.lastKeyframeSeq,
        source: envelope.source,
        updatedAtMs: envelope.ts_ms,
      };
      return { snapshot: this.snapshot, semanticOps, errors: NO_ERRORS };
    }

    if (isError(envelope)) {
      return {
        snapshot: this.snapshot,
        semanticOps: NO_OPS,
        errors: [envelope],
      };
    }

    return { snapshot: this.snapshot, semanticOps: NO_OPS, errors: NO_ERRORS };
  }

  current(): CellTreeSnapshot {
    return this.snapshot;
  }

  reset(): void {
    this.snapshot = emptySnapshot();
  }
}
