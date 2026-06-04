// pi-bridge — translate a CTRL `text.chat` request into a Pi `prompt`
// command via Pi's official `RpcClient` and stream the tokens back as
// MCP progress events.
//
// bao 2026-05-31 (122-trail): "我要 pi 是核心来开发". This file used to
// hand-roll a JSON-RPC wire protocol against Pi RPC mode, which (a)
// shipped two production bugs uncaught (positional 'rpc' instead of
// `--mode rpc`; JSON-RPC 2.0 envelope vs Pi's `{type, command}` schema),
// and (b) couples us to whatever Pi's wire shape happened to be on the
// day the wrapper was written. Pi exports `RpcClient` from
// `@mariozechner/pi-coding-agent`; we now delegate everything to it.
// When Pi's RPC protocol evolves, we get the upgrade by bumping the
// devDep — no wrapper diff required.
//
// The bridge owns one persistent RpcClient. Each `chat()` call sends a
// prompt and subscribes to events for the lifetime of that call:
// `text_delta` events flow to `onChunk`, `agent_end` resolves with the
// accumulated text → `onFinal`.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { detectPi, type PiBinary } from './pi-detect.ts';

// Locally-typed view of Pi's RpcClient + AgentEvent surface. Inlined
// instead of imported because:
//
//  • Static `import type` statements survive `--experimental-strip-types`
//    as runtime imports (Node tries to resolve the specifier at module
//    load time even though it's `type`-only). In production the bundled
//    wrapper lives at `<.app>/Resources/ctrl-pi-plugin/` and CANNOT
//    resolve `@mariozechner/pi-coding-agent` from there — that package
//    lives under `~/.ctrl/pi/node_modules/`. Static type import =
//    immediate `Cannot find package` crash at first chat.
//    bao 2026-05-31 (122-trail diagnose).
//  • Bare `import('@mariozechner/...')` only happens inside
//    `loadPiCodingAgent()` where the explicit absolute path candidates
//    run first.
//
// These interfaces describe the subset of Pi's RpcClient we actually
// touch. They are NOT the source of truth — the runtime object comes
// from Pi. If Pi's surface changes incompatibly, TypeScript won't catch
// it (no static check vs Pi's d.ts), but the dev probe at
// scripts/probes/pi-bridge-probe.mjs exercises the real path against
// hoisted Pi types, which does catch breakage during release.
interface PiRpcClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: (event: PiAgentEvent) => void): () => void;
  prompt(message: string): Promise<void>;
}

interface PiRpcClientCtor {
  new (options: {
    cliPath?: string;
    args?: string[];
    env?: Record<string, string>;
  }): PiRpcClient;
}

interface PiAgentEvent {
  type: string;
  assistantMessageEvent?: {
    type: string;
    delta?: string;
    reason?: string;
    error?: { errorMessage?: string };
  };
  message?: {
    role?: string;
    usage?: { input?: number; output?: number };
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Optional Pi provider override. Pi resolves its own provider config
   *  from $PI_PROVIDER / ~/.pi/config; we pass `--provider` only when the
   *  caller explicitly sets it. Pi is provider-passthrough by design. */
  provider?: string;
  /** Optional model override; same passthrough semantics as `provider`. */
  model?: string;
  /** Working directory for Pi (controls which workspace it has visibility
   *  into). Defaults to `process.cwd()`. */
  cwd?: string;
}

export interface ChatChunk {
  delta: string;
}

export interface ChatFinal {
  text: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  duration_ms: number;
  transport: 'rpc';
}

export interface BridgeStatus {
  pi: PiBinary;
  transport: 'rpc';
  warm: boolean;
}

export interface StreamCallbacks {
  onChunk: (c: ChatChunk) => void;
  onFinal: (f: ChatFinal) => void;
  onError: (e: Error) => void;
}

const MAX_PROMPT_BYTES = 256 * 1024;

export class PiBridge {
  private readonly pi: PiBinary;
  private warm = false;
  private rpc: PiRpcClient | null = null;
  private rpcStarting: Promise<PiRpcClient> | null = null;

  constructor(pi: PiBinary) {
    this.pi = pi;
  }

  static async create(): Promise<PiBridge> {
    return new PiBridge(detectPi());
  }

  status(): BridgeStatus {
    return { pi: this.pi, transport: 'rpc', warm: this.warm };
  }

  async chat(req: ChatRequest, cb: StreamCallbacks): Promise<void> {
    const prompt = assemblePrompt(req.messages);
    if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
      cb.onError(
        new Error(
          `prompt exceeds MAX_PROMPT_BYTES (${MAX_PROMPT_BYTES}); ` +
            'trim conversation history before retry',
        ),
      );
      return;
    }

