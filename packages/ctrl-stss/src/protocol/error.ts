/**
 * Error hierarchy for the CTRL ST-SS protocol layer.
 *
 * Every protocol-level failure is one of these typed subclasses. Apps
 * SHOULD catch the base {@link ProtocolError} and inspect `code` /
 * subclass type to decide on retry / reconnect / surface-to-user.
 *
 * Wire representation: protocol errors travel as `error` envelopes
 * (see `envelope.ts`). The `code` field on the wire matches `code` on
 * the thrown class.
 *
 * Auth-related codes are intentionally absent — CTRL authentication is
 * the responsibility of `ctrl-auth`, not the wire protocol.
 *
 * @packageDocumentation
 */

/**
 * Stable error code strings. New codes MAY be added in a minor version;
 * existing codes are immutable.
 *
 * @public
 */
export type ProtocolErrorCode =
  | 'PROTOCOL_VERSION_MISMATCH'
  | 'ENVELOPE_INVALID'
  | 'ENVELOPE_UNKNOWN_TYPE'
  | 'MISSING_KEYFRAME'
  | 'OP_TARGET_MISSING'
  | 'FRAMING_TRUNCATED'
  | 'FRAMING_OVERSIZED'
  | 'HANDSHAKE_FAILED'
  | 'TRANSPORT_CLOSED';

/**
 * Base class for every protocol-level error.
 *
 * @public
 */
export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/**
 * Receiver saw an envelope with `v` that does not match the
 * `PROTOCOL_VERSION` it was built against.
 *
 * @public
 */
export class ProtocolVersionMismatchError extends ProtocolError {
  readonly expected: number;
  readonly received: unknown;

  constructor(expected: number, received: unknown) {
    super(
      'PROTOCOL_VERSION_MISMATCH',
      `Envelope version mismatch: expected ${expected}, received ${String(received)}`,
    );
    this.name = 'ProtocolVersionMismatchError';
    this.expected = expected;
    this.received = received;
  }
}

/**
 * Envelope failed structural validation (missing required fields,
 * wrong types).
 *
 * @public
 */
export class EnvelopeInvalidError extends ProtocolError {
  constructor(message: string, options?: { cause?: unknown }) {
    super('ENVELOPE_INVALID', message, options);
    this.name = 'EnvelopeInvalidError';
  }
}

/**
 * Envelope's `type` field is not a known {@link EnvelopeType}.
 *
 * Receivers SHOULD treat unknown types as graceful-ignore per the
 * forward-compat rule. This class exists for strict-mode receivers.
 *
 * @public
 */
export class EnvelopeUnknownTypeError extends ProtocolError {
  readonly type: string;

  constructor(type: string) {
    super('ENVELOPE_UNKNOWN_TYPE', `Unknown envelope type: ${type}`);
    this.name = 'EnvelopeUnknownTypeError';
    this.type = type;
  }
}

/**
 * A delta envelope arrived for which no keyframe has been seen.
 *
 * Recovery: send a `control` envelope with `action: 'request-keyframe'`.
 *
 * @public
 */
export class MissingKeyframeError extends ProtocolError {
  readonly ref: number;

  constructor(ref: number) {
    super('MISSING_KEYFRAME', `Delta refers to unknown keyframe seq=${ref}`);
    this.name = 'MissingKeyframeError';
    this.ref = ref;
  }
}

/**
 * An op references a cell id that doesn't exist in the current
 * snapshot.
 *
 * @public
 */
export class OpTargetMissingError extends ProtocolError {
  readonly kind: string;
  readonly target: string;

  constructor(kind: string, target: string) {
    super('OP_TARGET_MISSING', `Op kind="${kind}" targets missing cell id=${target}`);
    this.name = 'OpTargetMissingError';
    this.kind = kind;
    this.target = target;
  }
}

/**
 * Length-prefixed framing got truncated input.
 *
 * @public
 */
export class FramingTruncatedError extends ProtocolError {
  readonly expected: number;
  readonly received: number;

  constructor(expected: number, received: number) {
    super(
      'FRAMING_TRUNCATED',
      `Framing truncated: expected ${expected} payload bytes, received ${received}`,
    );
    this.name = 'FramingTruncatedError';
    this.expected = expected;
    this.received = received;
  }
}

/**
 * Length-prefixed framing got a length above the configured maximum.
 *
 * @public
 */
export class FramingOversizedError extends ProtocolError {
  readonly length: number;
  readonly limit: number;

  constructor(length: number, limit: number) {
    super(
      'FRAMING_OVERSIZED',
      `Framing oversized: payload length ${length} exceeds limit ${limit}`,
    );
    this.name = 'FramingOversizedError';
    this.length = length;
    this.limit = limit;
  }
}

/**
 * Handshake (`hello` / `welcome`) failed.
 *
 * @public
 */
export class HandshakeFailedError extends ProtocolError {
  constructor(message: string) {
    super('HANDSHAKE_FAILED', message);
    this.name = 'HandshakeFailedError';
  }
}

/**
 * Underlying transport closed unexpectedly.
 *
 * @public
 */
export class TransportClosedError extends ProtocolError {
  readonly reason: string;

  constructor(reason: string) {
    super('TRANSPORT_CLOSED', `Transport closed: ${reason}`);
    this.name = 'TransportClosedError';
    this.reason = reason;
  }
}
