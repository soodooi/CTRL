import { describe, expect, it } from 'vitest';

import {
  DefaultReducer,
  EnvelopeInvalidError,
  MissingKeyframeError,
  createCell,
  createDelta,
  createError,
  createHeartbeat,
  createKeyframe,
  createOp,
} from '../../index.js';

const SOURCE = 'mac-home:1';

describe('DefaultReducer', () => {
  it('starts empty', () => {
    const r = new DefaultReducer();
    expect(r.current().cells.size).toBe(0);
    expect(r.current().lastKeyframeSeq).toBeNull();
  });

  it('applies a keyframe and records lastKeyframeSeq', () => {
    const r = new DefaultReducer();
    const kf = createKeyframe({
      source: SOURCE,
      seq: 10,
      ts_ms: 1_000,
      cells: [
        createCell({ id: 'a', kind: 'user_input', payload: { text: 'hi' }, ts_ms: 900 }),
        createCell({ id: 'b', kind: 'clipboard_snapshot', payload: { text: 'x' }, ts_ms: 950 }),
      ],
    });

    const { snapshot, semanticOps } = r.apply(kf);
    expect(snapshot.cells.size).toBe(2);
    expect(snapshot.cells.get('a')?.kind).toBe('user_input');
    expect(snapshot.lastKeyframeSeq).toBe(10);
    expect(snapshot.lastSeq).toBe(10);
    expect(snapshot.source).toBe(SOURCE);
    expect(snapshot.updatedAtMs).toBe(1_000);
    expect(semanticOps).toHaveLength(0);
  });

  it('applies a delta: cells are insert-or-update by id', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [
          createCell({ id: 'a', kind: 'user_input', payload: { text: 'hi' }, ts_ms: 900 }),
        ],
      }),
    );

    const df = createDelta({
      source: SOURCE,
      seq: 11,
      ref: 10,
      ts_ms: 1_100,
      cells: [
        createCell({ id: 'a', kind: 'user_input', payload: { text: 'hello' }, ts_ms: 1_050 }),
        createCell({ id: 'c', kind: 'tool_result', payload: { ok: true }, ts_ms: 1_080 }),
      ],
    });

    const { snapshot } = r.apply(df);
    expect(snapshot.cells.size).toBe(2);
    const a = snapshot.cells.get('a');
    expect(a).toBeDefined();
    expect((a?.payload as { text: string }).text).toBe('hello');
    expect(snapshot.cells.get('c')?.kind).toBe('tool_result');
    expect(snapshot.lastSeq).toBe(11);
    expect(snapshot.lastKeyframeSeq).toBe(10); // unchanged
  });

  it('applies a delta with delete op: removes by target id', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [
          createCell({ id: 'a', kind: 'user_input', payload: { text: 'hi' }, ts_ms: 900 }),
          createCell({ id: 'b', kind: 'clipboard_snapshot', payload: { text: 'x' }, ts_ms: 950 }),
        ],
      }),
    );

    const df = createDelta({
      source: SOURCE,
      seq: 11,
      ref: 10,
      ops: [createOp({ kind: 'delete', target: 'b', ts_ms: 1_100 })],
    });
    const { snapshot, semanticOps } = r.apply(df);
    expect(snapshot.cells.size).toBe(1);
    expect(snapshot.cells.has('b')).toBe(false);
    expect(snapshot.cells.has('a')).toBe(true);
    expect(semanticOps).toHaveLength(0);
  });

  it('returns non-delete ops as semanticOps without state change', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 900 })],
      }),
    );

    const df = createDelta({
      source: SOURCE,
      seq: 11,
      ref: 10,
      ops: [
        createOp({
          kind: 'mcp_invoked',
          target: 'clipboard-ai',
          payload: { mode: 'rewrite' },
          ts_ms: 1_100,
        }),
        createOp({ kind: 'file_saved', target: '/tmp/x.ts', ts_ms: 1_150 }),
      ],
    });

    const { snapshot, semanticOps } = r.apply(df);
    expect(snapshot.cells.size).toBe(1); // unchanged
    expect(semanticOps).toHaveLength(2);
    expect(semanticOps[0]?.kind).toBe('mcp_invoked');
    expect(semanticOps[1]?.kind).toBe('file_saved');
  });

  it('throws MissingKeyframeError when delta arrives before a keyframe', () => {
    const r = new DefaultReducer();
    const df = createDelta({ source: SOURCE, seq: 5, ref: 0, ops: [] });
    expect(() => r.apply(df)).toThrow(MissingKeyframeError);
  });

  it('heartbeat / control / handshake envelopes leave the cell state unchanged', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 900 })],
      }),
    );
    const beforeSize = r.current().cells.size;
    const beforeKfSeq = r.current().lastKeyframeSeq;
    r.apply(createHeartbeat({ source: SOURCE, seq: 11, ts_ms: 1_100 }));
    const after = r.current();
    // Behavioral assertion: cell state survives; object identity is
    // a memoization detail not asserted here.
    expect(after.cells.size).toBe(beforeSize);
    expect(after.lastKeyframeSeq).toBe(beforeKfSeq);
  });

  it('error envelope returns the envelope on errors[] with snapshot unchanged', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 900 })],
      }),
    );
    const result = r.apply(
      createError({
        source: SOURCE,
        seq: 11,
        code: 'TEST_ERROR',
        message: 'remote signaled failure',
      }),
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.payload.code).toBe('TEST_ERROR');
    expect(result.semanticOps).toHaveLength(0);
    expect(result.snapshot.cells.size).toBe(1);
  });

  it('non-error envelopes return empty errors array', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 900 })],
      }),
    );
    const hb = r.apply(createHeartbeat({ source: SOURCE, seq: 11, ts_ms: 1_100 }));
    expect(hb.errors).toEqual([]);
  });

  it('reset returns to empty snapshot', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 900 })],
      }),
    );
    r.reset();
    expect(r.current().cells.size).toBe(0);
    expect(r.current().lastKeyframeSeq).toBeNull();
  });

  it('reset gives each reducer its own fresh cell map (no shared module-level state)', () => {
    const a = new DefaultReducer();
    const b = new DefaultReducer();
    // Force both reducers through reset()
    a.reset();
    b.reset();
    const aSnap = a.current();
    const bSnap = b.current();
    expect(aSnap).not.toBe(bSnap);
    expect(aSnap.cells).not.toBe(bSnap.cells);
  });

  it('rejects a cross-source delta with EnvelopeInvalidError', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: 's1',
        seq: 10,
        ts_ms: 1_000,
        cells: [createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 900 })],
      }),
    );
    const wrongSource = createDelta({
      source: 's2',
      seq: 11,
      ref: 10,
      ts_ms: 1_100,
      cells: [createCell({ id: 'b', kind: 'user_input', payload: {}, ts_ms: 1_050 })],
    });
    expect(() => r.apply(wrongSource)).toThrow(EnvelopeInvalidError);
  });

  it('rejects a delete op missing target with EnvelopeInvalidError', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 900 })],
      }),
    );
    // Craft a delete with missing target — must bypass createDeleteOp's own guard
    const malformed = createOp({ kind: 'delete', ts_ms: 1_100 });
    const df = createDelta({
      source: SOURCE,
      seq: 11,
      ref: 10,
      ts_ms: 1_100,
      ops: [malformed],
    });
    expect(() => r.apply(df)).toThrow(EnvelopeInvalidError);
  });

  it('delete on a missing target is idempotent (Map.delete no-op)', () => {
    const r = new DefaultReducer();
    r.apply(
      createKeyframe({
        source: SOURCE,
        seq: 10,
        ts_ms: 1_000,
        cells: [createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 900 })],
      }),
    );
    const df = createDelta({
      source: SOURCE,
      seq: 11,
      ref: 10,
      ops: [createOp({ kind: 'delete', target: 'never-existed', ts_ms: 1_100 })],
    });
    const { snapshot } = r.apply(df);
    expect(snapshot.cells.size).toBe(1);
    expect(snapshot.cells.has('a')).toBe(true);
  });
});
