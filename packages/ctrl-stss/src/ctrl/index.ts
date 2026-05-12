/**
 * CTRL profile — typed slots layered on top of the open
 * {@link Capabilities} bag in the protocol layer.
 *
 * Foreign ST-SS endpoints that do not understand the CTRL profile
 * remain conformant — these slots are forward-compat-ignored.
 *
 * @packageDocumentation
 */

export * from './stream-id.js';
export * from './hardware.js';
export * from './eink.js';
export * from './backpressure.js';
export * from './capabilities.js';
