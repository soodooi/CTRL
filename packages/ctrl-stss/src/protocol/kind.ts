/**
 * Open-extension discriminator unions for {@link Cell.kind} and
 * {@link Op.kind}.
 *
 * The well-known literals enable autocompletion + exhaustiveness checks
 * in CTRL-aware code, while the `(string & {})` trick keeps the type
 * permissive for keycap authors who publish custom kinds.
 *
 * Receivers MUST tolerate unknown kinds (forward-compat — silently
 * forward, do not throw).
 *
 * @packageDocumentation
 */

/**
 * Built-in cell kinds CTRL recognises. Cells are typed observations
 * (state snapshots / values) emitted by sources. The reducer indexes
 * them by `id` to build the latest-known-state map.
 *
 * @public
 */
export type CellKind =
  | 'user_input'
  | 'clipboard_snapshot'
  | 'screen_snapshot'
  | 'hardware_reading'
  | 'llm_response'
  | 'tool_result'
  | 'context_snapshot'
  | (string & {});

/**
 * Built-in op kinds CTRL recognises. Ops are typed actions — discrete
 * events that happened in time, not state mutations. The exception is
 * `delete`, which is a structural removal from the cell tree.
 *
 * @public
 */
export type OpKind =
  | 'delete'
  | 'keycap_invoked'
  | 'keycap_completed'
  | 'hotkey_triggered'
  | 'app_focus_changed'
  | 'file_saved'
  | 'cursor_moved'
  | (string & {});

/**
 * Well-known cell kinds as a runtime set. Useful for source endpoints
 * that want to advertise their `cell_kinds` capability without typos.
 *
 * @public
 */
export const KNOWN_CELL_KINDS = [
  'user_input',
  'clipboard_snapshot',
  'screen_snapshot',
  'hardware_reading',
  'llm_response',
  'tool_result',
  'context_snapshot',
] as const satisfies readonly CellKind[];

/**
 * Well-known op kinds as a runtime set.
 *
 * @public
 */
export const KNOWN_OP_KINDS = [
  'delete',
  'keycap_invoked',
  'keycap_completed',
  'hotkey_triggered',
  'app_focus_changed',
  'file_saved',
  'cursor_moved',
] as const satisfies readonly OpKind[];
