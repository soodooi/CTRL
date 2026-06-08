/**
 * Envelope — the CTRL ST-SS wire-format wrapper.
 *
 * Eight envelope types in v1: three data-plane (`keyframe` / `delta` /
 * `heartbeat`), two control-plane (`control` / `error`), three
 * handshake (`hello` / `welcome` / `bye`).
 *
 * The screi v0.5 envelope vocabulary was 14 types — we drop six
 * remote-viewing types (`cursor`, `layer-c.offer`, `layer-c.answer`,
 * `prediction`, `feedback`, `input`). CTRL v1 is not a remote-viewing
 * system; their reintroduction is a deliberate future decision, not a
 * silent forward-compat fallback.
 *
 * @see ../../../.olym/specs/stss-protocol/spec.md §2
 * @packageDocumentation
 */

import type { Capabilities, EndpointRole } from './capability.js';
import type { Cell } from './cell.js';
import type { Op } from './op.js';
import { PROTOCOL_VERSION } from './version.js';

/**
 * The full set of envelope types.
 *
 * @public
 */
export type EnvelopeType =
  | 'keyframe'
  | 'delta'
  | 'heartbeat'
  | 'control'
  | 'error'
  | 'hello'
  | 'welcome'
  | 'bye';

// ---------- Payloads ----------

/** Full state snapshot — replaces the receiver's cell map. @public */
export interface KeyframePayload {
  readonly cells: readonly Cell[];
}

/**
 * Changes since last keyframe. Cells are observations (insert-or-
 * update by id); ops are actions (`kind: 'delete'` removes a cell,
 * other kinds are passed through unchanged).
 *
 * @public
 */
export interface DeltaPayload {
  readonly cells?: readonly Cell[];
  readonly ops?: readonly Op[];
}

/** @public */
export type HeartbeatPayload = Record<string, never>;

/** @public */
export type ControlPayload =
  | { readonly action: 'subscribe'; readonly stream_id: string }
  | { readonly action: 'unsubscribe'; readonly stream_id: string }
  | { readonly action: 'request-keyframe'; readonly stream_id: string };

/** @public */
export interface ErrorPayload {
  readonly code: string;
  readonly message: string;
  /** When the error is reactive, the seq it references. */
  readonly ref?: number;
}

/**
 * First envelope from any endpoint after transport upgrade. Declares
 * role + capabilities so the peer can negotiate.
 *
 * @public
 */
export interface HelloPayload {
  readonly role: EndpointRole;
  readonly stream_id: string;
  readonly capabilities?: Capabilities;
  readonly intent?: string;
}

/**
 * Server / relay response to {@link HelloPayload}.
 *
 * @public
 */
export interface WelcomePayload {
  readonly protocol_version: typeof PROTOCOL_VERSION;
  readonly session_id: string;
  readonly server_clock_ms: number;
  readonly accepted_capabilities?: Capabilities;
}

/** @public */
export interface ByePayload {
  readonly reason?: string;
  readonly reconnect_hint?: boolean;
}

// ---------- Generic shape ----------

/**
 * Most code should prefer the concrete typed envelopes
 * ({@link KeyframeEnvelope}, {@link DeltaEnvelope}, ...) for
 * discriminator-aware narrowing.
 *
 * @public
 */
export interface EnvelopeBase<T extends EnvelopeType, P> {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: T;
  /**
   * Stream identifier — conventionally `<publisher>:<instance>` or a
   * UUID. Stable across reconnects when the publisher controls
   * identity.
   */
  readonly source: string;
  /** Monotonically increasing per source. */
  readonly seq: number;
  /** Sender's millisecond epoch timestamp when the envelope was emitted. */
  readonly ts_ms: number;
  /** Delta only: the seq of the keyframe this delta builds on. */
  readonly ref?: number;
  readonly payload: P;
}

