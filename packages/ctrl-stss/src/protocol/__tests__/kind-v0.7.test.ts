/**
 * v0.7 coding-env vocabulary tests (H-2026-05-20-001, themis tier B H1).
 *
 * Two layers:
 * 1. Type-level: each `CellPayloadByKind` / `OpPayloadByKind` slot
 *    structurally matches its named interface (`satisfies` is the gate —
 *    breaking the shape fails `tsc --noEmit`).
 * 2. Runtime smoke: a representative payload per kind plugs through
 *    `createCell` / `createOp` and survives JSON round-trip without
 *    field loss (CBOR-encodable shape).
 */

import { describe, expect, it } from 'vitest';

import {
  KNOWN_CELL_KINDS,
  KNOWN_OP_KINDS,
  createCell,
  createOp,
} from '../../index.js';
import type {
  AgentActionPayload,
  AgentInterruptPayload,
  AgentPromptAttachment,
  AgentPromptPayload,
  AgentThinkingPayload,
  CellKind,
  CellPayloadByKind,
  CodingCellKind,
  CodingOpKind,
  EnvSignal,
  EnvSignalPayload,
  EnvStatusPayload,
  FileRequestPayload,
  LspDiagnostic,
  LspStatePayload,
  LspSymbol,
  OpKind,
  OpPayloadByKind,
  TerminalExitPayload,
  TerminalOutputPayload,
} from '../kind.js';

const V07_CELL_KINDS = [
  'terminal_output',
  'terminal_exit',
  'lsp_state',
  'agent_thinking',
  'agent_action',
  'env_status',
] as const satisfies readonly CodingCellKind[];

const V07_OP_KINDS = [
  'agent_prompt',
  'agent_interrupt',
  'env_signal',
  'file_request',
] as const satisfies readonly CodingOpKind[];

describe('v0.7 — KNOWN_* runtime sets', () => {
  it('KNOWN_CELL_KINDS contains every v0.7 coding-env cell kind', () => {
    for (const kind of V07_CELL_KINDS) {
      expect(KNOWN_CELL_KINDS).toContain(kind);
    }
  });

  it('KNOWN_OP_KINDS contains every v0.7 coding-env op kind', () => {
    for (const kind of V07_OP_KINDS) {
      expect(KNOWN_OP_KINDS).toContain(kind);
    }
  });

  it('coding-env kinds are assignable to base CellKind/OpKind unions', () => {
    const cell: CellKind = V07_CELL_KINDS[0];
    const op: OpKind = V07_OP_KINDS[0];
    expect(cell).toBe('terminal_output');
    expect(op).toBe('agent_prompt');
  });
});

describe('v0.7 — CellPayloadByKind shapes', () => {
  it('terminal_output: minimal + base64 form both type-check and round-trip', () => {
    const minimal = {
      terminal_id: 't1',
      stream: 'stdout',
      bytes: 'hello\n',
    } satisfies TerminalOutputPayload satisfies CellPayloadByKind['terminal_output'];

    const full = {
      terminal_id: 't1',
      stream: 'stderr',
      bytes: 'aGVsbG8=',
      encoding: 'base64',
      seq: 42,
    } satisfies TerminalOutputPayload;

    for (const payload of [minimal, full]) {
      const cell = createCell({ id: payload.terminal_id, kind: 'terminal_output', payload });
      const roundTrip = JSON.parse(JSON.stringify(cell.payload)) as TerminalOutputPayload;
      expect(roundTrip.terminal_id).toBe(payload.terminal_id);
      expect(roundTrip.stream).toBe(payload.stream);
      expect(roundTrip.bytes).toBe(payload.bytes);
    }
  });

  it('terminal_exit: required + optional fields preserved', () => {
    const payload = {
      terminal_id: 't1',
      exit_code: 0,
      signal: undefined,
      duration_ms: 4280,
    } satisfies TerminalExitPayload satisfies CellPayloadByKind['terminal_exit'];

    const cell = createCell({ id: 't1.exit', kind: 'terminal_exit', payload });
    expect((cell.payload as TerminalExitPayload).exit_code).toBe(0);

    const killed = { terminal_id: 't2', exit_code: null, signal: 'SIGINT' } satisfies TerminalExitPayload;
    expect(killed.exit_code).toBeNull();
  });

  it('lsp_state: diagnostics + symbols structures hold', () => {
    const diag: LspDiagnostic = {
      severity: 'error',
      message: "Cannot find name 'foo'",
      range: { start: { line: 10, character: 4 }, end: { line: 10, character: 7 } },
      source: 'tsserver',
    };
    const sym: LspSymbol = {
      name: 'foo',
      kind: 'function',
      range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
    };
    const payload = {
      uri: 'file:///src/app.ts',
      language_id: 'typescript',
      version: 7,
      diagnostics: [diag],
      symbols: [sym],
    } satisfies LspStatePayload satisfies CellPayloadByKind['lsp_state'];

    const cell = createCell({ id: payload.uri, kind: 'lsp_state', payload });
    const parsed = JSON.parse(JSON.stringify(cell.payload)) as LspStatePayload;
    expect(parsed.diagnostics).toHaveLength(1);
    expect(parsed.diagnostics[0].severity).toBe('error');
    expect(parsed.symbols?.[0].name).toBe('foo');
  });

  it('agent_thinking: streaming sequence with terminal done:true', () => {
    const streaming = [
      { agent_id: 'claude-1', delta: 'Let me ', done: false, turn_id: 'turn-1' },
      { agent_id: 'claude-1', delta: 'check the file', done: false, turn_id: 'turn-1' },
      { agent_id: 'claude-1', delta: '.', done: true, turn_id: 'turn-1', token_count: 8 },
    ] satisfies AgentThinkingPayload[] satisfies CellPayloadByKind['agent_thinking'][];

    expect(streaming.filter((p) => p.done)).toHaveLength(1);
    expect(streaming.map((p) => p.delta).join('')).toBe('Let me check the file.');
  });

  it('agent_action: every action_kind × every status combo type-checks', () => {
    const kinds = ['tool_call', 'file_edit', 'shell_command', 'plan_update', 'task_update'] as const;
    const statuses = ['planned', 'in_progress', 'done', 'failed'] as const;
    for (const action_kind of kinds) {
      for (const status of statuses) {
        const payload = {
          agent_id: 'a-1',
          action_kind,
          summary: `${action_kind} → ${status}`,
          status,
          payload: { example: true },
          correlates_with: 'p-1',
        } satisfies AgentActionPayload satisfies CellPayloadByKind['agent_action'];
        expect(payload.action_kind).toBe(action_kind);
        expect(payload.status).toBe(status);
      }
    }
  });

  it('env_status: 4-state enums for build + tests', () => {
    const builds = ['idle', 'building', 'ok', 'failed'] as const;
    const tests = ['idle', 'running', 'ok', 'failing'] as const;
    for (const build of builds) {
      for (const test of tests) {
        const payload = {
          env_id: 'lane-C',
          cpu_pct: 42,
          mem_mb: 1230,
          build,
          tests: test,
          last_changed_at_ms: 1716200000000,
        } satisfies EnvStatusPayload satisfies CellPayloadByKind['env_status'];
        expect(payload.build).toBe(build);
        expect(payload.tests).toBe(test);
      }
    }
  });
});

