/**
 * `@ctrl/stss` — CTRL profile of the ST-SS (Spatio-Temporal Semantic
 * Stream) protocol.
 *
 * | Sub-export | Concern |
 * |---|---|
 * | `./protocol` | Wire types: Cell / Op / Envelope / framing / errors |
 * | `./ctrl` | CTRL profile: stream-id helpers, hardware / e-ink / backpressure |
 * | `./encode` | Envelope ↔ bytes (JSON in v1, CBOR deferred to P11) |
 * | `./transport` | Transport interface + WebSocket + in-memory loopback |
 * | `./reducer` | Receiver-side cell-tree reducer |
 *
 * @see ../../../../.claude/ADR/001-system-architecture.md §3 §4
 * @see ../../../../.olym/specs/stss-protocol/spec.md
 *
 * @packageDocumentation
 */

export * from './protocol/index.js';
export * from './ctrl/index.js';
export * from './encode/index.js';
export * from './transport/index.js';
export * from './reducer/index.js';
