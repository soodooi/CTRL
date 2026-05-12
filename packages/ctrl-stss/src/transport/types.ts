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
 * Handler registration is **single-slot, set-once**: every
 * `onMessage` / `onStateChange` / `onError` accepts at most one
 * non-null handler in the transport's lifetime. A second non-null
 * registration throws — there is no silent overwrite. Consumers that
 * want listener-list semantics build that layer on top.
 *
 * @public
 */
export interface Transport {
  readonly state: TransportState;
  send(bytes: Uint8Array): void;
  onMessage(handler: (bytes: Uint8Array) => void): void;
  onStateChange(handler: (state: TransportState) => void): void;
  /**
   * Register a handler for transport-level errors (e.g. WebSocket
   * `error` events, parse errors before envelope decoding). The
   * handler receives the underlying error event / value; shape is
   * transport-specific. The transport MAY also transition to
   * `'closed'` after invoking the handler — consumers cannot rely
   * on the state alone to distinguish a clean close from an error.
   */
  onError(handler: (error: unknown) => void): void;
  close(reason?: string): void;
}
