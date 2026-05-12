import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_FRAME_BYTES,
  FrameDecoder,
  FramingOversizedError,
  decodeFrame,
  encodeFrame,
} from '../index.js';

const encoder = new TextEncoder();

describe('length-prefix framing', () => {
  it('round-trips a single frame', () => {
    const payload = encoder.encode('hello world');
    const frame = encodeFrame(payload);
    expect(frame.byteLength).toBe(4 + payload.byteLength);

    const decoded = decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(decoded?.payload).toEqual(payload);
    expect(decoded?.nextOffset).toBe(frame.byteLength);
  });

  it('returns null when buffer is too short for the prefix', () => {
    expect(decodeFrame(new Uint8Array(3))).toBeNull();
  });

  it('returns null when buffer holds prefix but partial payload', () => {
    const payload = encoder.encode('xxxxx');
    const full = encodeFrame(payload);
    expect(decodeFrame(full.subarray(0, 6))).toBeNull();
  });

  it('throws FramingOversizedError when length exceeds the limit', () => {
    const bogus = new Uint8Array(4);
    new DataView(bogus.buffer).setUint32(0, 1024, false);
    expect(() => decodeFrame(bogus, { maxBytes: 512 })).toThrow(FramingOversizedError);
  });

  it('FrameDecoder yields multiple frames from a single chunk', () => {
    const f1 = encodeFrame(encoder.encode('one'));
    const f2 = encodeFrame(encoder.encode('two'));
    const combined = new Uint8Array(f1.byteLength + f2.byteLength);
    combined.set(f1, 0);
    combined.set(f2, f1.byteLength);

    const decoder = new FrameDecoder();
    const frames = decoder.push(combined);
    expect(frames).toHaveLength(2);
    expect(new TextDecoder().decode(frames[0])).toBe('one');
    expect(new TextDecoder().decode(frames[1])).toBe('two');
    expect(decoder.bufferedBytes()).toBe(0);
  });

  it('FrameDecoder push returns independent slices that survive subsequent pushes', () => {
    const decoder = new FrameDecoder();
    const f1 = encodeFrame(encoder.encode('first'));
    const f2 = encodeFrame(encoder.encode('second'));
    const [returned1] = decoder.push(f1);
    const snapshot1 = new TextDecoder().decode(returned1);
    // Next push reassigns the internal buffer — the previously
    // returned payload MUST NOT be a live view into it.
    decoder.push(f2);
    expect(new TextDecoder().decode(returned1)).toBe(snapshot1);
    expect(snapshot1).toBe('first');
  });

  it('FrameDecoder buffers across partial chunks', () => {
    const payload = encoder.encode('streamed');
    const frame = encodeFrame(payload);

    const decoder = new FrameDecoder();
    const a = decoder.push(frame.subarray(0, 5));
    expect(a).toHaveLength(0);
    expect(decoder.bufferedBytes()).toBe(5);
    expect(decoder.expectedNext()).toBe(payload.byteLength);

    const b = decoder.push(frame.subarray(5));
    expect(b).toHaveLength(1);
    expect(new TextDecoder().decode(b[0])).toBe('streamed');
  });

  it('exposes a sane default frame size limit', () => {
    expect(DEFAULT_MAX_FRAME_BYTES).toBe(16 * 1024 * 1024);
  });
});
