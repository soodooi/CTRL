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
 * Bounded capacity: defaults to 100_000 entries. Once full,
 * {@link append} throws. Callers that genuinely need an unbounded
 * log opt in explicitly via `{ maxEntries: Number.POSITIVE_INFINITY }`
 * — the explicit opt-in flags the production-OOM risk at the call
 * site.
 *
 * @public
 */
export class InMemoryLog implements AppendSink, LineSource {
  private readonly entries: Envelope[] = [];
  private readonly maxEntries: number;
  private closed = false;

  constructor(options: { readonly maxEntries?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 100_000;
  }

  async append(envelope: Envelope): Promise<void> {
    if (this.closed) throw new Error('InMemoryLog is closed');
    if (this.entries.length >= this.maxEntries) {
      throw new Error(
        `InMemoryLog capacity exceeded (max=${this.maxEntries}). Drain via open() or raise maxEntries.`,
      );
    }
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
