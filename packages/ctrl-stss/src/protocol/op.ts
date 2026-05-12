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
 * @example keycap invocation
 * ```ts
 * const op: Op = {
 *   kind: 'keycap_invoked',
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
   * remove. For semantic kinds it is free-form (file path, keycap id,
   * window handle, etc.).
   */
  readonly target?: string;
  readonly payload?: unknown;
  readonly attrs?: Readonly<Record<string, unknown>>;
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
 * Returns `true` when this op should be applied by the reducer (i.e.
 * causes a structural cell-tree change). Currently only `'delete'`.
 *
 * @public
 */
export function isStructuralOp(op: Op): boolean {
  return op.kind === 'delete';
}

/**
 * Constructor with defaulting. `ts_ms` defaults to `Date.now()` when
 * omitted.
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
  return {
    kind: params.kind,
    ts_ms: params.ts_ms ?? Date.now(),
    ...(params.target !== undefined && { target: params.target }),
    ...(params.payload !== undefined && { payload: params.payload }),
    ...(params.attrs !== undefined && { attrs: params.attrs }),
  };
}

/**
 * Convenience constructor for the only structural op.
 *
 * @public
 */
export function createDeleteOp(target: string, ts_ms?: number): Op {
  return {
    kind: 'delete',
    ts_ms: ts_ms ?? Date.now(),
    target,
  };
}
