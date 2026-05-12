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
import type { Envelope } from '../protocol/envelope.js';
import type { Op } from '../protocol/op.js';

/**
 * Receiver-side cell tree snapshot.
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
 * Side-effect output of {@link Reducer.apply} for ops that did NOT
 * mutate the cell tree (every op other than `'delete'`).
 *
 * Consumers route these to their audit log / event handler. Bundling
 * them in the return saves the reducer from owning a callback.
 *
 * @public
 */
export interface ReducerResult {
  readonly snapshot: CellTreeSnapshot;
  /** Ops the reducer did not apply structurally. Empty on keyframe / heartbeat / control / handshake. */
  readonly semanticOps: readonly Op[];
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
