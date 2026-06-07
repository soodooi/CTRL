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
  prompt(message: string, images?: unknown[]): Promise<void>;
  // Full RpcClient surface — bao 2026-06-05 "全量打开 PI 所有功能".
  // Inlined here so PiBridge can `client[method]?.(...)` dispatch without
  // importing Pi's d.ts statically (see comment above the interface).
  steer?(message: string): Promise<void>;
  followUp?(message: string): Promise<void>;
  abort?(): Promise<void>;
  newSession?(parentSession?: string): Promise<{ cancelled: boolean }>;
  switchSession?(sessionPath: string): Promise<{ cancelled: boolean }>;
  fork?(entryId: string): Promise<{ text: string; cancelled: boolean }>;
  clone?(): Promise<{ cancelled: boolean }>;
  getForkMessages?(): Promise<Array<{ entryId: string; text: string }>>;
  setSessionName?(name: string): Promise<void>;
  getState?(): Promise<unknown>;
  getSessionStats?(): Promise<unknown>;
  getMessages?(): Promise<unknown[]>;
  setModel?(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
  cycleModel?(): Promise<unknown>;
  getAvailableModels?(): Promise<unknown[]>;
  setThinkingLevel?(level: string): Promise<void>;
  cycleThinkingLevel?(): Promise<unknown>;
  setSteeringMode?(mode: 'all' | 'one-at-a-time'): Promise<void>;
  setFollowUpMode?(mode: 'all' | 'one-at-a-time'): Promise<void>;
  compact?(customInstructions?: string): Promise<unknown>;
  setAutoCompaction?(enabled: boolean): Promise<void>;
  setAutoRetry?(enabled: boolean): Promise<void>;
  abortRetry?(): Promise<void>;
  bash?(command: string): Promise<unknown>;
  abortBash?(): Promise<void>;
  exportHtml?(outputPath?: string): Promise<{ path: string }>;
  getCommands?(): Promise<unknown[]>;
  getLastAssistantText?(): Promise<string | null>;
}

