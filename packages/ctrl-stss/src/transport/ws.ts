/**
 * WebSocket transport adapter.
 *
 * Wraps a {@link WebSocketLike} (the structural shape of the global
 * `WebSocket` plus polyfills like Node's `ws` and Cloudflare Workers
 * server WebSocket). Surfaces it as a {@link Transport}.
 *
 * Send accepts `Uint8Array`; incoming bytes are surfaced as
 * `Uint8Array` regardless of the underlying `binaryType`. Text
 * frames are decoded as UTF-8.
 *
 * Lifted with minor edits from screi v0.5 `core/src/transport/ws.ts`
 * — proven adapter pattern, no domain-specific behaviour.
 *
 * @packageDocumentation
 */

import { TransportClosedError } from '../protocol/error.js';

import type { Transport, TransportState } from './types.js';

/**
 * Structural subset of the global `WebSocket`. Accepts polyfills
 * (Node `ws` library, Workers server WebSocket).
 *
 * @public
 */
export interface WebSocketLike {
  readyState: number;
  binaryType?: string;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    handler: (event: unknown) => void,
  ): void;
}

const READY_STATE: Record<number, TransportState> = {
  0: 'connecting',
  1: 'open',
  2: 'closing',
  3: 'closed',
};

const textEncoder = new TextEncoder();

/**
 * Adapter wrapping a {@link WebSocketLike} as a {@link Transport}.
 *
 * @public
 */
export class WebSocketTransport implements Transport {
  private _state: TransportState = 'connecting';
  private messageHandler: ((bytes: Uint8Array) => void) | null = null;
  private stateHandler: ((state: TransportState) => void) | null = null;
  private errorHandler: ((error: unknown) => void) | null = null;

  constructor(private readonly ws: WebSocketLike) {
    if ('binaryType' in ws && ws.binaryType !== 'arraybuffer') {
      ws.binaryType = 'arraybuffer';
    }
    this.bindWs();
    this._state = READY_STATE[ws.readyState] ?? 'idle';
  }

  get state(): TransportState {
    return this._state;
  }

  send(bytes: Uint8Array): void {
    if (this._state !== 'open') {
      throw new TransportClosedError(`Cannot send in state "${this._state}"`);
    }
    this.ws.send(bytes);
  }

  onMessage(handler: (bytes: Uint8Array) => void): void {
    if (this.messageHandler !== null) {
      throw new Error('WebSocketTransport: onMessage handler already registered');
    }
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: TransportState) => void): void {
    if (this.stateHandler !== null) {
      throw new Error('WebSocketTransport: onStateChange handler already registered');
    }
    this.stateHandler = handler;
  }

  onError(handler: (error: unknown) => void): void {
    if (this.errorHandler !== null) {
      throw new Error('WebSocketTransport: onError handler already registered');
    }
    this.errorHandler = handler;
  }

  close(reason?: string): void {
    if (this._state === 'closed' || this._state === 'closing') return;
    this.ws.close(1000, reason);
    this.setState('closing');
  }

  private bindWs(): void {
    this.ws.addEventListener('open', () => this.setState('open'));
    this.ws.addEventListener('close', () => this.setState('closed'));
    this.ws.addEventListener('message', (event) => this.onWsMessage(event));
    this.ws.addEventListener('error', (event) => {
      this.errorHandler?.(event);
      this.setState('closed');
    });
  }

  private setState(next: TransportState): void {
    if (this._state === next) return;
    this._state = next;
    this.stateHandler?.(next);
  }

  private onWsMessage(event: unknown): void {
    if (!this.messageHandler) return;
    const data = (event as { data?: unknown }).data;
    if (data instanceof ArrayBuffer) {
      this.messageHandler(new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      this.messageHandler(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
      return;
    }
    if (typeof data === 'string') {
      this.messageHandler(textEncoder.encode(data));
      return;
    }
  }
}
