/**
 * Version constants for the CTRL ST-SS TypeScript implementation.
 *
 * @packageDocumentation
 */

/**
 * SDK package version. Tracks `@ctrl/stss` npm release cycle.
 *
 * Use for telemetry / debugging headers. Do NOT use for protocol
 * compatibility checks — use {@link PROTOCOL_VERSION} instead.
 *
 * @public
 */
export const VERSION = '0.1.0';

/**
 * Protocol wire-format major version. Matches the `v` field in every
 * envelope. Receivers MUST reject envelopes whose `v` differs.
 *
 * Forward-compatible behaviour is achieved by bumping this constant in
 * a new SDK release, never by silently accepting a different value.
 *
 * @public
 */
export const PROTOCOL_VERSION = 1 as const;