    const started = Date.now();
    try {
      await this.runPrompt(prompt, cb, started);
      this.warm = true;
    } catch (e: unknown) {
      cb.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  shutdown(): void {
    if (this.rpc) {
      this.rpc.stop().catch(() => {});
      this.rpc = null;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────

  private async runPrompt(
    prompt: string,
    cb: StreamCallbacks,
    started: number,
  ): Promise<void> {
    const client = await this.ensureRpc();

    return new Promise<void>((resolve, reject) => {
      let acc = '';
      let usage: ChatFinal['usage'];
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        fn();
      };

      const unsubscribe = client.onEvent((evt: PiAgentEvent) => {
        if (evt.type === 'message_update') {
          const ae = evt.assistantMessageEvent;
          if (ae?.type === 'text_delta' && typeof ae.delta === 'string') {
            acc += ae.delta;
            cb.onChunk({ delta: ae.delta });
          } else if (ae?.type === 'error') {
            const errMsg =
              (ae.error as { errorMessage?: string } | undefined)
                ?.errorMessage ?? ae.reason ?? 'pi assistant error';
            settle(() => {
              cb.onError(new Error(errMsg));
              reject(new Error(errMsg));
            });
          }
        } else if (evt.type === 'message_end') {
          // Pull usage off the assistant message when it lands.
          const msg = evt.message as
            | {
                role?: string;
                usage?: { input?: number; output?: number };
              }
            | undefined;
          if (msg?.role === 'assistant' && msg.usage) {
            usage = {
              input_tokens: msg.usage.input,
              output_tokens: msg.usage.output,
            };
          }
        } else if (evt.type === 'agent_end') {
          settle(() => {
            cb.onFinal({
              text: acc,
              usage,
              duration_ms: Date.now() - started,
              transport: 'rpc',
            });
            resolve();
          });
        }
      });

      client.prompt(prompt).catch((e: unknown) => {
        settle(() => {
          const err = e instanceof Error ? e : new Error(String(e));
          cb.onError(err);
          reject(err);
        });
      });
    });
  }

  private async ensureRpc(): Promise<PiRpcClient> {
    if (this.rpc) return this.rpc;
    if (this.rpcStarting) return this.rpcStarting;

    this.rpcStarting = (async () => {
      const { RpcClient } = await loadPiCodingAgent(this.pi);
      // ADR-002 substrate brain v7 1.1 + ADR-005 irisy v4 7 (2026-06-04):
      // `--no-tools` previously stripped EVERY tool — including the ones
      // ctrl-pi-bridge.registerTool() adds for the BYOK frontier path.
      // `--no-builtin-tools` keeps extension-registered tools alive but
      // disables Pi's 7 defaults (read/write/edit/bash/grep/find/ls) so
      // the kernel substrate stays the gatekeeper for vault writes etc.
      // Coding mode (C7, ADR-005 6.2) opts back into the built-ins via
      // a per-turn override Pi handles internally — no flag flip needed.
      const args: string[] = ['--no-builtin-tools'];
      const bridgeExt = process.env.CTRL_PI_BRIDGE_EXTENSION;
      if (bridgeExt && bridgeExt.length > 0) {
        args.unshift('--extension', bridgeExt);
      }

      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === 'string') env[k] = v;
      }
      env.PI_OUTPUT_FORMAT = 'json';
      if (bridgeExt && bridgeExt.length > 0) {
        env.PI_PROVIDER = env.PI_PROVIDER ?? 'ctrl-bridge';
        env.PI_MODEL = env.PI_MODEL ?? 'default';
      }

      const client = new RpcClient({
        cliPath: this.pi.command,
        args,
        env,
      });
      await client.start();
      this.rpc = client;
      return client;
    })();

    try {
      return await this.rpcStarting;
    } finally {
      this.rpcStarting = null;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function assemblePrompt(messages: ChatMessage[]): string {
  if (messages.length === 0) return '';
  return messages
    .map((m) => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      return `User: ${m.content}`;
    })
    .join('\n\n');
}

/** Dynamic-import `@mariozechner/pi-coding-agent` from wherever Pi was
 *  actually installed (`~/.ctrl/pi/...` in production, hoisted workspace
 *  node_modules in dev). Tries explicit absolute paths derived from
 *  `pi.command` first, then falls back to bare specifier resolution
 *  (which only works if the wrapper file lives somewhere with Pi in its
 *  module resolution path — true in dev, false in the .app bundle). */
async function loadPiCodingAgent(pi: PiBinary): Promise<{
  RpcClient: PiRpcClientCtor;
}> {
  // pi.command is one of:
  //   - <root>/node_modules/.bin/pi  → bin symlink, go up to node_modules
  //   - <pi-pkg>/dist/cli.js         → direct path, go up to pi-coding-agent
  //   - /opt/homebrew/bin/pi         → global symlink, fall through to bare
  const binDir = dirname(pi.command);
  const candidates = [
    join(binDir, '..', '@mariozechner', 'pi-coding-agent'),
    join(binDir, '..', '..', '@mariozechner', 'pi-coding-agent'),
  ];
  for (const c of candidates) {
    const entry = join(c, 'dist', 'index.js');
    if (existsSync(entry)) {
      return (await import(entry)) as { RpcClient: PiRpcClientCtor };
    }
  }
  return (await import('@mariozechner/pi-coding-agent')) as {
    RpcClient: PiRpcClientCtor;
  };
}
