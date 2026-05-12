/**
 * Reader — query facade over a {@link LineSource}.
 *
 * Stateful: a reader tracks a cursor + cell-tree snapshot so callers
 * can `seekToSeq` / `seekToTime` and then `iterate`. Backed by an
 * underlying reducer ({@link Reducer} from `@ctrl/stss`).
 *
 * @packageDocumentation
 */

import type { CellTreeSnapshot, Envelope } from '@ctrl/stss';

import type { EnvelopeFilter } from '../types.js';

/**
 * Stateful query facade over a persisted envelope log.
 *
 * @public
 */
export interface MemoryReader {
  /**
   * Stream envelopes matching `filter` in append order.
   *
   * The reader's internal cursor and snapshot do NOT advance during
   * iteration unless the caller explicitly applies returned envelopes
   * via {@link applyEnvelope}.
   */
  iterate(filter?: EnvelopeFilter): AsyncIterableIterator<Envelope>;

  /**
   * Current cell-tree snapshot — reflects the envelopes applied so
   * far via {@link applyEnvelope} or {@link seekToSeq} /
   * {@link seekToTime}.
   */
  current(): CellTreeSnapshot;

  /**
   * Apply one envelope to the reader's reducer. Useful when the
   * caller iterates and selectively applies (e.g. dropping
   * heartbeats during a replay).
   */
  applyEnvelope(envelope: Envelope): void;

  /**
   * Replay from the start, applying every envelope up to and
   * including `seq` (when an envelope from the matching source
   * carries it). Subsequent envelopes are not applied; the cursor
   * stops here. Use {@link iterate} to stream from the cursor.
   */
  seekToSeq(seq: number): Promise<void>;

  /**
   * Replay from the start, applying every envelope whose `ts_ms`
   * is <= `tsMs`.
   */
  seekToTime(tsMs: number): Promise<void>;

  /**
   * Reset the reader's reducer to empty. Does not affect the
   * underlying log.
   */
  reset(): void;
}
