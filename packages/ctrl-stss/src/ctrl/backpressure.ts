/**
 * Backpressure declaration — CTRL profile slot describing how
 * subscribers want to handle bounded-buffer overflow.
 *
 * Hardware sources (camera, microphone) and high-frequency screen
 * snapshots can outpace consumers. The kernel applies the policy a
 * subscriber declared at handshake, rather than a single hard-coded
 * default.
 *
 * Carried in `HelloPayload.capabilities.backpressure`.
 *
 * @see ../../../../.olym/specs/stss-protocol/spec.md §3.4
 * @packageDocumentation
 */

/**
 * Overflow policy.
 *
 * - `drop-oldest` — evict head, keep new (typical for sensor streams)
 * - `drop-newest` — keep head, drop new (typical for control planes)
 * - `coalesce` — collapse same-(stream, kind, id) entries within
 *   `coalesce_window_ms` to the latest
 * - `block` — backpressure the sender (only safe when sender supports
 *   pause)
 *
 * @public
 */
export type BackpressureDropPolicy =
  | 'drop-oldest'
  | 'drop-newest'
  | 'coalesce'
  | 'block';

/**
 * Backpressure policy carried at handshake.
 *
 * @public
 */
export interface BackpressurePolicy {
  /** Bounded buffer size in number of envelopes. */
  readonly buffer_size: number;
  readonly drop_policy: BackpressureDropPolicy;
  /**
   * Coalesce window for `drop_policy: 'coalesce'`. Ignored otherwise.
   * Default 100 ms when omitted.
   */
  readonly coalesce_window_ms?: number;
}
