/**
 * Default {@link MemoryReader} — composes a {@link LineSource} with
 * a {@link DefaultReducer} (from `@ctrl/stss`).
 *
 * @packageDocumentation
 */

import {
  type CellTreeSnapshot,
  DefaultReducer,
  type Envelope,
} from '@ctrl/stss';

import type { LineSource } from '../log/types.js';
import { matchesFilter, type EnvelopeFilter } from '../types.js';
import type { MemoryReader } from './types.js';

/**
 * Default reader implementation.
 *
 * @public
 */
export class DefaultMemoryReader implements MemoryReader {
  private reducer = new DefaultReducer();

  constructor(private readonly source: LineSource) {}

  async *iterate(filter?: EnvelopeFilter): AsyncIterableIterator<Envelope> {
    for await (const env of this.source.open()) {
      if (matchesFilter(env, filter)) {
        yield env;
      }
    }
  }

  current(): CellTreeSnapshot {
    return this.reducer.current();
  }

  applyEnvelope(envelope: Envelope): void {
    this.reducer.apply(envelope);
  }

  async seekToSeq(seq: number): Promise<void> {
    this.reducer.reset();
    for await (const env of this.source.open()) {
      if (env.seq > seq) break;
      this.reducer.apply(env);
    }
  }

  async seekToTime(tsMs: number): Promise<void> {
    this.reducer.reset();
    for await (const env of this.source.open()) {
      if (env.ts_ms > tsMs) break;
      this.reducer.apply(env);
    }
  }

  reset(): void {
    this.reducer.reset();
  }
}