describe('v0.7 — OpPayloadByKind shapes', () => {
  it('agent_prompt: with + without attachments', () => {
    const attachment: AgentPromptAttachment = {
      kind: 'file',
      uri: 'file:///src/app.spec.ts',
      mime: 'text/typescript',
    };
    const payload = {
      agent_id: 'claude-1',
      prompt_id: 'p-9af2',
      content: 'fix the failing test',
      attachments: [attachment],
    } satisfies AgentPromptPayload satisfies OpPayloadByKind['agent_prompt'];

    const op = createOp({ kind: 'agent_prompt', target: payload.agent_id, payload });
    const parsed = JSON.parse(JSON.stringify(op.payload)) as AgentPromptPayload;
    expect(parsed.attachments?.[0].kind).toBe('file');

    const noAtt: AgentPromptPayload = {
      agent_id: 'claude-1',
      prompt_id: 'p-2',
      content: 'just text',
    };
    expect(noAtt.attachments).toBeUndefined();
  });

  it('agent_interrupt: minimum shape + with reason', () => {
    const a = { agent_id: 'claude-1' } satisfies AgentInterruptPayload satisfies OpPayloadByKind['agent_interrupt'];
    const b = { agent_id: 'claude-1', reason: 'user pressed Esc' } satisfies AgentInterruptPayload;
    expect(a.agent_id).toBe('claude-1');
    expect(b.reason).toBe('user pressed Esc');
  });

  it('env_signal: every signal value type-checks', () => {
    const signals: readonly EnvSignal[] = ['SIGINT', 'SIGTERM', 'SIGKILL', 'restart', 'reload_config'];
    for (const signal of signals) {
      const payload = { env_id: 'lane-C', signal } satisfies EnvSignalPayload satisfies OpPayloadByKind['env_signal'];
      expect(payload.signal).toBe(signal);
    }
  });

  it('file_request: required + max_bytes default convention', () => {
    const payload = {
      env_id: 'lane-C',
      request_id: 'r-1a',
      path: 'src/app.ts',
      max_bytes: 65536,
    } satisfies FileRequestPayload satisfies OpPayloadByKind['file_request'];

    const op = createOp({ kind: 'file_request', target: payload.env_id, payload });
    expect((op.payload as FileRequestPayload).request_id).toBe('r-1a');
  });
});

describe('v0.7 — CodingCellKind / CodingOpKind aliases', () => {
  it('CodingCellKind keys exactly match the CellPayloadByKind map', () => {
    // Building this object forces TS to enumerate keys of CellPayloadByKind;
    // if the alias drifts from the map this fails to compile.
    const keys: Record<CodingCellKind, true> = {
      terminal_output: true,
      terminal_exit: true,
      lsp_state: true,
      agent_thinking: true,
      agent_action: true,
      env_status: true,
    };
    expect(Object.keys(keys).sort()).toEqual([...V07_CELL_KINDS].sort());
  });

  it('CodingOpKind keys exactly match the OpPayloadByKind map', () => {
    const keys: Record<CodingOpKind, true> = {
      agent_prompt: true,
      agent_interrupt: true,
      env_signal: true,
      file_request: true,
    };
    expect(Object.keys(keys).sort()).toEqual([...V07_OP_KINDS].sort());
  });
});