/** @public */
export type KeyframeEnvelope = EnvelopeBase<'keyframe', KeyframePayload>;
/** @public */
export type DeltaEnvelope = EnvelopeBase<'delta', DeltaPayload> & {
  readonly ref: number;
};
/** @public */
export type HeartbeatEnvelope = EnvelopeBase<'heartbeat', HeartbeatPayload>;
/** @public */
export type ControlEnvelope = EnvelopeBase<'control', ControlPayload>;
/** @public */
export type ErrorEnvelope = EnvelopeBase<'error', ErrorPayload>;
/** @public */
export type HelloEnvelope = EnvelopeBase<'hello', HelloPayload>;
/** @public */
export type WelcomeEnvelope = EnvelopeBase<'welcome', WelcomePayload>;
/** @public */
export type ByeEnvelope = EnvelopeBase<'bye', ByePayload>;

/** @public */
export type Envelope =
  | KeyframeEnvelope
  | DeltaEnvelope
  | HeartbeatEnvelope
  | ControlEnvelope
  | ErrorEnvelope
  | HelloEnvelope
  | WelcomeEnvelope
  | ByeEnvelope;

// ---------- Type guards ----------

/** @public */
export const isKeyframe = (e: Envelope): e is KeyframeEnvelope => e.type === 'keyframe';
/** @public */
export const isDelta = (e: Envelope): e is DeltaEnvelope => e.type === 'delta';
/** @public */
export const isHeartbeat = (e: Envelope): e is HeartbeatEnvelope => e.type === 'heartbeat';
/** @public */
export const isControl = (e: Envelope): e is ControlEnvelope => e.type === 'control';
/** @public */
export const isError = (e: Envelope): e is ErrorEnvelope => e.type === 'error';
/** @public */
export const isHello = (e: Envelope): e is HelloEnvelope => e.type === 'hello';
/** @public */
export const isWelcome = (e: Envelope): e is WelcomeEnvelope => e.type === 'welcome';
/** @public */
export const isBye = (e: Envelope): e is ByeEnvelope => e.type === 'bye';

// ---------- Constructors ----------

/** @public */
export interface EnvelopeCommon {
  readonly source: string;
  readonly seq: number;
  /** Defaults to `Date.now()` if omitted. */
  readonly ts_ms?: number;
}

interface BaseFields<T extends EnvelopeType> {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: T;
  readonly source: string;
  readonly seq: number;
  readonly ts_ms: number;
}

function buildBase<T extends EnvelopeType>(
  params: EnvelopeCommon,
  type: T,
): BaseFields<T> {
  if (typeof params.source !== 'string' || params.source.length === 0) {
    throw new RangeError('Envelope.source must be a non-empty string');
  }
  if (!Number.isFinite(params.seq) || params.seq < 0 || !Number.isInteger(params.seq)) {
    throw new RangeError(
      `Envelope.seq must be a non-negative integer, got ${params.seq}`,
    );
  }
  const ts_ms = params.ts_ms ?? Date.now();
  if (!Number.isFinite(ts_ms) || ts_ms < 0) {
    throw new RangeError(
      `Envelope.ts_ms must be a non-negative finite number, got ${ts_ms}`,
    );
  }
  return {
    v: PROTOCOL_VERSION,
    type,
    source: params.source,
    seq: params.seq,
    ts_ms,
  };
}

/** @public */
export function createKeyframe(
  params: EnvelopeCommon & { readonly cells: readonly Cell[] },
): KeyframeEnvelope {
  return {
    ...buildBase(params, 'keyframe'),
    payload: { cells: params.cells },
  };
}

/**
 * `ref` MUST be the seq of the keyframe this delta builds on.
 *
 * @public
 */
export function createDelta(
  params: EnvelopeCommon & {
    readonly ref: number;
    readonly cells?: readonly Cell[];
    readonly ops?: readonly Op[];
  },
): DeltaEnvelope {
  const base = buildBase(params, 'delta');
  if (!Number.isInteger(params.ref) || params.ref < 0) {
    throw new RangeError(
      `Delta.ref must be a non-negative integer, got ${params.ref}`,
    );
  }
  if (params.ref >= params.seq) {
    throw new RangeError(
      `Delta.ref (${params.ref}) must be < seq (${params.seq})`,
    );
  }
  return {
    ...base,
    ref: params.ref,
    payload: {
      ...(params.cells !== undefined && { cells: params.cells }),
      ...(params.ops !== undefined && { ops: params.ops }),
    },
  };
}

