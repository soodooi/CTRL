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
 * v0.7 (H-2026-05-20-001): added coding-env kinds — see
 * `.olym/specs/stss-protocol/spec.md` §2.1.1 for payload schemas and
 * `doc/st-ss/coding-env-publisher-contract.md` for the publisher contract.
 *
 * @public
 */
export type CellKind =
  // v0.6 base
  | 'user_input'
  | 'clipboard_snapshot'
  | 'screen_snapshot'
  | 'hardware_reading'
  | 'llm_response'
  | 'tool_result'
  | 'context_snapshot'
  // v0.7 coding-env
  | 'terminal_output'
  | 'terminal_exit'
  | 'lsp_state'
  | 'agent_thinking'
  | 'agent_action'
  | 'env_status'
  | (string & {});

/**
 * Built-in op kinds CTRL recognises. Ops are typed actions — discrete
 * events that happened in time, not state mutations. The exception is
 * `delete`, which is a structural removal from the cell tree.
 *
 * v0.7 (H-2026-05-20-001): added coding-env kinds.
 *
 * @public
 */
export type OpKind =
  // v0.6 base
  | 'delete'
  | 'keycap_invoked'
  | 'keycap_completed'
  | 'hotkey_triggered'
  | 'app_focus_changed'
  | 'file_saved'
  | 'cursor_moved'
  // v0.7 coding-env
  | 'agent_prompt'
  | 'agent_interrupt'
  | 'env_signal'
  | 'file_request'
  | (string & {});

/**
 * Well-known cell kinds as a runtime set. Useful for source endpoints
 * that want to advertise their `cell_kinds` capability without typos.
 *
 * @public
 */
export const KNOWN_CELL_KINDS = [
  // v0.6 base
  'user_input',
  'clipboard_snapshot',
  'screen_snapshot',
  'hardware_reading',
  'llm_response',
  'tool_result',
  'context_snapshot',
  // v0.7 coding-env
  'terminal_output',
  'terminal_exit',
  'lsp_state',
  'agent_thinking',
  'agent_action',
  'env_status',
] as const satisfies readonly CellKind[];

/**
 * Well-known op kinds as a runtime set.
 *
 * @public
 */
export const KNOWN_OP_KINDS = [
  // v0.6 base
  'delete',
  'keycap_invoked',
  'keycap_completed',
  'hotkey_triggered',
  'app_focus_changed',
  'file_saved',
  'cursor_moved',
  // v0.7 coding-env
  'agent_prompt',
  'agent_interrupt',
  'env_signal',
  'file_request',
] as const satisfies readonly OpKind[];

// ─── v0.7 coding-env payload shapes (H-2026-05-20-001) ───
//
// Helper types so TS consumers narrow `payload` per kind. These are
// advisory at compile time — wire format is still arbitrary CBOR per
// envelope.ts. Receivers MUST tolerate fields beyond these.
//
// Schema reference: .olym/specs/stss-protocol/spec.md §2.1.1

/**
 * @public
 */
export interface TerminalOutputPayload {
  terminal_id: string;
  stream: 'stdout' | 'stderr';
  bytes: string;
  encoding?: 'utf8' | 'base64';
  seq?: number;
}

/**
 * @public
 */
export interface TerminalExitPayload {
  terminal_id: string;
  exit_code: number | null;
  signal?: string;
  duration_ms?: number;
}

/**
 * @public
 */
export interface LspDiagnostic {
  severity: 'error' | 'warn' | 'info' | 'hint';
  message: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  source?: string;
}

/**
 * @public
 */
export interface LspSymbol {
  name: string;
  kind: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/**
 * @public
 */
export interface LspStatePayload {
  uri: string;
  language_id: string;
  version?: number;
  diagnostics: LspDiagnostic[];
  symbols?: LspSymbol[];
}

/**
 * @public
 */
export interface AgentThinkingPayload {
  agent_id: string;
  delta: string;
  done: boolean;
  token_count?: number;
  turn_id?: string;
}

/**
 * @public
 */
export type AgentActionKind =
  | 'tool_call'
  | 'file_edit'
  | 'shell_command'
  | 'plan_update'
  | 'task_update';

/**
 * @public
 */
export type AgentActionStatus =
  | 'planned'
  | 'in_progress'
  | 'done'
  | 'failed';

/**
 * @public
 */
export interface AgentActionPayload {
  agent_id: string;
  action_kind: AgentActionKind;
  summary: string;
  status: AgentActionStatus;
  payload: unknown;
  correlates_with?: string;
}

/**
 * @public
 */
export interface EnvStatusPayload {
  env_id: string;
  cpu_pct?: number;
  mem_mb?: number;
  build: 'idle' | 'building' | 'ok' | 'failed';
  tests: 'idle' | 'running' | 'ok' | 'failing';
  last_changed_at_ms: number;
}

/**
 * Discriminated map: cell `kind` → payload shape. Unknown kinds fall
 * through to `unknown` for forward-compat (matches the open extension
 * `(string & {})` on {@link CellKind}).
 *
 * @public
 */
export interface CellPayloadByKind {
  terminal_output: TerminalOutputPayload;
  terminal_exit: TerminalExitPayload;
  lsp_state: LspStatePayload;
  agent_thinking: AgentThinkingPayload;
  agent_action: AgentActionPayload;
  env_status: EnvStatusPayload;
}

/**
 * @public
 */
export interface AgentPromptAttachment {
  kind: 'file' | 'image';
  uri?: string;
  base64?: string;
  mime?: string;
}

/**
 * @public
 */
export interface AgentPromptPayload {
  agent_id: string;
  prompt_id: string;
  content: string;
  attachments?: AgentPromptAttachment[];
}

/**
 * @public
 */
export interface AgentInterruptPayload {
  agent_id: string;
  reason?: string;
}

/**
 * @public
 */
export type EnvSignal =
  | 'SIGINT'
  | 'SIGTERM'
  | 'SIGKILL'
  | 'restart'
  | 'reload_config';

/**
 * @public
 */
export interface EnvSignalPayload {
  env_id: string;
  signal: EnvSignal;
}

/**
 * @public
 */
export interface FileRequestPayload {
  env_id: string;
  request_id: string;
  path: string;
  max_bytes?: number;
}

/**
 * Discriminated map: op `kind` → payload shape.
 *
 * @public
 */
export interface OpPayloadByKind {
  agent_prompt: AgentPromptPayload;
  agent_interrupt: AgentInterruptPayload;
  env_signal: EnvSignalPayload;
  file_request: FileRequestPayload;
}

/**
 * Convenience aliases for downstream consumers.
 *
 * @public
 */
export type CodingCellKind = keyof CellPayloadByKind;

/**
 * @public
 */
export type CodingOpKind = keyof OpPayloadByKind;
