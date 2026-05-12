import { describe, expect, it } from 'vitest';

import {
  createCell,
  createDeleteOp,
  createDelta,
  createHeartbeat,
  createKeyframe,
  createOp,
  isDeleteOp,
} from '../../index.js';

describe('createCell invariants', () => {
  it('rejects empty id', () => {
    expect(() => createCell({ id: '', kind: 'user_input', payload: {} })).toThrow(RangeError);
  });

  it('rejects negative ts_ms', () => {
    expect(() =>
      createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: -1 }),
    ).toThrow(RangeError);
  });

  it('rejects non-finite ts_ms', () => {
    expect(() =>
      createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });

  it('accepts ts_ms = 0 (epoch)', () => {
    expect(() => createCell({ id: 'a', kind: 'user_input', payload: {}, ts_ms: 0 })).not.toThrow();
  });
});

describe('createOp / createDeleteOp invariants', () => {
  it('createOp rejects negative ts_ms', () => {
    expect(() => createOp({ kind: 'keycap_invoked', ts_ms: -1 })).toThrow(RangeError);
  });

  it('createDeleteOp rejects empty target', () => {
    expect(() => createDeleteOp('')).toThrow(RangeError);
  });

  it('createDeleteOp returns a value that narrows via isDeleteOp', () => {
    const op = createDeleteOp('cell-x');
    expect(isDeleteOp(op)).toBe(true);
  });

  it('isDeleteOp rejects a delete op with missing target', () => {
    const malformed = createOp({ kind: 'delete', ts_ms: 100 });
    expect(isDeleteOp(malformed)).toBe(false);
  });

  it('isDeleteOp rejects a non-delete kind', () => {
    const op = createOp({ kind: 'keycap_invoked', target: 'x', ts_ms: 100 });
    expect(isDeleteOp(op)).toBe(false);
  });
});

describe('envelope constructor invariants', () => {
  it('rejects empty source', () => {
    expect(() => createHeartbeat({ source: '', seq: 0 })).toThrow(RangeError);
  });

  it('rejects negative seq', () => {
    expect(() => createHeartbeat({ source: 's', seq: -1 })).toThrow(RangeError);
  });

  it('rejects non-integer seq', () => {
    expect(() => createHeartbeat({ source: 's', seq: 1.5 })).toThrow(RangeError);
    expect(() => createHeartbeat({ source: 's', seq: Number.NaN })).toThrow(RangeError);
  });

  it('rejects negative ts_ms in envelope', () => {
    expect(() => createKeyframe({ source: 's', seq: 0, ts_ms: -1, cells: [] })).toThrow(
      RangeError,
    );
  });

  it('accepts seq = 0 (initial handshake)', () => {
    expect(() => createHeartbeat({ source: 's', seq: 0 })).not.toThrow();
  });

  it('createDelta rejects ref >= seq', () => {
    expect(() => createDelta({ source: 's', seq: 5, ref: 5 })).toThrow(RangeError);
    expect(() => createDelta({ source: 's', seq: 5, ref: 6 })).toThrow(RangeError);
  });

  it('createDelta rejects negative ref', () => {
    expect(() => createDelta({ source: 's', seq: 5, ref: -1 })).toThrow(RangeError);
  });

  it('createDelta accepts ref = 0 with seq > 0', () => {
    expect(() => createDelta({ source: 's', seq: 1, ref: 0 })).not.toThrow();
  });
});
