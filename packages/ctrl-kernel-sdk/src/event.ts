// Event — ST-SS cell + op unified message format.
// Mirrors L1 Kernel Event enum (Rust).

export type Event = Cell | Op;

export interface Cell {
  readonly type: 'cell';
  readonly kind: CellKind;
  readonly tsMs: number;
  readonly streamId?: string;
  readonly payload: unknown; // CBOR-decoded shape
}

export interface Op {
  readonly type: 'op';
  readonly kind: OpKind;
  readonly tsMs: number;
  readonly streamId?: string;
  readonly payload: unknown;
}

export type CellKind =
  | 'user_input'
  | 'clipboard_snapshot'
  | 'screen_snapshot'
  | 'hardware_reading'
  | 'llm_response'
  | 'mcp_tool_result'
  | 'api_response'
  | 'context_snapshot';

export type OpKind =
  | 'mcp_invoked'
  | 'mcp_completed'
  | 'mcp_failed'
  | 'actor_spawned'
  | 'actor_terminated'
  | 'hotkey_triggered'
  | 'llm_call_started'
  | 'llm_call_chunk'
  | 'llm_call_finished'
  | 'app_focus_changed'
  | 'file_saved'
  | 'cursor_moved';

export interface EventFilter {
  readonly cellKind?: CellKind;
  readonly opKind?: OpKind;
  readonly streamId?: string;
  readonly payloadMatch?: Record<string, unknown>;
}
