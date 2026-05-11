// Channel — typed pipe between actors. Back-pressure aware.
// TypeScript stub; concrete implementation routes via Tauri invoke to L1 Kernel.

import type { Event } from './event.js';

export interface ChannelTx<T extends Event = Event> {
  send(msg: T): Promise<void>;
  tryPush(msg: T): boolean;
}

export interface ChannelRx<T extends Event = Event> {
  recv(): Promise<T>;
  close(): void;
}

export interface Channel<T extends Event = Event> {
  readonly tx: ChannelTx<T>;
  readonly rx: ChannelRx<T>;
  readonly capacity: number;
}

export type DropPolicy = 'block' | 'drop_oldest' | 'drop_newest';

export interface ChannelOptions {
  readonly capacity: number;
  readonly dropPolicy?: DropPolicy;
}
