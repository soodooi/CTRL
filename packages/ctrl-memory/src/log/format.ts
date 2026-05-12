/**
 * JSONL line format helpers for the append-only log.
 *
 * One envelope per line, UTF-8, terminated by `\n`. Easy to inspect
 * with `tail -f`, easy to diff, easy to back up.
 *
 * @packageDocumentation
 */

import {
  EnvelopeInvalidError,
  type Envelope,
  isEnvelope,
} from '@ctrl/stss';

/**
 * Encode an envelope as a JSONL line (without trailing newline).
 *
 * @public
 */
export function encodeLine(envelope: Envelope): string {
  return JSON.stringify(envelope);
}

/**
 * Parse a single JSONL line. Throws {@link EnvelopeInvalidError} on
 * malformed input.
 *
 * @public
 */
export function parseLine(line: string): Envelope {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (cause) {
    throw new EnvelopeInvalidError('JSONL parse failed', { cause });
  }
  if (!isEnvelope(value)) {
    throw new EnvelopeInvalidError('JSONL line is not a valid Envelope');
  }
  return value;
}

/**
 * Split a chunk of JSONL into trimmed non-empty lines. Tolerant of
 * blank lines, trailing whitespace, CRLF.
 *
 * @public
 */
export function splitLines(chunk: string): readonly string[] {
  return chunk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
