// Actor — independent execution unit with mailbox.
// Manifest defines prototype, kernel instantiates as actor.

import type { Capability } from './capability.js';
import type { Effect } from './effect.js';
import type { Event } from './event.js';

export type ActorId = string;

export interface ActorContext {
  readonly selfId: ActorId;
  readonly parentId?: ActorId;
  readonly capability: Capability;
  readonly deadlineMs?: number;
}

export interface ActorHandler<TState> {
  (state: TState, msg: Event, ctx: ActorContext): { state: TState; effects: Effect[] };
}

export interface ActorManifest<TState = unknown> {
  readonly name: string;
  readonly prototype: string;
  readonly capability: Capability;
  readonly initialState: TState;
  readonly handler: ActorHandler<TState>;
}

export function defineActor<TState>(manifest: ActorManifest<TState>): ActorManifest<TState> {
  return manifest;
}
