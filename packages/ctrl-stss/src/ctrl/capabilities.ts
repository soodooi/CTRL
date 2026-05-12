/**
 * Typed view of the CTRL profile slots inside the open
 * {@link Capabilities} bag.
 *
 * The protocol layer keeps `Capabilities` structurally loose so the
 * wire format never has to grow new fields. CTRL endpoints attach
 * typed slots; foreign endpoints that do not recognise a slot
 * forward-compat-ignore.
 *
 * @see ../../../../.olym/specs/stss-protocol/spec.md §3
 * @packageDocumentation
 */

import type { CellKind, OpKind } from '../protocol/kind.js';
import type { BackpressurePolicy } from './backpressure.js';
import type { EinkRenderProfile } from './eink.js';
import type { HardwareProfile } from './hardware.js';

/**
 * CTRL profile fields. All optional — endpoints declare what they
 * care about. Assigns structurally into
 * `HelloPayload.capabilities` / `WelcomePayload.accepted_capabilities`.
 *
 * @example sender (clipboard keycap)
 * ```ts
 * const caps: CtrlCapabilities = {
 *   cell_kinds: ['clipboard_snapshot'],
 *   needs_capability: ['ClipboardRead'],
 * };
 * createHello({ source: 's', seq: 0, role: 'sender',
 *               stream_id: 's', capabilities: caps });
 * ```
 *
 * @example sender (AI glasses)
 * ```ts
 * const caps: CtrlCapabilities = {
 *   cell_kinds: ['hardware_reading'],
 *   needs_capability: ['CameraRead', 'LlmCall'],
 *   hardware_profile: {
 *     device_type: 'ai_glasses',
 *     power_class: 'always_on',
 *     bandwidth_class: '50kbps',
 *     latency_budget_ms: 100,
 *     battery_aware: true,
 *   },
 * };
 * ```
 *
 * @example receiver (e-ink coding companion)
 * ```ts
 * const caps: CtrlCapabilities = {
 *   eink_render_profile: {
 *     ppi: 227,
 *     refresh_class: 'static',
 *     page_size: [1404, 1872],
 *     contrast_class: '16_grey',
 *     preferred_cells: ['llm_response', 'tool_result'],
 *   },
 *   backpressure: {
 *     buffer_size: 32,
 *     drop_policy: 'coalesce',
 *     coalesce_window_ms: 500,
 *   },
 * };
 * ```
 *
 * @public
 */
export interface CtrlCapabilities {
  /** Cell kinds the endpoint emits (sender) or accepts (receiver). */
  readonly cell_kinds?: readonly CellKind[];
  /** Op kinds the endpoint emits (sender) or accepts (receiver). */
  readonly op_kinds?: readonly OpKind[];
  /**
   * Kernel capability tokens the endpoint needs to function (e.g.
   * `'LlmCall'`, `'ClipboardRead'`, `'FsRead(/home)'`). The kernel
   * Capability Broker verifies subscriber actor's tokens cover this
   * set before forwarding (per CTRL ADR-001 §3.2).
   */
  readonly needs_capability?: readonly string[];
  readonly hardware_profile?: HardwareProfile;
  readonly eink_render_profile?: EinkRenderProfile;
  readonly backpressure?: BackpressurePolicy;
  /**
   * Open-extension: foreign endpoints (non-CTRL, future protocol
   * revisions, application-specific profiles) MAY attach additional
   * keys. Consumers without a matching reader forward-compat-ignore.
   *
   * The index signature also makes this type structurally assignable
   * to the protocol-layer {@link Capabilities} bag.
   */
  readonly [k: string]: unknown;
}

/**
 * Read a CTRL profile slot from the open capability bag with the
 * correct static type. Returns `undefined` when absent.
 *
 * @public
 */
export function readCtrlCapabilities(
  capabilities: Readonly<Record<string, unknown>> | undefined,
): CtrlCapabilities {
  if (!capabilities) return {};
  // Trust caller — the bag is open by design.
  return capabilities as CtrlCapabilities;
}
