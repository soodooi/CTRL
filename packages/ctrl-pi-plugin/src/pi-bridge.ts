// pi-bridge — translate a CTRL `text.chat` request into a Pi subprocess
// invocation and stream the tokens back as MCP progress events.
//
// Two transport modes (auto-selected):
//
//   1. RPC mode (preferred) — `pi rpc` is a long-running NDJSON RPC server
//      Pi ships for IDE / SDK integration. Once spawned, we send a single
//      `prompt` request per chat turn, receive streaming `delta` events,
//      then a `result` event. Spawn cost is amortised across calls.
//
//   2. Print mode (fallback) — `pi -q "<prompt>" --json` is a one-shot
//      invocation that prints NDJSON events to stdout and exits. Cold
//      spawn (~1-2s) per call, but works on any Pi version.
//
// We probe RPC at first call; on failure (binary too old, RPC subcommand
// missing, etc.) we transparently fall back to print mode for the lifetime
// of the bridge. The choice is surfaced via `BridgeStatus.transport`.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { detectPi, type PiBinary } from './pi-detect.ts';

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
   *  into via its 4 builtin tools). Defaults to `process.cwd()`. */
  cwd?: string;
}

export interface ChatChunk {
  /** Incremental assistant text since the previous chunk. */
  delta: string;
}

export interface ChatFinal {
  /** Full assistant message text. */
  text: string;
  /** Best-effort usage stats — populated only when Pi reports them. */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  /** Wall-clock duration of the call in ms. */
  duration_ms: number;
  transport: BridgeTransport;
}

export type BridgeTransport = 'rpc' | 'print';

export interface BridgeStatus {
  pi: PiBinary;
  transport: BridgeTransport;
  /** True after we've successfully completed at least one call in the
   *  current transport (so healthz can distinguish "configured" from "warm"). */
  warm: boolean;
}

export interface StreamCallbacks {
  onChunk: (c: ChatChunk) => void;
  onFinal: (f: ChatFinal) => void;
  onError: (e: Error) => void;
}

const MAX_PROMPT_BYTES = 256 * 1024; // 256 KB — generous; Pi context covers more.

/**
 * Bridge instance — owns the Pi binary location + (optionally) a running
 * `pi rpc` process. Single instance per server.
 */
export class PiBridge {
  private readonly pi: PiBinary;
  private transport: BridgeTransport = 'rpc';
  private warm = false;
  private rpcProc: ChildProcessWithoutNullStreams | null = null;
  private rpcInflight = new Map<string, RpcInflight>();
  private rpcBuf = '';

  constructor(pi: PiBinary) {
    this.pi = pi;
  }

  static async create(): Promise<PiBridge> {
    return new PiBridge(detectPi());
  }

  status(): BridgeStatus {
    return { pi: this.pi, transport: this.transport, warm: this.warm };
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

    if (this.transport === 'rpc') {
      try {
        await this.chatViaRpc(req, prompt, cb, started);
        this.warm = true;
        return;
      } catch (e) {
        // RPC failed — degrade to print mode for the rest of this bridge's
        // life, then retry the current call.
        this.transport = 'print';
        this.killRpc();
      }
    }

    await this.chatViaPrint(req, prompt, cb, started);
    this.warm = true;
  }

  shutdown(): void {
    this.killRpc();
  }

  // ── RPC transport ─────────────────────────────────────────────────────

