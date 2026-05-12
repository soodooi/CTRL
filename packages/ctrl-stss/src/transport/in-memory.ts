/**
 * In-memory loopback transport — for tests, examples, and
 * single-process pipelines.
 *
 * Two paired transports: bytes written to `send()` on one end are
 * delivered to the other end's `onMessage` handler on a microtask.
 *
 * Lifted with minor edits from screi v0.5 `core/src/transport/in-memory.ts`.
 *
 * @packageDocumentation
 */

import { TransportClosedError } from '../protocol/error.js';

import type { Transport, TransportState } from './types.js';

/**
 * Loopback {@link Transport}. Construct via
 * {@link createInMemoryTransportPair}.
 *
 * @public
 */
export class InMemoryTransport implements Transport {
  private _state: TransportState = 'idle';
  private messageHandler: ((bytes: Uint8Array) => void) | null = null;
  private stateHandler: ((state: TransportState) => void) | null = null;
  private peer: InMemoryTransport | null = null;

  get state(): TransportState {
    return this._state;
  }

  send(bytes: Uint8Array): void {
    if (this._state !== 'open') {
      throw new TransportClosedError(`Cannot send in state "${this._state}"`);
    }
    const peer = this.peer;
    if (peer === null) return;
    const copy = new Uint8Array(bytes);
    queueMicrotask(() => peer.deliver(copy));
  }

  onMessage(handler: (bytes: Uint8Array) => void): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: TransportState) => void): void {
    this.stateHandler = handler;
  }

  close(reason?: string): void {
    if (this._state === 'closed' || this._state === 'closing') return;
    this.setState('closing');
    const peer = this.peer;
    this.setState('closed');
    if (peer !== null && peer._state !== 'closed') {
      peer.setState('closed');
    }
    void reason;
  }

  /** @internal — pair-factory wires peers symmetrically. */
  _attachPeer(peer: InMemoryTransport): void {
    this.peer = peer;
  }

  /** @internal — pair-factory transitions both ends to open. */
  _open(): void {
    this.setState('open');
  }

  private deliver(bytes: Uint8Array): void {
    if (this._state !== 'open') return;
    this.messageHandler?.(bytes);
  }

  private setState(next: TransportState): void {
    if (this._state === next) return;
    this._state = next;
    this.stateHandler?.(next);
  }
}

/**
 * Construct two paired {@link InMemoryTransport}s. Both start in
 * `'open'` state — the pair models an already-established connection.
 *
 * @public
 */
export function createInMemoryTransportPair(): readonly [
  InMemoryTransport,
  InMemoryTransport,
] {
  const a = new InMemoryTransport();
  const b = new InMemoryTransport();
  a._attachPeer(b);
  b._attachPeer(a);
  a._open();
  b._open();
  return [a, b] as const;
}
