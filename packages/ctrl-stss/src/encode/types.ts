/**
 * Encoder — serialises an {@link Envelope} to bytes and back.
 *
 * v1 default is {@link JsonEncoder}. A CBOR variant is intentionally
 * deferred until hardware bandwidth pressure (Phase 11+) justifies
 * the additional `cbor-x` dependency.
 *
 * @packageDocumentation
 */

import type { Envelope } from '../protocol/index.js';

/**
 * Encoder interface.
 *
 * @public
 */
export interface Encoder {
  readonly contentType: string;
  encode(envelope: Envelope): Uint8Array;
  decode(bytes: Uint8Array): Envelope;
}
