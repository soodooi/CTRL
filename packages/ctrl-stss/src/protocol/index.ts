/**
 * Protocol layer — pure types, constructors, type guards.
 *
 * No runtime state, no algorithms. The encoder, transport, and
 * reducer layers (siblings under `src/`) consume this surface.
 *
 * @packageDocumentation
 */

export * from './version.js';
export * from './kind.js';
export * from './error.js';
export * from './cell.js';
export * from './op.js';
export * from './capability.js';
export * from './envelope.js';
export * from './framing.js';
