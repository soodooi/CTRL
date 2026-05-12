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
 * - `heartbeat` / `control` / `error` / `hello` / `welcome` / `bye`
 *   — return current snapshot unchanged
 *
 * Throws {@link MissingKeyframeError} if a delta arrives before any
 * keyframe has been applied.
 *
 * @packageDocumentation
 */

import type { Cell } from '../protocol/cell.js';
import {
  type Envelope,
  isDelta,
  isKeyframe,
} from '../protocol/envelope.js';
import { MissingKeyframeError } from '../protocol/error.js';
import type { Op } from '../protocol/op.js';

import type { CellTreeSnapshot, Reducer, ReducerResult } from './types.js';

const EMPTY_SNAPSHOT: CellTreeSnapshot = {
  cells: new Map(),
  lastSeq: -1,
  lastKeyframeSeq: null,
  source: null,
  updatedAtMs: 0,
};

const NO_OPS: readonly Op[] = [];

/**
 * Default CTRL cell-tree reducer.
 *
 * @public
 */
export class DefaultReducer implements Reducer {
  private snapshot: CellTreeSnapshot = EMPTY_SNAPSHOT;

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
      return { snapshot: this.snapshot, semanticOps: NO_OPS };
    }

    if (isDelta(envelope)) {
      if (this.snapshot.lastKeyframeSeq === null) {
        throw new MissingKeyframeError(envelope.ref);
      }
      const next = new Map(this.snapshot.cells);
      const semanticOps: Op[] = [];

      if (envelope.payload.cells) {
        for (const c of envelope.payload.cells) next.set(c.id, c);
      }
      if (envelope.payload.ops) {
        for (const op of envelope.payload.ops) {
          if (op.kind === 'delete' && typeof op.target === 'string') {
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
      return { snapshot: this.snapshot, semanticOps };
    }

    return { snapshot: this.snapshot, semanticOps: NO_OPS };
  }

  current(): CellTreeSnapshot {
    return this.snapshot;
  }

  reset(): void {
    this.snapshot = EMPTY_SNAPSHOT;
  }
}