  private async ensureRpc(): Promise<ChildProcessWithoutNullStreams> {
    if (this.rpcProc && !this.rpcProc.killed) return this.rpcProc;
    // ADR-003: when CTRL_PI_BRIDGE_EXTENSION is set, load the
    // ctrl-pi-bridge extension into Pi so its LLM calls route back to
    // the kernel provider sub-system (kernel /text-chat endpoint).
    // Without the env Pi uses its own provider config (legacy path /
    // standalone use of this MCP server).
    const extraArgs: string[] = [];
    const bridgeExt = process.env.CTRL_PI_BRIDGE_EXTENSION;
    if (bridgeExt && bridgeExt.length > 0) {
      extraArgs.push('--extension', bridgeExt);
    }
    const env: NodeJS.ProcessEnv = { ...process.env, PI_OUTPUT_FORMAT: 'json' };
    if (bridgeExt && bridgeExt.length > 0) {
      env.PI_PROVIDER = env.PI_PROVIDER ?? 'ctrl-bridge';
      env.PI_MODEL = env.PI_MODEL ?? 'default';
    }
    const proc = spawn(
      this.pi.command,
      [...this.pi.args, ...extraArgs, 'rpc'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      },
    );
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.handleRpcStdout(chunk));
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', () => {
      // intentional: surface to inflight callers below via onError path
    });
    proc.on('exit', (code) => {
      const err = new Error(`pi rpc exited (code=${code ?? 'null'})`);
      for (const inflight of this.rpcInflight.values()) inflight.cb.onError(err);
      this.rpcInflight.clear();
      this.rpcProc = null;
    });
    this.rpcProc = proc;
    return proc;
  }

  private async chatViaRpc(
    req: ChatRequest,
    prompt: string,
    cb: StreamCallbacks,
    started: number,
  ): Promise<void> {
    const proc = await this.ensureRpc();
    const id = randomUUID();
    const request = {
      jsonrpc: '2.0',
      id,
      method: 'prompt',
      params: {
        prompt,
        cwd: req.cwd ?? process.cwd(),
        provider: req.provider,
        model: req.model,
      },
    };

    return new Promise<void>((resolve, reject) => {
      let acc = '';
      const inflight: RpcInflight = {
        cb: {
          onChunk: (c) => {
            acc += c.delta;
            cb.onChunk(c);
          },
          onFinal: (f) => {
            cb.onFinal({ ...f, transport: 'rpc' });
            resolve();
          },
          onError: (e) => {
            cb.onError(e);
            reject(e);
          },
        },
        startedAt: started,
        accumulatedText: () => acc,
      };
      this.rpcInflight.set(id, inflight);
      proc.stdin.write(`${JSON.stringify(request)}\n`);
    });
  }

  private handleRpcStdout(chunk: string): void {
    this.rpcBuf += chunk;
    let nl: number;
    while ((nl = this.rpcBuf.indexOf('\n')) >= 0) {
      const line = this.rpcBuf.slice(0, nl).trim();
      this.rpcBuf = this.rpcBuf.slice(nl + 1);
      if (line.length === 0) continue;
      this.routeRpcLine(line);
    }
  }

  private routeRpcLine(line: string): void {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    const id = msg.id ?? '';
    const inflight = this.rpcInflight.get(id);
    if (!inflight) return;

    // Pi RPC speaks JSON-RPC 2.0 with `result` (final) + intermediate
    // notifications carrying token deltas. Accept both common shapes:
    //   • `{ method: "delta", params: { text } }` — notification stream
    //   • `{ result: { text } }`                  — final
    //   • `{ error: { message } }`                — RPC error
    if (msg.method === 'delta' && msg.params?.text) {
      inflight.cb.onChunk({ delta: String(msg.params.text) });
      return;
    }
    if (msg.error) {
      this.rpcInflight.delete(id);
      inflight.cb.onError(new Error(msg.error.message ?? 'pi rpc error'));
      return;
    }
    if (msg.result !== undefined) {
      this.rpcInflight.delete(id);
      const text =
        (msg.result as { text?: string } | string | undefined) &&
        typeof msg.result === 'object'
          ? (msg.result as { text?: string }).text ?? inflight.accumulatedText()
          : String(msg.result ?? inflight.accumulatedText());
      const usage = (msg.result as { usage?: ChatFinal['usage'] } | undefined)
        ?.usage;
      inflight.cb.onFinal({
        text,
        usage,
        duration_ms: Date.now() - inflight.startedAt,
        transport: 'rpc',
      });
    }
  }

  private killRpc(): void {
    if (!this.rpcProc) return;
    try {
      this.rpcProc.kill('SIGTERM');
    } catch {
      // ignore — proc may already be dead
    }
    this.rpcProc = null;
    this.rpcBuf = '';
    this.rpcInflight.clear();
  }

  // ── Print transport ───────────────────────────────────────────────────

  private async chatViaPrint(
    req: ChatRequest,
    prompt: string,
    cb: StreamCallbacks,
    started: number,
  ): Promise<void> {
    const args = [...this.pi.args, '-q', prompt, '--json'];
    if (req.provider) args.push('--provider', req.provider);
    if (req.model) args.push('--model', req.model);

    const proc = spawn(this.pi.command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: req.cwd ?? process.cwd(),
      env: { ...process.env },
    });

    let buf = '';
    let acc = '';
    let stderr = '';
    let usage: ChatFinal['usage'];

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (s: string) => {
      stderr += s;
    });

    proc.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.length === 0) continue;
        let evt: PrintEvent;
        try {
          evt = JSON.parse(line) as PrintEvent;
        } catch {
          // Pi may print non-JSON lines (banners, debug). Skip them.
          continue;
        }
        if (evt.type === 'delta' && typeof evt.text === 'string') {
          acc += evt.text;
          cb.onChunk({ delta: evt.text });
        } else if (evt.type === 'result') {
          if (typeof evt.text === 'string') acc = evt.text;
          if (evt.usage) usage = evt.usage;
        }
      }
    });

    return new Promise<void>((resolve) => {
      proc.on('close', (code) => {
        if (code !== 0 && acc.length === 0) {
          cb.onError(
            new Error(
              `pi -q exited with code ${code ?? 'null'}: ` +
                stderr.trim().slice(0, 500),
            ),
          );
          resolve();
          return;
        }
        cb.onFinal({
          text: acc,
          usage,
          duration_ms: Date.now() - started,
          transport: 'print',
        });
        resolve();
      });
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function assemblePrompt(messages: ChatMessage[]): string {
  // Pi accepts a single textual prompt. We linearise the OpenAI-shape
  // conversation array into a tagged transcript, same pattern ctrl-claude-shim
  // uses. Pi's system prompt support lives inside `pi rpc` params; print
  // mode collapses everything into one buffer.
  if (messages.length === 0) return '';
  return messages
    .map((m) => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      return `User: ${m.content}`;
    })
    .join('\n\n');
}

// ── Internal types ───────────────────────────────────────────────────────

interface RpcInflight {
  cb: StreamCallbacks;
  startedAt: number;
  accumulatedText: () => string;
}

interface RpcMessage {
  jsonrpc?: string;
  id?: string;
  method?: string;
  params?: { text?: string } & Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface PrintEvent {
  type?: string;
  text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}
