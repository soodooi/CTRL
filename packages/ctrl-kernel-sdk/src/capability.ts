// Capability — static token bundle declaring what an actor may do.
// Mirrors L1 Kernel CapToken enum. No ambient authority — every effect requires token.

export type CapToken =
  | { kind: 'LlmCall'; model: string; maxTokens?: number }
  | { kind: 'FsRead'; pathGlob: string }
  | { kind: 'FsWrite'; pathGlob: string }
  | { kind: 'KvRead'; namespace: string }
  | { kind: 'KvWrite'; namespace: string }
  | { kind: 'HttpGet'; urlGlob: string }
  | { kind: 'HttpPost'; urlGlob: string }
  | { kind: 'ClipboardRead' }
  | { kind: 'ClipboardWrite' }
  | { kind: 'HotkeyRegister'; combo: string }
  | { kind: 'McpInvoke'; server: string; toolGlob: string }
  | { kind: 'StssEmit'; streamId: string }
  | { kind: 'StssSubscribe'; streamId: string }
  | { kind: 'Spawn'; prototype: string }
  | { kind: 'Send'; target: string };

export interface Capability {
  readonly tokens: ReadonlyArray<CapToken>;
}

export function capability(...tokens: CapToken[]): Capability {
  return { tokens };
}

export function hasToken(cap: Capability, predicate: (t: CapToken) => boolean): boolean {
  return cap.tokens.some(predicate);
}
