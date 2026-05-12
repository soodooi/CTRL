/**
 * Length-prefixed framing for transports without an inherent message
 * boundary (raw TCP, Unix sockets, persistence logs).
 *
 * WebSocket already frames messages, so most CTRL v1 usage does NOT
 * need these helpers. They are provided for the future ST-SS hardware
 * transport path (Phase 11+), persistence log lines, and custom
 * relays.
 *
 * Wire format: `[uint32_be length][payload bytes...]`
 *
 * @packageDocumentation
 */

import { FramingOversizedError } from './error.js';

/**
 * Default upper bound on a single framed payload — 16 MiB.
 *
 * @public
 */
export const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * Encode a payload into a length-prefixed frame.
 *
 * @public
 */
export function encodeFrame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.byteLength);
  const view = new DataView(out.buffer, out.byteOffset, 4);
  view.setUint32(0, payload.byteLength, false);
  out.set(payload, 4);
  return out;
}

/** @public */
export interface DecodedFrame {
  readonly payload: Uint8Array;
  readonly nextOffset: number;
}

/**
 * Try to decode a single length-prefixed frame from the given buffer.
 *
 * Returns `null` if the buffer doesn't yet contain a complete frame.
 *
 * @public
 */
export function decodeFrame(
  buffer: Uint8Array,
  options: { readonly maxBytes?: number } = {},
): DecodedFrame | null {
  if (buffer.byteLength < 4) return null;

  const view = new DataView(buffer.buffer, buffer.byteOffset, 4);
  const length = view.getUint32(0, false);

  const limit = options.maxBytes ?? DEFAULT_MAX_FRAME_BYTES;
  if (length > limit) {
    throw new FramingOversizedError(length, limit);
  }

  const total = 4 + length;
  if (buffer.byteLength < total) return null;

  return {
    payload: buffer.subarray(4, total),
    nextOffset: total,
  };
}

/**
 * Stateful streaming decoder — buffers between calls and emits one
 * payload per complete frame.
 *
 * @public
 */
export class FrameDecoder {
  private buf: Uint8Array;
  private readonly maxBytes: number;

  constructor(options: { readonly maxBytes?: number } = {}) {
    this.buf = new Uint8Array(0);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  push(chunk: Uint8Array): readonly Uint8Array[] {
    this.buf = concat(this.buf, chunk);
    const out: Uint8Array[] = [];

    while (true) {
      const frame = decodeFrame(this.buf, { maxBytes: this.maxBytes });
      if (!frame) break;
      out.push(frame.payload);
      this.buf = this.buf.subarray(frame.nextOffset);
    }

    return out;
  }

  bufferedBytes(): number {
    return this.buf.byteLength;
  }

  expectedNext(): number {
    if (this.buf.byteLength < 4) return 0;
    const view = new DataView(this.buf.buffer, this.buf.byteOffset, 4);
    return view.getUint32(0, false);
  }

  reset(): void {
    this.buf = new Uint8Array(0);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}
