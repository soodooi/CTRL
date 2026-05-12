/**
 * Capability negotiation — the open bag carried in `hello` /
 * `welcome` handshakes.
 *
 * The protocol layer keeps `Capabilities` as a structurally-loose
 * record so downstream profiles (CTRL hardware profile, e-ink profile,
 * backpressure declaration — see `../ctrl/`) can attach typed slots
 * without modifying the wire envelope.
 *
 * @see ../../../.olym/specs/stss-protocol/spec.md §3.1
 * @packageDocumentation
 */

/**
 * Role an endpoint claims on a stream.
 *
 * - `'sender'` — produces cells/ops
 * - `'receiver'` — consumes cells/ops
 * - `'relay'` — forwards between sender and receiver
 * - `'recorder'` — read-only persistence sink
 *
 * @public
 */
export type EndpointRole = 'sender' | 'receiver' | 'relay' | 'recorder';

/**
 * Open capability bag carried in handshake envelopes.
 *
 * The wire format requires no specific keys — endpoints agree on
 * keys bilaterally. The CTRL profile (`../ctrl/*`) defines the
 * `hardware_profile`, `eink_render_profile`, `backpressure`,
 * `cell_kinds`, `op_kinds`, and `needs_capability` slots.
 *
 * @public
 */
export type Capabilities = Readonly<Record<string, unknown>>;
