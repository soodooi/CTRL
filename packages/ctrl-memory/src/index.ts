/**
 * `@ctrl/memory` — client-side event-sourced query helper for CTRL
 * AI memory.
 *
 * The kernel side (Rust, `src-tauri/src/kernel/persistence.rs`) owns
 * the canonical event store (SQLite). This package is the TypeScript
 * side companion: in-process append/read for tests + dev, plus a
 * cursor-based query facade the UI layer and 创作者助手 use to
 * iterate over recent envelopes (e.g. "show me the last 10 LLM
 * responses on this stream").
 *
 * Not a mirror of kernel state. The Tauri bridge to kernel SQLite is
 * P3.5 (a separate handoff); the interfaces here are shaped so that
 * bridge can drop in as a new {@link LineSource} / {@link AppendSink}
 * implementation without changing call sites.
 *
 * @packageDocumentation
 */

export * from './types.js';
export * from './log/index.js';
export * from './reader/index.js';
