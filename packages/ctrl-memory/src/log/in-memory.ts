/**
 * In-memory append-only log. The simplest backend, useful for tests,
 * dev replay, and the kernel-bridge stub (until P3.5 wires real
 * persistence).
 *
 * @packageDocumentation
 */

import type { Envelope } from '@ctrl/stss';

import type { AppendSink, LineSource } from './types.js';

/**
 * In-memory, append-only envelope log.
 *
 * Implements both {@link AppendSink} (write side) and {@link LineSource}
 * (read side) so dev / test setups need only one instance.
 *
 * @public
 */
export class InMemoryLog implements AppendSink, LineSource {
  private readonly entries: Envelope[] = [];
  private closed = false;

  async append(envelope: Envelope): Promise<void> {
    if (this.closed) throw new Error('InMemoryLog is closed');
    this.entries.push(envelope);
  }

  async size(): Promise<number> {
    return this.entries.length;
  }

  open(): AsyncIterableIterator<Envelope> {
    // Snapshot at open time. Subsequent appends do NOT appear in
    // this iterator — callers that want live tail should open again
    // after waiting. This matches the AppendSink/LineSource split:
    // sinks are write-side, sources are read-side.
    const snapshot = [...this.entries];
    let i = 0;
    const iter: AsyncIterableIterator<Envelope> = {
      [Symbol.asyncIterator]() {
        return iter;
      },
      async next() {
        if (i >= snapshot.length) {
          return { value: undefined, done: true };
        }
        const env = snapshot[i]!;
        i += 1;
        return { value: env, done: false };
      },
    };
    return iter;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /**
   * @internal — synchronous accessor for tests. Production code uses
   * {@link open}.
   */
  _entriesSnapshot(): readonly Envelope[] {
    return this.entries;
  }
}
