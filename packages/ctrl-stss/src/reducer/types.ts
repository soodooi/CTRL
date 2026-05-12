/**
 * Reducer types — turns an envelope stream into a {@link CellTreeSnapshot}.
 *
 * Pure data — no rendering. Apps map the snapshot to whatever
 * representation their renderer wants.
 *
 * Differences from screi reducer:
 * - Applies CTRL Cell semantics (insert-or-update by id from delta
 *   cells, full replace from keyframe)
 * - Applies only the `'delete'` op kind structurally; other op kinds
 *   pass through to the consumer's audit handler unchanged
 * - No move / transform / subtree / append ops (CTRL doesn't model
 *   UI scroll bandwidth optimisations)
 *
 * @packageDocumentation
 */

import type { Cell } from '../protocol/cell.js';
import type { Envelope, ErrorEnvelope } from '../protocol/envelope.js';
import type { Op } from '../protocol/op.js';

/**
 * Receiver-side cell tree snapshot.
 *
 * **Note**: `snapshot` returned from {@link Reducer.apply} and
 * {@link Reducer.current} is a snapshot in time. The reducer is free
 * to replace the snapshot reference on the next apply — callers that
 * retain a reference will observe stale state, not future mutation.
 *
 * @public
 */
export interface CellTreeSnapshot {
  /** Stable map of `id → cell`. */
  readonly cells: ReadonlyMap<string, Cell>;
  /** Last applied envelope's seq. */
  readonly lastSeq: number;
  /** Last applied keyframe's seq, for `ref` validation. */
  readonly lastKeyframeSeq: number | null;
  /** Source identifier this snapshot represents. */
  readonly source: string | null;
  /** Wall-clock time of the most recent applied envelope. */
  readonly updatedAtMs: number;
}

/**
 * Output of {@link Reducer.apply}. Three channels:
 *
 * - `snapshot` — current cell-tree state after applying this envelope
 * - `semanticOps` — ops the reducer did not apply structurally (every
 *   op other than well-formed `'delete'`). Route to audit / event
 *   handler.
 * - `errors` — error envelopes from the peer. The remote signalled a
 *   protocol-level problem; consumers MUST surface these instead of
 *   discarding (the reducer otherwise no-ops on `'error'` type).
 *
 * @public
 */
export interface ReducerResult {
  readonly snapshot: CellTreeSnapshot;
  readonly semanticOps: readonly Op[];
  readonly errors: readonly ErrorEnvelope[];
}

/**
 * Apply envelopes to a cell tree.
 *
 * Stateful — one instance per source stream. After {@link reset} the
 * reducer drops back to the empty snapshot until the next keyframe.
 *
 * @public
 */
export interface Reducer {
  apply(envelope: Envelope): ReducerResult;
  current(): CellTreeSnapshot;
  reset(): void;
}
