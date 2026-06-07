/**
 * Op — a typed action / event on a CTRL ST-SS stream.
 *
 * Ops are discrete events that happened in time. Unlike Cells (which
 * assert state values), Ops record verbs. The reducer applies
 * `kind: 'delete'` as a structural cell removal; all other Ops pass
 * through to the audit log unchanged.
 *
 * v1 vocabulary intentionally omits the UI-bandwidth ops from screi
 * (move/transform/subtree-*) — CTRL is not a remote-viewing system.
 *
 * @see ../../../.olym/specs/stss-protocol/spec.md §2.1
 * @packageDocumentation
 */

import type { OpKind } from './kind.js';

/**
 * A typed action event.
 *
 * @example mcp invocation
 * ```ts
 * const op: Op = {
 *   kind: 'mcp_invoked',
 *   ts_ms: 1715472002_100,
 *   target: 'clipboard-ai',
 *   payload: { trigger: 'hotkey', args: { mode: 'rewrite' } },
 * };
 * ```
 *
 * @example structural delete
 * ```ts
 * const op: Op = {
 *   kind: 'delete',
 *   ts_ms: 1715472003_000,
 *   target: 'clipboard',
 * };
 * ```
 *
 * @public
 */
export interface Op {
  readonly kind: OpKind;
  /**
   * Wall-clock time the action happened.
   */
  readonly ts_ms: number;
  /**
   * Optional reference. For `kind: 'delete'`, this is the cell id to
   * remove (required and non-empty — see {@link DeleteOp} for the
   * narrowed type). For semantic kinds it is free-form (file path,
   * mcp id, window handle, etc.).
   */
  readonly target?: string;
  readonly payload?: unknown;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

/**
 * Narrowed structural-op variant. `target` is required and the
 * reducer relies on this — a delete op without a target is rejected
 * at construction by {@link createDeleteOp} and at apply time by
 * `DefaultReducer`.
 *
 * @public
 */
export interface DeleteOp extends Op {
  readonly kind: 'delete';
  readonly target: string;
}

/**
 * Cheap structural type guard.
 *
 * @public
 */
export function isOp(value: unknown): value is Op {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.kind === 'string' && typeof v.ts_ms === 'number';
}

/**
 * Narrow an {@link Op} to the {@link DeleteOp} variant. Returns
 * `true` only when `kind === 'delete'` AND `target` is a non-empty
 * string.
 *
 * @public
 */
export function isDeleteOp(op: Op): op is DeleteOp {
  return op.kind === 'delete' && typeof op.target === 'string' && op.target.length > 0;
}

/**
 * Returns `true` when this op causes a structural cell-tree change
 * (currently only well-formed `'delete'`).
 *
 * @public
 */
export function isStructuralOp(op: Op): boolean {
  return isDeleteOp(op);
}

function validateTsMs(ts_ms: number): void {
  if (!Number.isFinite(ts_ms) || ts_ms < 0) {
    throw new RangeError(`Op.ts_ms must be a non-negative finite number, got ${ts_ms}`);
  }
}

/**
 * Constructor with defaulting. `ts_ms` defaults to `Date.now()` when
 * omitted. Throws {@link RangeError} when `ts_ms` is negative or
 * non-finite.
 *
 * @public
 */
export function createOp(params: {
  readonly kind: OpKind;
  readonly target?: string;
  readonly payload?: unknown;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly ts_ms?: number;
}): Op {
  const ts_ms = params.ts_ms ?? Date.now();
  validateTsMs(ts_ms);
  return {
    kind: params.kind,
    ts_ms,
    ...(params.target !== undefined && { target: params.target }),
    ...(params.payload !== undefined && { payload: params.payload }),
    ...(params.attrs !== undefined && { attrs: params.attrs }),
  };
}

/**
 * Convenience constructor for the only structural op. Throws
 * {@link RangeError} when `target` is empty.
 *
 * @public
 */
export function createDeleteOp(target: string, ts_ms?: number): DeleteOp {
  if (typeof target !== 'string' || target.length === 0) {
    throw new RangeError('createDeleteOp: target must be a non-empty string');
  }
  const stamp = ts_ms ?? Date.now();
  validateTsMs(stamp);
  return {
    kind: 'delete',
    ts_ms: stamp,
    target,
  };
}
