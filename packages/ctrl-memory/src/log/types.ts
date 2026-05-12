/**
 * Log layer — append-only sinks and ordered line sources.
 *
 * The log is the source of truth (event-sourced); indexes (a later
 * sprint) are derived data that can be rebuilt from the log.
 *
 * @packageDocumentation
 */

import type { Envelope } from '@ctrl/stss';

/**
 * Append-only sink for envelopes. Implementations: in-memory,
 * file-backed JSONL (later), Tauri bridge to kernel SQLite (later).
 *
 * @public
 */
export interface AppendSink {
  append(envelope: Envelope): Promise<void>;
  /**
   * Number of envelopes the sink has persisted. Useful for tests and
   * for "did we lose anything?" assertions; backends MAY return -1
   * when the count is not cheaply available.
   */
  size(): Promise<number>;
  close(): Promise<void>;
}

/**
 * Ordered source of previously-persisted envelopes.
 *
 * Implementations stream envelopes in the order they were appended.
 * Callers MUST NOT assume per-source seq ordering across sources —
 * the kernel may have appended envelopes from multiple sources to
 * the same log.
 *
 * @public
 */
export interface LineSource {
  open(): AsyncIterableIterator<Envelope>;
  close(): Promise<void>;
}
