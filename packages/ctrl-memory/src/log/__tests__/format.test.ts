import {
  EnvelopeInvalidError,
  createCell,
  createKeyframe,
  isKeyframe,
} from '@ctrl/stss';
import { describe, expect, it } from 'vitest';

import { encodeLine, parseLine, splitLines } from '../format.js';

describe('JSONL format', () => {
  it('round-trips an envelope through encode/parse', () => {
    const env = createKeyframe({
      source: 's',
      seq: 1,
      ts_ms: 1_000,
      cells: [createCell({ id: 'a', kind: 'user_input', payload: { text: 'hi' }, ts_ms: 900 })],
    });
    const line = encodeLine(env);
    expect(line).not.toContain('\n');
    const recovered = parseLine(line);
    expect(isKeyframe(recovered)).toBe(true);
    expect(recovered.source).toBe('s');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseLine('{not json}')).toThrow(EnvelopeInvalidError);
  });

  it('throws on valid JSON that is not an envelope', () => {
    expect(() => parseLine(JSON.stringify({ foo: 'bar' }))).toThrow(EnvelopeInvalidError);
  });

  it('splitLines tolerates blank lines, CRLF, trailing whitespace', () => {
    const chunk = '  line-1  \r\n\nline-2\n   \nline-3\r\n';
    expect(splitLines(chunk)).toEqual(['line-1', 'line-2', 'line-3']);
  });
});
