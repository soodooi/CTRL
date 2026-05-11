// Effect — first-class side effect. Returned from actor handlers.
// L1 Kernel executes effects asynchronously, checking capability.

import type { Capability } from './capability.js';
import type { Event } from './event.js';

export type Effect =
  | LlmCallEffect
  | McpInvokeEffect
  | EmitEventEffect
  | SpawnActorEffect
  | PersistEventEffect
  | ShellExecEffect
  | HttpRequestEffect;

export interface LlmCallEffect {
  readonly kind: 'LlmCall';
  readonly model: string;
  readonly prompt: unknown;
  readonly deadlineMs: number;
  readonly replyTo: string; // ActorId
}

export interface McpInvokeEffect {
  readonly kind: 'McpInvoke';
  readonly server: string;
  readonly tool: string;
  readonly args: unknown;
  readonly replyTo: string;
}

export interface EmitEventEffect {
  readonly kind: 'EmitEvent';
  readonly target: string;
  readonly event: Event;
}

export interface SpawnActorEffect {
  readonly kind: 'SpawnActor';
  readonly prototype: string;
  readonly capability: Capability;
  readonly parentId: string;
  readonly initialState: unknown;
}

export interface PersistEventEffect {
  readonly kind: 'PersistEvent';
  readonly event: Event;
  readonly index?: ReadonlyArray<string>;
}

export interface ShellExecEffect {
  readonly kind: 'ShellExec';
  readonly cmd: string;
  readonly args: ReadonlyArray<string>;
  readonly replyTo: string;
}

export interface HttpRequestEffect {
  readonly kind: 'HttpRequest';
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly replyTo: string;
}

// Builder helpers — concise effect construction in actor handlers.
export const Eff = {
  llmCall: (model: string, prompt: unknown, deadlineMs: number, replyTo: string): LlmCallEffect => ({
    kind: 'LlmCall', model, prompt, deadlineMs, replyTo,
  }),
  mcpInvoke: (server: string, tool: string, args: unknown, replyTo: string): McpInvokeEffect => ({
    kind: 'McpInvoke', server, tool, args, replyTo,
  }),
  emit: (target: string, event: Event): EmitEventEffect => ({
    kind: 'EmitEvent', target, event,
  }),
  spawn: (prototype: string, capability: Capability, parentId: string, initialState: unknown): SpawnActorEffect => ({
    kind: 'SpawnActor', prototype, capability, parentId, initialState,
  }),
  persist: (event: Event, index?: ReadonlyArray<string>): PersistEventEffect => ({
    kind: 'PersistEvent', event, index,
  }),
} as const;