/** @public */
export function createHeartbeat(params: EnvelopeCommon): HeartbeatEnvelope {
  return {
    ...buildBase(params, 'heartbeat'),
    payload: {},
  };
}

/** @public */
export function createControl(
  params: EnvelopeCommon & { readonly payload: ControlPayload },
): ControlEnvelope {
  return {
    ...buildBase(params, 'control'),
    payload: params.payload,
  };
}

/** @public */
export function createError(
  params: EnvelopeCommon & {
    readonly code: string;
    readonly message: string;
    readonly ref?: number;
  },
): ErrorEnvelope {
  return {
    ...buildBase(params, 'error'),
    payload: {
      code: params.code,
      message: params.message,
      ...(params.ref !== undefined && { ref: params.ref }),
    },
  };
}

/** @public */
export function createHello(
  params: EnvelopeCommon & {
    readonly role: EndpointRole;
    readonly stream_id: string;
    readonly capabilities?: Capabilities;
    readonly intent?: string;
  },
): HelloEnvelope {
  return {
    ...buildBase(params, 'hello'),
    payload: {
      role: params.role,
      stream_id: params.stream_id,
      ...(params.capabilities !== undefined && { capabilities: params.capabilities }),
      ...(params.intent !== undefined && { intent: params.intent }),
    },
  };
}

/** @public */
export function createWelcome(
  params: EnvelopeCommon & {
    readonly session_id: string;
    readonly server_clock_ms?: number;
    readonly accepted_capabilities?: Capabilities;
  },
): WelcomeEnvelope {
  return {
    ...buildBase(params, 'welcome'),
    payload: {
      protocol_version: PROTOCOL_VERSION,
      session_id: params.session_id,
      server_clock_ms: params.server_clock_ms ?? Date.now(),
      ...(params.accepted_capabilities !== undefined && {
        accepted_capabilities: params.accepted_capabilities,
      }),
    },
  };
}

/** @public */
export function createBye(
  params: EnvelopeCommon & {
    readonly reason?: string;
    readonly reconnect_hint?: boolean;
  },
): ByeEnvelope {
  return {
    ...buildBase(params, 'bye'),
    payload: {
      ...(params.reason !== undefined && { reason: params.reason }),
      ...(params.reconnect_hint !== undefined && {
        reconnect_hint: params.reconnect_hint,
      }),
    },
  };
}

// ---------- Structural validation ----------

const VALID_TYPES = new Set<EnvelopeType>([
  'keyframe',
  'delta',
  'heartbeat',
  'control',
  'error',
  'hello',
  'welcome',
  'bye',
]);

/**
 * Upper bound on the `source` field length when accepted via
 * {@link isEnvelope}. Generous for typical `<publisher>:<instance>`
 * ids (publisher ~30 chars + UUID 36 chars + slop) while denying
 * pathological inputs (a malicious peer sending a 10 MB `source`).
 *
 * @public
 */
export const SOURCE_MAX_LENGTH = 256;

/**
 * Cheap structural shape check used at wire ingress. Beyond shape,
 * checks the numeric fields are finite and non-negative, the source
 * is bounded, and the payload is a non-null object.
 *
 * For full payload-aware validation layer a Zod schema on top.
 *
 * @public
 */
export function isEnvelope(value: unknown): value is Envelope {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.v !== PROTOCOL_VERSION) return false;
  if (typeof v.type !== 'string') return false;
  if (!VALID_TYPES.has(v.type as EnvelopeType)) return false;
  if (typeof v.source !== 'string') return false;
  if (v.source.length === 0 || v.source.length > SOURCE_MAX_LENGTH) return false;
  if (typeof v.seq !== 'number' || !Number.isInteger(v.seq) || v.seq < 0) return false;
  if (typeof v.ts_ms !== 'number' || !Number.isFinite(v.ts_ms) || v.ts_ms < 0) return false;
  if (typeof v.payload !== 'object' || v.payload === null) return false;
  return true;
}
