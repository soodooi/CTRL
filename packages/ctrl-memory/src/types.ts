/**
 * Shared types for `@ctrl/memory`.
 *
 * @packageDocumentation
 */

import type { Envelope, EnvelopeType } from '@ctrl/stss';

/**
 * Predicate for filtering envelope streams.
 *
 * All fields are optional — an empty filter matches every envelope.
 * Fields combine with AND semantics.
 *
 * @public
 */
export interface EnvelopeFilter {
  /** Match envelopes whose `source` equals this. */
  readonly source?: string;
  /** Match envelopes whose `type` is in this set. */
  readonly types?: readonly EnvelopeType[];
  /** Inclusive lower bound on `ts_ms`. */
  readonly fromTsMs?: number;
  /** Inclusive upper bound on `ts_ms`. */
  readonly toTsMs?: number;
  /** Inclusive lower bound on `seq` (per-source monotonic). */
  readonly fromSeq?: number;
  /** Inclusive upper bound on `seq`. */
  readonly toSeq?: number;
  /**
   * Free-form additional predicate. Combined with the structured
   * fields by AND. Keep these cheap — the in-memory reader runs them
   * for every envelope.
   */
  readonly where?: (env: Envelope) => boolean;
}

/**
 * Apply an {@link EnvelopeFilter} to a single envelope.
 *
 * @public
 */
export function matchesFilter(env: Envelope, filter?: EnvelopeFilter): boolean {
  if (!filter) return true;
  if (filter.source !== undefined && env.source !== filter.source) return false;
  if (filter.types !== undefined && !filter.types.includes(env.type)) return false;
  if (filter.fromTsMs !== undefined && env.ts_ms < filter.fromTsMs) return false;
  if (filter.toTsMs !== undefined && env.ts_ms > filter.toTsMs) return false;
  if (filter.fromSeq !== undefined && env.seq < filter.fromSeq) return false;
  if (filter.toSeq !== undefined && env.seq > filter.toSeq) return false;
  if (filter.where !== undefined && !filter.where(env)) return false;
  return true;
}
