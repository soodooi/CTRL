/**
 * JSON encoder — the v1 wire format.
 *
 * Uses native `JSON.parse` / `JSON.stringify` and UTF-8. Throws
 * {@link EnvelopeInvalidError} on malformed input.
 *
 * @packageDocumentation
 */

import { EnvelopeInvalidError } from '../protocol/error.js';
import { isEnvelope, type Envelope } from '../protocol/envelope.js';

import type { Encoder } from './types.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Parse a JSON string as an {@link Envelope}, throwing
 * {@link EnvelopeInvalidError} on any failure.
 *
 * @public
 */
export function parseEnvelopeJson(text: string): Envelope {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new EnvelopeInvalidError('JSON parse failed', { cause });
  }
  if (!isEnvelope(value)) {
    throw new EnvelopeInvalidError('Value is not a valid Envelope');
  }
  return value;
}

/**
 * JSON over UTF-8.
 *
 * @public
 */
export class JsonEncoder implements Encoder {
  readonly contentType = 'application/json';

  encode(envelope: Envelope): Uint8Array {
    return textEncoder.encode(JSON.stringify(envelope));
  }

  decode(bytes: Uint8Array): Envelope {
    let text: string;
    try {
      text = textDecoder.decode(bytes);
    } catch (cause) {
      throw new EnvelopeInvalidError('UTF-8 decode failed', { cause });
    }
    return parseEnvelopeJson(text);
  }
}
