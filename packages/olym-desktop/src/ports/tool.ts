// Tool Port — keycap manifest registry + invocation abstraction.
// Concrete adapter routes to L1 Kernel via Tauri invoke.

export interface ToolManifest {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly source: ToolSource;
  readonly capabilities: ReadonlyArray<string>;
  // ...full schema in .olym/specs/tool-manifest/spec.md
}

export type ToolSource =
  | { type: 'builtin'; module: string }
  | { type: 'mcp'; server: string; tools: ReadonlyArray<string> }
  | { type: 'oauth'; vendor: string; oauthConfig: unknown }
  | { type: 'local_agent'; spawn: unknown; ipc: unknown }
  | { type: 'stss'; stream: unknown };

export interface ToolInvokeRequest {
  readonly manifestId: string;
  readonly input?: unknown;
}

export interface ToolInvokeResult {
  readonly success: boolean;
  readonly output?: unknown;
  readonly error?: string;
  readonly durationMs: number;
}

export interface ToolPort {
  listInstalled(): Promise<ToolManifest[]>;
  install(manifest: ToolManifest): Promise<void>;
  uninstall(manifestId: string): Promise<void>;
  invoke(req: ToolInvokeRequest): Promise<ToolInvokeResult>;
}