interface PiRpcClientCtor {
  // ADR-002 substrate § provider v9 §1.2 (2026-06-06): pass the real
  // BYOK provider+model from SSOT directly to Pi's RpcClient ctor. Pi's
  // actual RpcClient surface (~/.ctrl/pi/node_modules/@mariozechner/
  // pi-coding-agent/dist/modes/rpc/rpc-client.d.ts L12-25) already
  // exposes these fields; we mirror them here for the local subset typing.
  new (options: {
    cliPath?: string;
    args?: string[];
    env?: Record<string, string>;
    provider?: string;
    model?: string;
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

  /** bao 2026-06-05 "open all Pi capability": generic pass-through for
   *  any RpcClient method. The HTTP layer (mcp-server /api/pi-rpc)
   *  forwards `{method, args}` here; we ensure the RPC client is started
   *  and dispatch. Methods that don't exist on the client return an
   *  error rather than silently ok. ADR-009 P10 (no swallowed errors). */
  async callRpc(method: string, args: unknown[] = []): Promise<unknown> {
    const client = await this.ensureRpc();
    const fn = (client as unknown as Record<string, unknown>)[method];
    if (typeof fn !== 'function') {
      throw new Error(`PiBridge.callRpc: method "${method}" not on RpcClient`);
    }
    return await (fn as (...a: unknown[]) => Promise<unknown>).apply(client, args);
  }

  /** List Pi session jsonl files for the current cwd-slug. Pi stores
   *  sessions at `~/.pi/agent/sessions/<slugified-cwd>/<ts>_<uuid>.jsonl`.
   *  We read the directory directly (no RPC needed) and return metadata
   *  parsed from each file's first 2 lines (header + first message). */
  async listSessions(): Promise<Array<{
    path: string;
    id: string;
    name: string | null;
    createdAt: string;
    firstMessage: string | null;
    sizeBytes: number;
  }>> {
    const { readdir, stat, open } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    // Slugify cwd the same way Pi does in dist/core/session-manager.js
    // (leading slash dropped, remaining `/` -> `-`, wrap in `--...--`).
    const cwd = process.cwd();
    const slug = `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`;
    const dir = join(homedir(), '.pi', 'agent', 'sessions', slug);
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }
    const out: Array<{
      path: string; id: string; name: string | null;
      createdAt: string; firstMessage: string | null; sizeBytes: number;
    }> = [];
    for (const fname of entries) {
      if (!fname.endsWith('.jsonl')) continue;
      const path = join(dir, fname);
      try {
        const st = await stat(path);
        const fh = await open(path, 'r');
        try {
          const buf = Buffer.alloc(8192);
          const { bytesRead } = await fh.read(buf, 0, 8192, 0);
          const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n');
          let name: string | null = null;
          let id = fname.replace(/\.jsonl$/, '');
          let firstMessage: string | null = null;
          for (const raw of lines) {
            if (!raw) continue;
            try {
              const j = JSON.parse(raw) as Record<string, unknown>;
              if (j['type'] === 'session_header') {
                if (typeof j['name'] === 'string') name = j['name'] as string;
                if (typeof j['id'] === 'string') id = j['id'] as string;
              } else if (firstMessage == null && j['type'] === 'message' && j['role'] === 'user') {
                const content = j['content'];
                if (typeof content === 'string') firstMessage = content.slice(0, 120);
                else if (Array.isArray(content)) {
                  const tx = content.find((c) => typeof c === 'object' && c !== null && (c as Record<string, unknown>)['type'] === 'text');
                  if (tx) firstMessage = String((tx as Record<string, unknown>)['text'] ?? '').slice(0, 120);
                }
              }
            } catch { /* skip malformed line */ }
            if (name != null && firstMessage != null) break;
          }
          out.push({ path, id, name, createdAt: st.birthtime.toISOString(), firstMessage, sizeBytes: st.size });
        } finally {
          await fh.close();
        }
      } catch { /* skip unreadable */ }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }

  /** Delete a session jsonl by path. Path must live under Pi's sessions
   *  dir for the current cwd-slug; refuse paths outside as a guard. */
  async deleteSession(sessionPath: string): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const cwd = process.cwd();
    const slug = `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`;
    const dir = join(homedir(), '.pi', 'agent', 'sessions', slug);
    if (!sessionPath.startsWith(dir)) {
      throw new Error(`deleteSession: path "${sessionPath}" outside sessions dir`);
    }
    await unlink(sessionPath);
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
        const { existsSync } = await import('node:fs');
        // bao 2026-06-05 final: drop claude / anthropic everywhere so
        // we stop fighting provider routing. pi-claude-auth no longer
        // loaded. Default brain = ollama-local (hermes3:8b). To restore
        // Claude later: uncomment the next 4 lines.
        // const claudeAuthExt = `${piDir}/node_modules/pi-claude-auth/dist/index.js`;
        // if (existsSync(claudeAuthExt)) {
        //   args.unshift('--extension', claudeAuthExt);
        // }
        // bao 2026-06-05: load irisy-persona — the user-facing persona layer
        // defined per ~/.claude/skills/irisy-build/SKILL.md. Lives at a fixed
        // path during dev; will move to npm install once published. [I7]
        // surface-decoupled: this extension is the same one any wrapper (CLI,
        // IDE, mobile, etc) loads — CTRL just spawns Pi with it included.
        const irisyPersonaExt =
          process.env.IRISY_PERSONA_EXTENSION ??
          '/Users/mac/Documents/coding/irisy-persona/src/index.ts';
        if (existsSync(irisyPersonaExt)) {
          args.unshift('--extension', irisyPersonaExt);
        }
        // bao 2026-06-05: load irisy-web — registers web_search + web_fetch
        // tools so Irisy can actually research the web. Pi 0.73.1 has no
        // MCP host and no native web tools (verified via dist/ source
        // inspection — `allToolNames = {read,bash,edit,write,grep,find,
        // ls}`); without this extension the model knows the web exists
        // but cannot reach it. web_fetch uses Jina Reader (no key, free);
        // web_search uses Tavily if TAVILY_API_KEY env is set, else falls
        // back to DuckDuckGo instant-answer. [P5] honest about which path
        // served; [I5] tool layer external to persona; [AP9] no swallowed
        // errors — failures surface to the user as tool isError messages.
        const irisyWebExt =
          process.env.IRISY_WEB_EXTENSION ??
          '/Users/mac/Documents/coding/irisy-web/src/index.ts';
        if (existsSync(irisyWebExt)) {
          args.unshift('--extension', irisyWebExt);
        }
        // bao 2026-06-05: load irisy-preview — registers preview_html /
        // preview_list / preview_stop tools so Irisy can show the user a
        // live frontend preview (landing pages, prototypes, single-file
        // apps). Static-only server on a free localhost port; LLM passes
        // a file list, tool writes to /tmp/irisy-preview/{name}/ and
        // returns the URL. For Vite/Next/dev-server cases the LLM should
        // use Pi bash to run `npm run dev` manually. [I5] tool external
        // to persona; [P5] honest about the static-only constraint.
        const irisyPreviewExt =
          process.env.IRISY_PREVIEW_EXTENSION ??
          '/Users/mac/Documents/coding/irisy-preview/src/index.ts';
        if (existsSync(irisyPreviewExt)) {
          args.unshift('--extension', irisyPreviewExt);
        }
        // bao 2026-06-05: load irisy-mac — registers screenshot_take +
        // ocr_image tools using macOS-native facilities (screencapture
        // CLI + Apple Vision framework via a small Swift binary that is
        // compiled on first OCR call). Darwin-only; the extension itself
        // returns a clear platform error on non-macOS hosts so loading
        // it on other platforms is a no-op. OCR needs Xcode Command
        // Line Tools (swiftc); the tool returns an honest install hint
        // if absent. No third-party OCR engine, no network. [P5] honest
        // about platform limits; [AP9] no swallowed errors.
        const irisyMacExt =
          process.env.IRISY_MAC_EXTENSION ??
          '/Users/mac/Documents/coding/irisy-mac/src/index.ts';
        if (existsSync(irisyMacExt)) {
          args.unshift('--extension', irisyMacExt);
        }
      }

      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === 'string') env[k] = v;
      }
      env.PI_OUTPUT_FORMAT = 'json';
      // bao 2026-06-05: source extra env from ~/.ctrl/.env so Tavily /
      // Brave / etc. API keys reach irisy-web extension at spawn time
      // without hardcoding them. KEY=value lines, # comments allowed.
      // Existing process.env keys win on conflict (user-facing override).
      try {
        const { readFileSync, existsSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { homedir } = await import('node:os');
        const ctrlEnvPath = join(homedir(), '.ctrl', '.env');
        if (existsSync(ctrlEnvPath)) {
          const text = readFileSync(ctrlEnvPath, 'utf-8');
          for (const raw of text.split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const eq = line.indexOf('=');
            if (eq <= 0) continue;
            const k = line.slice(0, eq).trim();
            const v = line.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
            if (k && !(k in env)) env[k] = v;
          }
        }
      } catch {
        /* best-effort: missing file or read failure is not fatal */
      }
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
      // bao 2026-06-05 final: anthropic / claude-oauth dropped.
      // Default brain = local Ollama (hermes3:8b) because it is the only
      // provider we currently have a credential for. Volc CTRL-paid key
      // is not provisioned in keychain yet; when it is, swap default to
      // 'volc' + 'doubao-1-5-pro-32k-241204' (or current Volc model id).
      // ADR-002 substrate § provider v9 §1.2 (2026-06-06): RETRACT the
      // ctrl-bridge alias. Pi spawns with the REAL user-selected BYOK
      // provider id from SSOT (~/.ctrl/state/active-providers.json
      // irisy.primary), not a synthetic alias. The kernel HTTP endpoint
      // /tool/get_active_provider_details resolves the manifest +
      // credentials from keychain; we write that into ~/.pi/agent/
      // models.json with `apiKey` as an env-var NAME reference (Pi's
      // documented "API key or environment variable name" pattern in
      // ProviderConfig.apiKey) and inject the real key as that env var
      // into the child process. No plaintext credentials on disk.
      //
      // RETIRED in v9 (do NOT re-introduce):
      //   - ctrl-bridge synthetic provider id + alias
      //   - injectCtrlBridgeProvider()
      //   - ctrl-pi-bridge `pi.registerProvider('ctrl-bridge', {streamSimple})`
      //   - kernel-side streamSimple interception of LLM calls
      //   - PI_PROVIDER / PI_MODEL / CTRL_TARGET_PROVIDER env vars
      //   - post-spawn `client.setModel(target, firstModel)` switch
      //
      // The new injectActiveProviderForSpawn returns the {providerId,
      // modelId, envVarName, envValue} the spawn needs.
      let spawnSpec: SpawnSpec;
      try {
        spawnSpec = await injectActiveProviderForSpawn(
          process.env.CTRL_PROVIDER_PORT ?? '17878',
        );
      } catch (e) {
        process.stderr.write(
          `pi-bridge: active-provider resolution failed: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        throw e;
      }
      // Inject the real key into child env under the documented var name.
      // Pi's openai-completions / anthropic-messages adapters resolve
      // `apiKey: "<ENV_VAR_NAME>"` to `process.env[ENV_VAR_NAME]` at the
      // first LLM call — see Pi source `dist/core/model-registry.js`
      // `resolveApiKey`. Real key never lands in models.json on disk.
      env[spawnSpec.envVarName] = spawnSpec.envValue;

      const client = new RpcClient({
        cliPath: this.pi.command,
        args,
        env,
        provider: spawnSpec.providerId,
        model: spawnSpec.modelId,
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

/**
 * Result of `injectActiveProviderForSpawn`: tells the caller what to pass to
 * `RpcClient({provider, model, env})`. ADR-002 substrate § provider v9 §1.2.
 */
interface SpawnSpec {
  /** Pi `--provider` argument — the real BYOK provider id from SSOT. */
  providerId: string;
  /** Pi `--model` argument — first model id from the provider's manifest. */
  modelId: string;
  /** Env var NAME to register as `apiKey` in models.json. */
  envVarName: string;
  /** Real credential value — caller injects under `envVarName` into child env. */
  envValue: string;
}

/**
 * Resolve the SSOT-selected provider into a Pi spawn spec + side-effect write
 * its entry into `~/.pi/agent/models.json`. ADR-002 substrate § provider v9
 * §1.2 (2026-06-06) — supersedes `injectCtrlBridgeProvider`.
 *
 * Flow:
 *   1. Fetch `/tool/get_active_provider_details` on the kernel HTTP endpoint
 *      (port = CTRL_PROVIDER_PORT). The kernel resolves the irisy.primary
 *      provider id from `~/.ctrl/state/active-providers.json`, joins the
 *      matching manifest TOML, pulls the credential from keychain, and
 *      returns `{id, api, baseUrl, apiKey, models}`.
 *   2. Compute an env-var NAME (`CTRL_PI_API_KEY_<UPPER_ID>`) and write the
 *      models.json entry with `apiKey` = that NAME (Pi's documented "API key
 *      or environment variable name" semantics — see
 *      `ProviderConfig.apiKey` in pi-coding-agent dist types).
 *   3. Return the env var name + the real value so the caller can inject it
 *      into the child process env. The real credential is NEVER written to
 *      disk — only the env var name is.
 *
 * Idempotent merge into existing models.json (preserves other providers).
 */
async function injectActiveProviderForSpawn(port: string): Promise<SpawnSpec> {
  // ADR-002 substrate § provider v9 §1.2 — body of injectActiveProviderForSpawn.
  const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');

  // Step 1 — Resolve SSOT-selected provider via kernel HTTP. The kernel
  // joins SSOT + manifest + keychain into one response shape. If the
  // kernel is unreachable, surface the error verbatim — there is no
  // fallback to "ollama-local" placeholder anymore (v9 § failover retract).
  type KernelModel = {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    input?: Array<'text' | 'image'>;
  };
  type KernelActiveProvider = {
    id: string;
    api: string;
    baseUrl: string;
    apiKey: string;
    models: KernelModel[];
  };
  const detailsUrl = `http://127.0.0.1:${port}/tool/get_active_provider_details`;
  const resp = await fetch(detailsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!resp.ok) {
    throw new Error(
      `kernel /tool/get_active_provider_details returned HTTP ${resp.status}`,
    );
  }
  const envelope = (await resp.json()) as {
    ok?: boolean;
    result?: KernelActiveProvider;
    error?: string;
  };
  const details = envelope?.result;
  if (!details || !details.id || !details.api || !details.baseUrl || !details.apiKey) {
    throw new Error(
      `kernel returned incomplete provider details (id=${details?.id}, ` +
        `api=${details?.api}, baseUrl=${details?.baseUrl ? 'set' : 'missing'}, ` +
        `apiKey=${details?.apiKey ? 'set' : 'missing'}). Configure a provider ` +
        `in CTRL Settings → Providers first.`,
    );
  }
  const firstModel = details.models?.[0];
  if (!firstModel?.id) {
    throw new Error(
      `provider "${details.id}" has no models declared in its manifest`,
    );
  }

  // Step 2 — Resolve target paths + compose env var name.
  const piAgentDir = join(homedir(), '.pi', 'agent');
  const modelsPath = join(piAgentDir, 'models.json');
  if (!existsSync(piAgentDir)) {
    mkdirSync(piAgentDir, { recursive: true });
  }
  // Sanitise the provider id into a SHELL_ENV_VAR shape.
  const envVarName =
    'CTRL_PI_API_KEY_' +
    details.id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();

  // Step 3 — Read existing models.json, upsert the provider entry with
  // apiKey = envVarName (NOT the real value).
  type ModelEntry = {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    input?: Array<'text' | 'image'>;
    cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  };
  type ProviderEntry = {
    name?: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    models?: ModelEntry[];
  };
  type ModelsFile = { providers?: Record<string, ProviderEntry> };

  let existing: ModelsFile = {};
  if (existsSync(modelsPath)) {
    try {
      existing = JSON.parse(readFileSync(modelsPath, 'utf-8')) as ModelsFile;
    } catch {
      existing = {};
    }
  }
  const providers = existing.providers ?? {};
  // ADR-002 substrate § provider v10 §12.7 (2026-06-07): Pi's latest
  // model-registry requires explicit `$VAR` prefix for env var
  // references — plain strings are now treated as literals. Writing
  // the unprefixed name still works (Pi auto-migrates on startup with
  // a warning) but prefixing eliminates the warning + locks the
  // intent.
  providers[details.id] = {
    name: details.id,
    baseUrl: details.baseUrl,
    api: details.api,
    apiKey: `$${envVarName}`,
    models: details.models.map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      reasoning: m.reasoning ?? false,
      input: m.input ?? ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: m.contextWindow ?? 200_000,
      maxTokens: m.maxTokens ?? 8192,
    })),
  };
  writeFileSync(modelsPath, JSON.stringify({ ...existing, providers }, null, 2));

  // ADR-002 substrate § provider v10 §6.1 (2026-06-07): auto-wire kernel
  // MCP server as a Pi mcpServer so Irisy gets kernel capabilities
  // (clipboard / OCR / vault_index FTS5 / keychain / subprocess) as
  // native Pi tools. Kernel MCP listens at 127.0.0.1:17873/mcp (see
  // src-tauri/src/kernel/mcp_server.rs DEFAULT_LISTEN_ADDR).
  // Settings.json is Pi's user-owned config (mcpServers, OAuth tokens,
  // user prefs); we upsert ONLY the `ctrl-kernel` entry and leave any
  // user-added mcpServers intact.
  const kernelMcpPort = process.env.CTRL_KERNEL_MCP_PORT ?? '17873';
  const kernelMcpToken = process.env.CTRL_KERNEL_MCP_TOKEN ?? '';
  const settingsPath = join(piAgentDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }
  const existingMcp = (settings.mcpServers ?? {}) as Record<string, unknown>;
  const ctrlKernelEntry: Record<string, unknown> = {
    url: `http://127.0.0.1:${kernelMcpPort}/mcp`,
    transport: 'streamable-http',
  };
  if (kernelMcpToken.length > 0) {
    // Per-boot bearer token. Kernel MCP server requires it; without the
    // header Pi gets 401 from /mcp and the auto-connect silently fails.
    ctrlKernelEntry.headers = { Authorization: `Bearer ${kernelMcpToken}` };
  }
  settings.mcpServers = {
    ...existingMcp,
    'ctrl-kernel': ctrlKernelEntry,
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return {
    providerId: details.id,
    modelId: firstModel.id,
    envVarName,
    envValue: details.apiKey,
  };
}

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
