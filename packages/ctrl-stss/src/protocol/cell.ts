/**
 * Cell — a typed observation of state on a CTRL ST-SS stream.
 *
 * A Cell asserts "the current value of {kind} at id={id} as of
 * ts_ms is {payload}". Successive Cells with the same id replace the
 * previous observation in the reducer's state map.
 *
 * Unlike screi's UI-tree Cell ({id, bbox, role, content}), CTRL Cell
 * carries arbitrary structured payload — fit for clipboard snapshots,
 * sensor readings, LLM responses, etc. The `attrs` bag enables
 * source-specific extension without forking the type.
 *
 * @see ../../../.olym/specs/stss-protocol/spec.md §2.1
 * @packageDocumentation
 */

import type { CellKind } from './kind.js';

/**
 * A typed state observation.
 *
 * @example clipboard snapshot
 * ```ts
 * const cell: Cell = {
 *   id: 'clipboard',
 *   kind: 'clipboard_snapshot',
 *   ts_ms: 1715472000_000,
 *   payload: { text: 'hello world', mime: 'text/plain' },
 * };
 * ```
 *
 * @example hardware reading
 * ```ts
 * const cell: Cell = {
 *   id: 'thermostat',
 *   kind: 'hardware_reading',
 *   ts_ms: 1715472001_500,
 *   payload: { temp_c: 24.5, humidity_pct: 45 },
 *   attrs: { unit: 'metric', sample_rate_hz: 1 },
 * };
 * ```
 *
 * @public
 */
export interface Cell {
  /**
   * Cross-frame stable identifier. Receivers correlate cells across
   * keyframes and delta frames by this field. Stability matters: if
   * ids change every emission, deltas degenerate to insert+delete
   * pairs and the protocol loses bandwidth advantage.
   *
   * IDs are stream-scoped, not global. Two streams MAY use the same
   * id for unrelated cells.
   */
  readonly id: string;

  /**
   * What kind of observation this is — drives reducer dispatch on the
   * receiver and lens selection on the renderer.
   */
  readonly kind: CellKind;

  /**
   * Wall-clock time the observation was MADE (not emitted). For
   * sensor readings, this is the sample time; for LLM responses, the
   * completion time. Receivers MAY use this for ordering and for
   * lifespan / TTL decisions.
   */
  readonly ts_ms: number;

  /**
   * Kind-specific structured payload. Receivers SHOULD validate
   * payload shape per `kind` at the consumer boundary, not at the
   * protocol layer.
   */
  readonly payload: unknown;

  /**
   * Free-form structured metadata. Keys SHOULD be `snake_case`.
   * Values SHOULD be primitives or simple JSON.
   *
   * Use cases: sensor unit/range, tool-call provenance, AX source
   * tag, lens selection hints, A/B variant id, etc.
   *
   * Receivers without a lens that reads this MUST forward-compat-
   * ignore.
   */
  readonly attrs?: Readonly<Record<string, unknown>>;
}

/**
 * Cheap structural type guard.
 *
 * @public
 */
export function isCell(value: unknown): value is Cell {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.ts_ms === 'number' &&
    'payload' in v
  );
}

/**
 * Constructor with defaulting. `ts_ms` defaults to `Date.now()` when
 * omitted.
 *
 * @public
 */
export function createCell(params: {
  readonly id: string;
  readonly kind: CellKind;
  readonly payload: unknown;
  readonly ts_ms?: number;
  readonly attrs?: Readonly<Record<string, unknown>>;
}): Cell {
  return {
    id: params.id,
    kind: params.kind,
    ts_ms: params.ts_ms ?? Date.now(),
    payload: params.payload,
    ...(params.attrs !== undefined && { attrs: params.attrs }),
  };
}
