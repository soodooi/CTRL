import { describe, expect, it } from 'vitest';

import {
  EnvelopeInvalidError,
  JsonEncoder,
  createCell,
  createKeyframe,
  isKeyframe,
} from '../../index.js';

describe('JsonEncoder', () => {
  it('round-trips a keyframe envelope', () => {
    const enc = new JsonEncoder();
    const env = createKeyframe({
      source: 's',
      seq: 1,
      ts_ms: 1_000,
      cells: [createCell({ id: 'a', kind: 'user_input', payload: { text: 'hi' }, ts_ms: 900 })],
    });

    const bytes = enc.encode(env);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);

    const recovered = enc.decode(bytes);
    expect(isKeyframe(recovered)).toBe(true);
    if (isKeyframe(recovered)) {
      expect(recovered.source).toBe('s');
      expect(recovered.payload.cells[0]?.id).toBe('a');
    }
  });

  it('advertises application/json content type', () => {
    const enc = new JsonEncoder();
    expect(enc.contentType).toBe('application/json');
  });

  it('throws EnvelopeInvalidError on malformed JSON', () => {
    const enc = new JsonEncoder();
    const bad = new TextEncoder().encode('{not json}');
    expect(() => enc.decode(bad)).toThrow(EnvelopeInvalidError);
  });

  it('throws EnvelopeInvalidError on valid JSON that is not an envelope', () => {
    const enc = new JsonEncoder();
    const bad = new TextEncoder().encode(JSON.stringify({ hello: 'world' }));
    expect(() => enc.decode(bad)).toThrow(EnvelopeInvalidError);
  });
});
