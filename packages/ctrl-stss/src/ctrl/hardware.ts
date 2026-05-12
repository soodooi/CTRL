/**
 * Hardware profile — CTRL profile slot for ST-SS streams originating
 * on physical devices (AI glasses, voice recorders, desktop cameras,
 * e-ink readers, AI rings).
 *
 * The kernel scheduler reads these slots to:
 * - prioritise `power_class: 'always_on'` actors over UI work
 * - enable lossy compression for `bandwidth_class: '5kbps'` streams
 * - reduce poll frequency when `battery_aware: true` and battery low
 * - admit / reject based on `latency_budget_ms`
 *
 * Carried in `HelloPayload.capabilities.hardware_profile`. Opaque to
 * the wire layer; consumed by the kernel scheduler in P3.5.
 *
 * @see ../../../../.olym/specs/stss-protocol/spec.md §3.2
 * @packageDocumentation
 */

/**
 * Coarse device family. Open-extension so unforeseen device classes
 * can declare a hardware profile without an SDK release.
 *
 * @public
 */
export type HardwareDeviceType =
  | 'ai_glasses'
  | 'voice_recorder'
  | 'desktop_camera'
  | 'eink_reader'
  | 'ai_ring'
  | (string & {});

/**
 * Scheduling priority class.
 *
 * - `always_on` — runs continuously; kernel gives priority preemption
 * - `intermittent` — wakes on event or schedule
 * - `user_triggered` — only active during user interaction
 *
 * @public
 */
export type HardwarePowerClass = 'always_on' | 'intermittent' | 'user_triggered';

/**
 * Sustained-throughput class. Free-form string preferred over a closed
 * enum so devices can advertise honest numbers (e.g. `'2mbps'`).
 *
 * Recommended literal values for v1 interop: `'5kbps'`, `'50kbps'`,
 * `'500kbps'`, `'5mbps'`.
 *
 * @public
 */
export type HardwareBandwidthClass =
  | '5kbps'
  | '50kbps'
  | '500kbps'
  | '5mbps'
  | (string & {});

/**
 * Hardware profile carried at handshake.
 *
 * @public
 */
export interface HardwareProfile {
  readonly device_type: HardwareDeviceType;
  readonly power_class: HardwarePowerClass;
  readonly bandwidth_class: HardwareBandwidthClass;
  /**
   * End-to-end latency budget for time-sensitive cells (e.g. AI
   * glasses real-time overlay). Receivers SHOULD reject ops on this
   * stream where `now - ts_ms > latency_budget_ms` rather than render
   * stale state.
   */
  readonly latency_budget_ms: number;
  /**
   * When `true`, the kernel scheduler MAY throttle this stream when
   * the host (or device, where reported) reports low battery.
   */
  readonly battery_aware?: boolean;
}
