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
    // Pi role=custom messages (sent via pi.sendMessage({customType,...}))
    // carry the customType + content on the message object itself
    // (agent-session.js:955 — appMessage shape). We surface them upward
    // through StreamCallbacks.onCustom so the kernel can relay them to
    // the PWA for slash-command-style UI rendering (ADR-009 P3).
    customType?: string;
    content?: unknown;
    display?: unknown;
    details?: unknown;
  };
}

/** Shape of a custom message after a no-turn `pi.sendMessage` (ADR-009 P5
 *  slash commands). Mirrors Pi's CustomMessage interface but narrowed to
 *  the fields PiBridge actually surfaces upward. */
export interface PiCustomMessage {
  customType: string;
  content: unknown;
  display?: unknown;
  details?: unknown;
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
  /** Fires when Pi emits a role=custom message (e.g. slash command
   *  customType payload). Optional so existing call-sites keep working
   *  unchanged. ADR-009 P3. */
  onCustom?: (m: PiCustomMessage) => void;
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
      let agentTurnStarted = false;
      let noTurnWatchdog: ReturnType<typeof setTimeout> | null = null;

      const clearWatchdog = () => {
        if (noTurnWatchdog !== null) {
          clearTimeout(noTurnWatchdog);
          noTurnWatchdog = null;
        }
      };

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        unsubscribe();
        fn();
      };

      // ADR-009 P5 (bao 2026-06-05 probe): when a slash command runs
      // with `sendMessage({triggerTurn:false})`, Pi never emits
      // `agent_start` / `agent_end` — it just pushes the custom message
      // entry, fires `message_start` + `message_end` for it, and
      // session.prompt() returns. Without a fallback signal the bridge
      // would wait on agent_end forever. We resolve as soon as we know
      // no LLM turn will run: either we see a `message_end` for a
      // role=custom message (slash command sent a customType), or the
      // post-prompt watchdog elapses without any agent_start at all
      // (e.g. /cap that calls callKernelTool but never sendMessage).
      const NO_TURN_WATCHDOG_MS = 1500;

      const resolveAsNoTurn = () => {
        settle(() => {
          cb.onFinal({
            text: acc, // typically empty for no-turn commands
            usage,
            duration_ms: Date.now() - started,
            transport: 'rpc',
          });
          resolve();
        });
      };

      const unsubscribe = client.onEvent((evt: PiAgentEvent) => {
        if (evt.type === 'agent_start') {
          agentTurnStarted = true;
          clearWatchdog();
        } else if (evt.type === 'message_update') {
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
          // Custom message landed — surface it upward so the kernel
          // can relay to PWA for slash-command-style UI rendering
          // (ADR-009 P3). Fire BEFORE the no-turn resolve so the
          // callback runs while the stream is still alive.
          if (msg?.role === 'custom' && typeof msg.customType === 'string') {
            cb.onCustom?.({
              customType: msg.customType,
              content: msg.content,
              display: msg.display,
              details: msg.details,
            });
          }
          // Slash-command custom message landed and no LLM turn has
          // begun → this prompt is done.
          if (msg?.role === 'custom' && !agentTurnStarted) {
            resolveAsNoTurn();
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

      client
        .prompt(prompt)
        .then(() => {
          // Arm the watchdog AFTER preflight succeeds. Don't arm it
          // before — if Pi rejects the prompt early, the catch below
          // settles us first.
          if (settled || agentTurnStarted) return;
          noTurnWatchdog = setTimeout(() => {
            noTurnWatchdog = null;
            if (!agentTurnStarted) resolveAsNoTurn();
          }, NO_TURN_WATCHDOG_MS);
        })
        .catch((e: unknown) => {
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
      // ADR-009 P2 (2026-06-04): Pi starts with ALL tools registered;
      // ctrl-pi-bridge then calls `pi.setActiveTools([10 extension])`
      // at register() time to restrict the active set. This way
      // coding-mode entry (`/switch coding` slash command) can call
      // `setActiveTools(extension + 7 built-ins)` to re-enable
      // read/write/edit/bash/grep/find/ls dynamically, instead of a
      // CLI flag that locks them out for the whole process lifetime.
      //
      // Previous `--no-builtin-tools` flag is dropped — it prevented
      // coding mode from ever toggling built-ins back on.
      const args: string[] = [];
      const bridgeExt = process.env.CTRL_PI_BRIDGE_EXTENSION;
      if (bridgeExt && bridgeExt.length > 0) {
        args.unshift('--extension', bridgeExt);
      }
      // bao 2026-06-05: load pi-claude-auth so Pi picks up the user's
      // Claude Code OAuth token from macOS Keychain automatically. This
      // is what lets Pi use the Claude Pro subscription as a $0-marginal
      // brain without forcing the user to enter an API key. Install
      // happened at boot via brain_supervisor (or, until that lands,
      // `npm install --save pi-claude-auth` in ~/.ctrl/pi/).
      const piDir = process.env.CTRL_PI_BIN
        ? // CTRL_PI_BIN = ~/.ctrl/pi/node_modules/.bin/pi → walk up.
          process.env.CTRL_PI_BIN
            .replace(/\/node_modules\/\.bin\/pi$/, '')
        : process.env.HOME
          ? `${process.env.HOME}/.ctrl/pi`
          : null;
      if (piDir) {
        const claudeAuthExt = `${piDir}/node_modules/pi-claude-auth/dist/index.js`;
        const { existsSync } = await import('node:fs');
        if (existsSync(claudeAuthExt)) {
          args.unshift('--extension', claudeAuthExt);
        }
      }

      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === 'string') env[k] = v;
      }
      env.PI_OUTPUT_FORMAT = 'json';
      // bao 2026-06-05 Pi-first refactor (ADR-009 §5 "do not re-implement
      // capabilities Pi already provides" + memory
      // `feedback_pi_is_core_use_upstream_surfaces`): Pi now connects
      // directly to its own native LLM provider via
      // ~/.pi/agent/models.json (currently seeds `ollama-local` running
      // Ollama OpenAI-compat). The bridge extension is still loaded for
      // tools / hooks / commands but is no longer registered as a Pi LLM
      // provider. This restores Pi-native tool calling (`tool_use` /
      // `tool_calls` events flow through pi-ai providers like
      // `openai-completions`), which the previous `streamSimple` proxy
      // silently disabled by routing every LLM call through the kernel
      // `/text-chat` endpoint + legacy `/api/generate` Ollama adapter —
      // see brainstorm/irisy-capabilities-2026-06-04.md A14.
      // bao 2026-06-05 (second amendment): default to Claude via the
      // pi-claude-auth extension which reads the user's Claude Code
      // OAuth token from macOS Keychain (~/.pi/agent/settings.json
      // auto-loads it). Pi-ai has a built-in `anthropic` provider that
      // accepts that OAuth credential and handles native tool calling.
      // hermes3:8b was attempted as a local zero-cost default but the
      // 8B model could not sustain Irisy's system prompt (capability
      // segments + brain state + 10 tool descriptions) without entering
      // repetition loops and hallucinating its own model identity
      // ("I am Claude"). Hermes 3 stays available in models.json for
      // users who explicitly pick it via PI_MODEL env.
      //
      // Aligns with memory `feedback_default_to_user_cli_not_paid_
      // providers` (bao 2026-05-31): "default is the user's claude cli,
      // anything else costs". Claude Pro subscription = $0 marginal cost.
      env.PI_PROVIDER = env.PI_PROVIDER ?? 'anthropic';
      env.PI_MODEL = env.PI_MODEL ?? 'claude-sonnet-4-6';
      // RpcClient passes provider/model to Pi via `--provider` and
      // `--model` CLI args (rpc-client.js L31-35), NOT env. The env
      // assignments above are kept for any downstream child that
      // inherits them, but Pi itself only honors the constructor opts.
      const provider = env.PI_PROVIDER;
      const model = env.PI_MODEL;

      const client = new RpcClient({
        cliPath: this.pi.command,
        args,
        env,
        provider,
        model,
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

  // ADR-009 P5: when the latest user turn is a slash command, send the
  // raw content (no `User: ` prefix). Pi's session.prompt detects slash
  // commands via text.startsWith('/'); the role prefix would mask the
  // leading slash and the command would fall through to the LLM as a
  // normal user message — exactly what we observed before this fix
  // (bao 2026-06-05 probe: `/discover RAG` got a generic LLM answer).
  //
  // For non-slash turns, keep the prefix join (existing behaviour for
  // history-bearing multi-turn chats sent in by the kernel).
  const last = messages[messages.length - 1];
  if (last?.role === 'user' && last.content.trimStart().startsWith('/')) {
    return last.content;
  }

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
