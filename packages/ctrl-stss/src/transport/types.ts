/**
 * Transport — bidirectional byte-stream abstraction.
 *
 * Pipelines never import a specific transport directly; they talk to
 * {@link Transport}. This isolates the protocol from
 * WebSocket / WebTransport / Tauri-IPC differences and keeps the
 * engine runnable in any JavaScript environment.
 *
 * @packageDocumentation
 */

/**
 * Lifecycle state.
 *
 * @public
 */
export type TransportState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed';

/**
 * Bidirectional byte-oriented transport.
 *
 * Implementations are single-stream — one transport instance carries
 * one logical session. Multiplexing is the caller's concern.
 *
 * @public
 */
export interface Transport {
  readonly state: TransportState;
  send(bytes: Uint8Array): void;
  onMessage(handler: (bytes: Uint8Array) => void): void;
  onStateChange(handler: (state: TransportState) => void): void;
  close(reason?: string): void;
}
