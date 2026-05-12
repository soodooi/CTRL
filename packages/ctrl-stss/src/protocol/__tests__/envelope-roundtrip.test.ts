import { describe, expect, it } from 'vitest';

import {
  createBye,
  createCell,
  createControl,
  createDelta,
  createError,
  createHeartbeat,
  createHello,
  createKeyframe,
  createOp,
  createWelcome,
  isBye,
  isControl,
  isDelta,
  isEnvelope,
  isError,
  isHeartbeat,
  isHello,
  isKeyframe,
  isOp,
  isWelcome,
  PROTOCOL_VERSION,
} from '../index.js';

describe('envelope round-trip', () => {
  it('creates a keyframe with cells and survives JSON serialisation', () => {
    const cells = [
      createCell({
        id: 'clipboard',
        kind: 'clipboard_snapshot',
        payload: { text: 'hello', mime: 'text/plain' },
        ts_ms: 1_000,
      }),
      createCell({
        id: 'thermostat',
        kind: 'hardware_reading',
        payload: { temp_c: 24.5 },
        ts_ms: 1_100,
        attrs: { unit: 'metric' },
      }),
    ];

    const env = createKeyframe({
      source: 'mac-home:42',
      seq: 100,
      ts_ms: 1_200,
      cells,
    });

    const round = JSON.parse(JSON.stringify(env));
    expect(isEnvelope(round)).toBe(true);
    expect(isKeyframe(round)).toBe(true);
    expect(round.v).toBe(PROTOCOL_VERSION);
    expect(round.payload.cells).toHaveLength(2);
    expect(round.payload.cells[0]?.kind).toBe('clipboard_snapshot');
    expect(round.payload.cells[1]?.attrs?.unit).toBe('metric');
  });

  it('creates a delta with both cells and ops', () => {
    const env = createDelta({
      source: 'mac-home:42',
      seq: 101,
      ref: 100,
      cells: [
        createCell({
          id: 'clipboard',
          kind: 'clipboard_snapshot',
          payload: { text: 'hello world', mime: 'text/plain' },
          ts_ms: 2_000,
        }),
      ],
      ops: [
        createOp({
          kind: 'keycap_invoked',
          target: 'clipboard-ai',
          payload: { mode: 'rewrite' },
          ts_ms: 2_100,
        }),
      ],
    });

    const round = JSON.parse(JSON.stringify(env));
    expect(isEnvelope(round)).toBe(true);
    expect(isDelta(round)).toBe(true);
    expect(round.ref).toBe(100);
    expect(round.payload.cells).toHaveLength(1);
    expect(round.payload.ops).toHaveLength(1);
    expect(isOp(round.payload.ops[0])).toBe(true);
  });

  it('creates handshake envelopes carrying capability bag', () => {
    const hello = createHello({
      source: 'mac-home:42',
      seq: 0,
      role: 'sender',
      stream_id: 'clipboard-stream',
      capabilities: {
        cell_kinds: ['clipboard_snapshot'],
        needs_capability: ['ClipboardRead'],
      },
      intent: 'ctrl-keycap',
    });

    const welcome = createWelcome({
      source: 'ctrl-kernel',
      seq: 1,
      session_id: 'sess-abc',
      server_clock_ms: 5_000,
      accepted_capabilities: { cell_kinds: ['clipboard_snapshot'] },
    });

    expect(isHello(hello)).toBe(true);
    expect(hello.payload.stream_id).toBe('clipboard-stream');
    expect(hello.payload.capabilities?.needs_capability).toEqual(['ClipboardRead']);

    expect(isWelcome(welcome)).toBe(true);
    expect(welcome.payload.protocol_version).toBe(PROTOCOL_VERSION);
    expect(welcome.payload.session_id).toBe('sess-abc');
  });

  it('creates remaining envelope variants and discriminates them', () => {
    const hb = createHeartbeat({ source: 's', seq: 1 });
    const ctl = createControl({
      source: 's',
      seq: 2,
      payload: { action: 'request-keyframe', stream_id: 's' },
    });
    const err = createError({ source: 's', seq: 3, code: 'X', message: 'boom' });
    const bye = createBye({ source: 's', seq: 4, reason: 'idle' });

    expect(isHeartbeat(hb)).toBe(true);
    expect(isControl(ctl)).toBe(true);
    expect(isError(err)).toBe(true);
    expect(isBye(bye)).toBe(true);
  });

  it('rejects malformed envelopes via isEnvelope', () => {
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope({})).toBe(false);
    expect(isEnvelope({ v: 1, type: 'invalid', source: 's', seq: 0, ts_ms: 0, payload: {} })).toBe(
      false,
    );
    expect(isEnvelope({ v: 99, type: 'heartbeat', source: 's', seq: 0, ts_ms: 0, payload: {} })).toBe(
      false,
    );
  });

  it('defaults ts_ms via Date.now when omitted', () => {
    const before = Date.now();
    const env = createHeartbeat({ source: 's', seq: 0 });
    const after = Date.now();
    expect(env.ts_ms).toBeGreaterThanOrEqual(before);
    expect(env.ts_ms).toBeLessThanOrEqual(after);
  });
});
