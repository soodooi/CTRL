/**
 * `@ctrl/stss` — CTRL profile of the ST-SS (Spatio-Temporal Semantic
 * Stream) protocol.
 *
 * Substrate layers:
 *
 * | Sub-export | Concern |
 * |---|---|
 * | `./protocol` | Wire types: Cell / Op / Envelope / framing / errors |
 *
 * CTRL profile, encoding, transport, and reducer layers land in
 * subsequent commits of H-2026-05-12-002.
 *
 * @see ../../../../.claude/ADR/001-system-architecture.md §3 §4
 * @see ../../../../.olym/specs/stss-protocol/spec.md
 *
 * @packageDocumentation
 */

export * from './protocol/index.js';
