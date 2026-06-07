// @ctrl/pi-bridge — Pi extension wiring CTRL's brain integration.
//
// v7 (ADR-002 substrate brain v7 1.1 + ADR-005 irisy v4 7 — 2026-06-04) —
// uses 4 Pi ExtensionAPI surfaces to fix three real-world failure modes
// (Pi 0 tool / XML protocol fragility / monolithic prompt):
//
//   1. pi.registerProvider('ctrl-bridge', {streamSimple})    — existing v1
//   2. pi.registerTool(...) x 10 native Pi tools             — NEW v7
//   3. pi.on('before_agent_start', ...)                      — NEW v7
//   4. pi.on('tool_call', ...)                               — NEW v7
//   5. pi.on('resources_discover', ...)                      — NEW v7
//
// Surface (1) routes Pi's LLM calls back into the kernel provider chain
// (localhost:<CTRL_PROVIDER_PORT>/text-chat) where the v2 router (ADR-002
// substrate provider v2 3.5) selects irisy.primary / irisy.fallback by
// role. Surfaces (2)-(5) close the gaps traced 2026-06-04:
//
//   - Pre-v7 Pi had 0 native tools (ctrl-pi-plugin spawned it with
//     --no-tools and the bridge never registered any). Surface (2)
//     gives Pi native function calling for vault.* / skill.* / mcp.*
//     on the BYOK frontier path.
//   - Surface (3) chain-injects ADR-005 6 capability segments per turn,
//     keyword-pre-screened against the user prompt, so Pi sees only the
//     1-3 segments relevant to the request — fixing the "install_mcp
//     for any verb" failure mode.
//   - Surface (4) is an inspector stub today (5-identical-calls loop
//     guard); future home for ADR-006 4 policy-envelope (autonomy ladder).
//   - Surface (5) hands ~/.claude/skills/ to Pi as native Skills so the
//     user gets /skill:<name> slash commands without symlinks.
//
// Keeping this extension thin (one file, no transitive deps beyond Pi's
// own surface) means upstream Pi version bumps either keep working or
// fail loudly at extension-load time, never silently. ADR-002 1
// zero-deps invariant: Pi loads this from
// <CTRL.app>/Contents/Resources/pi-bridge/index.ts where Node module
// resolution cannot reach Pi's own node_modules/. We inline what we
// need; we do NOT split into modules (that would either require a build
// step or break resolution).
//
// streamSimple contract (per @mariozechner/pi-ai types):
//   Returns AssistantMessageEventStream SYNCHRONOUSLY. All async work
//   happens in a fire-and-forget IIFE that push()es events into the
//   stream and end()s it. The stream object MUST expose `.result()`
//   returning a Promise<AssistantMessage> — Pi awaits this after
//   iterating events. bao 2026-05-31 (118-trail): "response.result is
//   not a function" until this shape was matched.
//
//   We can't `import { createAssistantMessageEventStream } from
//   '@mariozechner/pi-ai'` because at runtime this file lives at
//   `<CTRL.app>/Contents/Resources/_up_/pi-bridge/index.ts`, and Node
//   module resolution from there can't reach Pi's node_modules. We
//   inline the class instead — small, no transitive deps, immune to
//   resolution path drift.
//
// The kernel endpoint:
//   POST http://127.0.0.1:<CTRL_PROVIDER_PORT>/text-chat
//   Headers: Content-Type: application/json, Accept: text/event-stream
//   Body: { messages: [{ role, content }], model?, capability? }
//   Response: SSE stream
//     event: delta
//     data:  { "delta": "<token>" }
//     event: done
//     data:  { "stop_reason": "..." }
//     event: error
//     data:  { "message": "..." }

// Node builtins needed by surface (5) skill discovery + the loop guard.
// Pi's runtime is Node 20+ so these import paths are stable.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export const BRIDGE_PROVIDER_NAME = 'ctrl-bridge';
export const BRIDGE_MODEL_NAME = 'default';
export const BRIDGE_ENV_PORT = 'CTRL_PROVIDER_PORT';
export const BRIDGE_ENV_TOKEN = 'CTRL_PROVIDER_TOKEN';

// ─── Pi extension API surface (locally typed) ───────────────────────────
//
// We declare only the surfaces we actually call. Real definitions live in
// ~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/dist/core/extensions/types.d.ts
// — static import fails at runtime (node_modules unreachable from .app),
// so the types are duplicated. If Pi's surface diverges, ctrl-pi-bridge
// fails at extension-load time with a clear error, never silently.

/** TypeBox-shaped schema. At runtime it's a JSON Schema object. The cast
 *  via `as unknown as TSchema` lets us satisfy Pi's `TParams extends
 *  TSchema` bound without taking a typebox npm dependency. */
type TSchema = { readonly [K: string]: unknown };

export interface PiToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  promptSnippet?: string;
  promptGuidelines?: string[];
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((details: unknown) => void) | undefined,
    ctx: unknown,
  ) => Promise<PiToolResult>;
}

export interface PiToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details?: unknown;
  isError?: boolean;
}

export interface PiBeforeAgentStartEvent {
  type: 'before_agent_start';
  prompt: string;
  systemPrompt: string;
  systemPromptOptions?: unknown;
}

export interface PiBeforeAgentStartResult {
  systemPrompt?: string;
}

export interface PiToolCallEvent {
  type: 'tool_call';
  toolName: string;
  input: Record<string, unknown>;
}

export interface PiToolCallResult {
  block?: boolean;
  reason?: string;
}

export interface PiResourcesDiscoverEvent {
  type: 'resources_discover';
  cwd: string;
  reason: 'startup' | 'reload';
}

export interface PiResourcesDiscoverResult {
  skillPaths?: string[];
  promptPaths?: string[];
  themePaths?: string[];
}

// ── ADR-009 §1.1 — new event surfaces (P1 / P4) ─────────────────────────

/** Fired when Pi has just compacted a session. The `compactionEntry`
 *  carries the LLM-generated `summary` we want to persist to the user's
 *  vault so the compaction is auditable + searchable in vim. ADR-009
 *  §3 D4 (落 vault, not Pi-internal-only). */
export interface PiSessionCompactEvent {
  type: 'session_compact';
  compactionEntry: {
    type: 'compaction';
    id: string;
    parentId: string | null;
    timestamp: string;
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    details?: unknown;
    fromHook?: boolean;
  };
  fromExtension: boolean;
}

/** Fired at the start of each turn. Used by the curator-cadence tracker
 *  (P4) + by the steering bridge to inject CTRL trigger nudges. */
export interface PiTurnStartEvent {
  type: 'turn_start';
  turnIndex: number;
  timestamp: number;
}

/** Fired at the end of each turn. Triggers P4 curator nudge when
 *  turnIndex % N == 0, and lets ctrl-pi-bridge clear per-turn counters. */
export interface PiTurnEndEvent {
  type: 'turn_end';
  turnIndex: number;
  message: unknown;
  toolResults: unknown[];
}

/** Fired when a tool finishes executing. isError=true → P4 reflection
 *  trigger (sendUserMessage nextTurn "the last tool failed, look at why"). */
export interface PiToolExecutionEndEvent {
  type: 'tool_execution_end';
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

/** Fired when an assistant message ends. Used for codename-leak audit
 *  (P4 safety check) — the PWA render-filter is the primary defence,
 *  this is just telemetry. */
export interface PiMessageEndEvent {
  type: 'message_end';
  message: unknown;
}

export interface PiMessageEndResult {
  message?: unknown;
}

/** Fired when an agent loop starts / ends. Status-bar latency tracking. */
export interface PiAgentStartEvent {
  type: 'agent_start';
}

export interface PiAgentEndEvent {
  type: 'agent_end';
  messages: unknown[];
}

/** Fired when a session ends. Used by P4 curator final pass — propose
 *  1-3 playbook entries based on the just-finished session. */
export interface PiSessionShutdownEvent {
  type: 'session_shutdown';
  reason: 'quit' | 'reload' | 'new' | 'resume' | 'fork';
  targetSessionFile?: string;
}

/** Fired when raw user input arrives, before the agent processes it.
 *  P5 slash-command pre-screen — if input starts with `/<cmd>` and
 *  matches a registered CTRL command, bridge can handle it and prevent
 *  the brain LLM round-trip. */
export interface PiInputEvent {
  type: 'input';
  text: string;
  images?: unknown[];
  source: 'interactive' | 'rpc' | 'extension';
}

export type PiInputEventResult =
  | { action: 'continue' }
  | { action: 'transform'; text: string; images?: unknown[] }
  | { action: 'handled' };

// ── ADR-009 §1.2 / §1.3 — register surfaces + communication ─────────────

/** ADR-009 P5 — slash command registration. User types `/<name> <args>`
 *  in chat; Pi calls our handler with the raw args string. */
export interface PiRegisteredCommand {
  name: string;
  description?: string;
  handler: (args: string, ctx: unknown) => Promise<void> | void;
}

/** ADR-009 P3 — custom message type renderer. PWA shows `customType`
 *  messages (curator-proposal / cap-discover / etc) with bespoke UI. */
export type PiMessageRenderer = (
  message: { customType: string; content: unknown; display?: unknown; details?: unknown },
  options: { expanded: boolean },
  theme: unknown,
) => unknown;

/** ADR-009 P4 — steering primitives. Pi delivers the custom message to
 *  the running session per `deliverAs`. */
export interface PiSendMessageOptions {
  triggerTurn?: boolean;
  deliverAs?: 'steer' | 'followUp' | 'nextTurn';
}

export interface PiSendUserMessageOptions {
  deliverAs?: 'steer' | 'followUp';
}

type PiHandler<E, R> = (evt: E, ctx: unknown) => Promise<R | void> | R | void;

export interface PiExtensionApi {
  registerProvider: (id: string, provider: PiProvider) => void;
  registerTool: (tool: PiToolDefinition) => void;
  // ── ADR-009 §1.2 new registration surfaces ───────────────────────────
  registerCommand?: (name: string, options: Omit<PiRegisteredCommand, 'name'>) => void;
  registerMessageRenderer?: <T = unknown>(
    customType: string,
    renderer: PiMessageRenderer,
  ) => void;
  // ── ADR-009 §1.3 communication / steering ────────────────────────────
  sendMessage?: <T = unknown>(
    message: { customType: string; content: T; display?: unknown; details?: unknown },
    options?: PiSendMessageOptions,
  ) => void;
  sendUserMessage?: (
    content: string,
    options?: PiSendUserMessageOptions,
  ) => void;
  // ── ADR-009 §1.4 runtime control ─────────────────────────────────────
  setActiveTools?: (toolNames: string[]) => void;
  getActiveTools?: () => string[];
  // ── Hook subscription ────────────────────────────────────────────────
  on(
    event: 'before_agent_start',
    handler: PiHandler<PiBeforeAgentStartEvent, PiBeforeAgentStartResult>,
  ): void;
  on(event: 'tool_call', handler: PiHandler<PiToolCallEvent, PiToolCallResult>): void;
  on(
    event: 'resources_discover',
    handler: PiHandler<PiResourcesDiscoverEvent, PiResourcesDiscoverResult>,
  ): void;
  on(event: 'session_compact', handler: PiHandler<PiSessionCompactEvent, void>): void;
  on(event: 'turn_start', handler: PiHandler<PiTurnStartEvent, void>): void;
  on(event: 'turn_end', handler: PiHandler<PiTurnEndEvent, void>): void;
  on(
    event: 'tool_execution_end',
    handler: PiHandler<PiToolExecutionEndEvent, void>,
  ): void;
  on(event: 'message_end', handler: PiHandler<PiMessageEndEvent, PiMessageEndResult>): void;
  on(event: 'agent_start', handler: PiHandler<PiAgentStartEvent, void>): void;
  on(event: 'agent_end', handler: PiHandler<PiAgentEndEvent, void>): void;
  on(
    event: 'session_shutdown',
    handler: PiHandler<PiSessionShutdownEvent, void>,
  ): void;
  on(event: 'input', handler: PiHandler<PiInputEvent, PiInputEventResult>): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
}

export interface PiTextContent {
  type: 'text';
  text: string;
}

export interface PiUserMessage {
  role: 'user';
  content: string | PiTextContent[];
  timestamp?: number;
}

export interface PiSystemMessage {
  role: 'system';
  content: string;
  timestamp?: number;
}

export interface PiAssistantMessage {
  role: 'assistant';
  content: PiTextContent[];
  api: string;
  provider: string;
  model: string;
  usage: PiUsage;
  stopReason: PiStopReason;
  timestamp: number;
  errorMessage?: string;
}

export type PiMessage = PiUserMessage | PiSystemMessage | PiAssistantMessage;

export interface PiStreamContext {
  messages: PiMessage[];
  system?: string;
}

export interface PiStreamOpts {
  signal?: AbortSignal;
}

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type PiStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

export type PiAssistantMessageEvent =
  | { type: 'start'; partial: PiAssistantMessage }
  | { type: 'text_start'; contentIndex: number; partial: PiAssistantMessage }
  | {
      type: 'text_delta';
      contentIndex: number;
      delta: string;
      partial: PiAssistantMessage;
    }
  | {
      type: 'text_end';
      contentIndex: number;
      content: string;
      partial: PiAssistantMessage;
    }
  | {
      type: 'done';
      reason: Extract<PiStopReason, 'stop' | 'length' | 'toolUse'>;
      message: PiAssistantMessage;
    }
  | {
      type: 'error';
      reason: Extract<PiStopReason, 'aborted' | 'error'>;
      error: PiAssistantMessage;
    };

export interface PiProvider {
  api: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  streamSimple: (
    model: unknown,
    ctx: PiStreamContext,
    opts?: PiStreamOpts,
  ) => BridgeEventStream;
}

// ── Inline AssistantMessageEventStream port ─────────────────────────────
//
// Mirrors @mariozechner/pi-ai's EventStream + AssistantMessageEventStream.
// Pi consumes this through both async iteration AND `await stream.result()`,
// so both surfaces must work. Source-of-truth reference:
//   /Users/mac/.ctrl/pi/node_modules/@mariozechner/pi-ai/dist/utils/event-stream.js

type Waiter = (r: { value: PiAssistantMessageEvent | undefined; done: boolean }) => void;

export class BridgeEventStream implements AsyncIterable<PiAssistantMessageEvent> {
  private queue: PiAssistantMessageEvent[] = [];
  private waiting: Waiter[] = [];
  private streamDone = false;
  private finalResultPromise: Promise<PiAssistantMessage>;
  private resolveFinalResult!: (m: PiAssistantMessage) => void;

  constructor() {
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  push(event: PiAssistantMessageEvent): void {
    if (this.streamDone) return;
    if (event.type === 'done') {
      this.streamDone = true;
      this.resolveFinalResult(event.message);
    } else if (event.type === 'error') {
      this.streamDone = true;
      this.resolveFinalResult(event.error);
    }
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  end(): void {
    this.streamDone = true;
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<PiAssistantMessageEvent> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.streamDone) {
        return;
      } else {
        const result = await new Promise<{
          value: PiAssistantMessageEvent | undefined;
          done: boolean;
        }>((resolve) => this.waiting.push(resolve));
        if (result.done) return;
        yield result.value!;
      }
    }
  }

  result(): Promise<PiAssistantMessage> {
    return this.finalResultPromise;
  }
}

// ── Registration ────────────────────────────────────────────────────────

export default function register(pi: PiExtensionApi): void {
  // Stash for out-of-band handlers that need pi.* actions after the
  // runner binds (see applyDefaultActiveTools below).
  activePiRef = pi;

  // 1. registerProvider — RE-ENABLED 2026-06-05 b (bao directive
  //    "provider is part of Irisy"). The DISABLED-block path forced Pi
  //    to read ~/.pi/agent/models.json + connect directly to a
  //    hardcoded provider (ollama-local), which made PWA Settings
  //    -> Add Provider / Switch Provider do nothing for the actual
  //    chat flow. New design: ctrl-pi-bridge at session_start reads
  //    ~/.ctrl/state/active-providers.json via the kernel's
  //    get_active_provider_details tool, then registers a Pi provider
  //    with the resolved {api, baseUrl, apiKey, models} from the
  //    matching builtin/*.toml + keychain. Pi sees the registered
  //    provider as native (api: "openai-completions" et al), so
  //    streaming + tool_calls all work end-to-end.
  //
  //    The previous streamSimple/text-chat round-trip is intentionally
  //    NOT used here — that path stripped tool_calls. Instead we hand
  //    Pi the real provider credentials so Pi talks to Volc / DeepSeek
  //    / OpenAI directly through its built-in adapters.
  //
  //    Switch UX: when user changes active-providers.json in PWA
  //    (provider_set_active Tauri command), the kernel publishes an
  //    "active-provider-changed" event; ctrl-pi-bridge re-reads + calls
  //    pi.unregisterProvider(old) + pi.registerProvider(new). For v1
  //    we kill+respawn the daemon on switch (BrainSupervisor::restart),
  //    which is heavier but simpler. v2 will go event-driven.
  // Return the promise (not void) so Pi's extension runner can await
  // it. Without this, `client.start()` resolves while
  // registerActiveProviderOnce is still mid-flight, and PiBridge's
  // post-start `setModel("volc-byok", ...)` racing call sees an
  // unregistered provider ("Model not found").
  pi.on('session_start', () => registerActiveProviderOnce(pi));

  // 2. registerTool x 10 — native Pi tools for BYOK frontier path
  //    (ADR-005 7.3, 2026-06-04). Each tool is a thin HTTP-fetch
  //    wrapper to the kernel provider port that proxies to a Tauri
  //    command. Pi turns these into provider-native function call
  //    schemas (Anthropic tool_use / OpenAI tools) so the model emits
  //    structured tool calls instead of the XML fallback protocol.
  const kernelTools = buildKernelTools();
  for (const tool of kernelTools) {
    pi.registerTool(tool);
  }

  // 2b. ADR-009 P2 — mode-aware tool whitelist. We removed
  //     `--no-builtin-tools` from ctrl-pi-plugin/pi-bridge.ts so Pi
  //     starts with all built-ins registered, then we restrict the
  //     active set to extension tools only. Coding mode toggles the
  //     built-ins back via /switch coding (P5).
  //
  //     Pi action methods (sendMessage/sendUserMessage/setActiveTools/...)
  //     throw `Extension runtime not initialized` until the runner
  //     binds its real implementations (loader.js:105 `notInitialized`
  //     stub). loadExtension wraps the factory in try/catch and a
  //     thrown stub here aborts the WHOLE extension load — every
  //     handler/command silently never registers.
  //
  //     Defer to `session_start`, which fires AFTER bind. A module
  //     flag makes it idempotent across reload / resume / fork so we
  //     don't stomp a user `/switch coding` toggle on session resume.
  pi.on('session_start', applyDefaultActiveTools);

  // 3. before_agent_start — chain-injects ADR-005 6 capability
  //    segments into the system prompt per-turn, keyword-pre-screened
  //    against evt.prompt. Resets the loop-guard counter on each turn.
  pi.on('before_agent_start', beforeAgentStartHandler);

  // 4. tool_call inspector — runaway-loop guard (5 identical calls in
  //    a row -> block). Future home for ADR-006 4 policy-envelope.
  pi.on('tool_call', toolCallInspectorHandler);

  // 5. resources_discover — hand ~/.claude/skills/ to Pi as native
  //    Skills so the user gets /skill:<name> slash commands without
  //    symlinks (ADR-005 7.4).
  pi.on('resources_discover', resourcesDiscoverHandler);

  // 6. ADR-009 P1 — session_compact. When Pi compacts the conversation
  //    (token budget hit), persist the LLM-generated summary to vault
  //    so the user can grep / vim / diff it. ADR-009 §3 D4.
  pi.on('session_compact', sessionCompactHandler);

  // 7. ADR-009 P4 — turn_end. Curator cadence (every N=5 turns)
  //    triggers a followUp message asking Pi to propose playbook
  //    updates. Per-turn counter lives in module state.
  pi.on('turn_end', turnEndHandler.bind(null, pi));

  // 8. ADR-009 P4 — tool_execution_end (isError=true → reflection).
  //    When a kernel-tool call fails, queue a nextTurn user message
  //    nudging Pi to diagnose so the user gets a "why did that fail"
  //    answer without having to ask.
  pi.on('tool_execution_end', toolExecutionEndHandler.bind(null, pi));

  // 9. ADR-009 P4 — session_shutdown final curator pass. Propose
  //    1-3 playbook entries summarising what we learned this session
  //    (Hermes curator.py pattern, ADR-005 §5 reflection-loop).
  pi.on('session_shutdown', sessionShutdownHandler.bind(null, pi));

  // 10. ADR-009 P5 — slash commands. Pi routes `/<name> <args>` to
  //     our handler before invoking the LLM, so deterministic intents
  //     bypass natural-language classification entirely. Raycast
  //     "surface = intent" pattern (brainstorm §0.2).
  if (pi.registerCommand) {
    registerSlashCommands(pi);
  }
}

// ── Active-provider registration (bao 2026-06-05 b) ───────────────────────

let activeProviderRegistered = false;

interface KernelActiveProvider {
  id: string;
  /** Pi `Api` discriminator, e.g. "openai-completions" / "anthropic-messages". */
  api: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{
    id: string;
    name?: string;
    contextWindow: number;
    maxTokens: number;
    input?: ('text' | 'image')[];
    reasoning?: boolean;
  }>;
}

/** session_start handler: call kernel for the active provider's resolved
 *  credentials + manifest, then `pi.registerProvider`. Idempotent across
 *  reload / resume / fork by checking the module flag. Failures are
 *  surfaced via stderr (Pi keeps running on whatever the user's
 *  models.json had, so chat doesn't 500 — but no Volc / DeepSeek
 *  until next spawn). */
async function registerActiveProviderOnce(pi: PiExtensionApi): Promise<void> {
  if (activeProviderRegistered) return;
  try {
    // bao 2026-06-05 e: callKernelTool returns the unwrapped `result`
    // value already (it parses { ok, result } envelope and returns
    // result). Earlier code was treating it as a Pi tool-result
    // envelope { content: [{ text }] } which is wrong here.
    const details = (await callKernelTool(
      'get_active_provider_details',
      {},
      undefined,
    )) as KernelActiveProvider;
    if (!details.id || !details.api || !details.baseUrl) {
      process.stderr.write(
        `ctrl-pi-bridge: incomplete provider details (id=${details.id}, api=${details.api}); skipping pi.registerProvider\n`,
      );
      return;
    }
    if (!pi.registerProvider) {
      process.stderr.write(
        'ctrl-pi-bridge: pi.registerProvider unavailable on this runtime; skipping\n',
      );
      return;
    }
    pi.registerProvider(details.id, {
      name: details.id,
      api: details.api,
      baseUrl: details.baseUrl,
      apiKey: details.apiKey,
      authHeader: true,
      models: details.models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        reasoning: m.reasoning ?? false,
        input: m.input ?? ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.contextWindow,
        maxTokens: m.maxTokens,
      })),
    });
    activeProviderRegistered = true;
    process.stderr.write(
      `ctrl-pi-bridge: registered active provider id=${details.id} api=${details.api} models=${details.models.length}\n`,
    );
  } catch (e) {
    process.stderr.write(
      `ctrl-pi-bridge: registerActiveProviderOnce failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
}

// ── streamSimple implementation ─────────────────────────────────────────

function streamFromKernel(
  model: unknown,
  ctx: PiStreamContext,
  opts: PiStreamOpts | undefined,
): BridgeEventStream {
  const stream = new BridgeEventStream();

  const output: PiAssistantMessage = {
    role: 'assistant',
    content: [],
    api: BRIDGE_PROVIDER_NAME,
    provider: BRIDGE_PROVIDER_NAME,
    model: normalizeModel(model) || BRIDGE_MODEL_NAME,
    usage: emptyUsage(),
    stopReason: 'stop',
    timestamp: Date.now(),
  };

  // Fire-and-forget — Pi reads the stream and awaits stream.result().
  void runPipe(stream, output, ctx, opts);
  return stream;
}

async function runPipe(
  stream: BridgeEventStream,
  output: PiAssistantMessage,
  ctx: PiStreamContext,
  opts: PiStreamOpts | undefined,
): Promise<void> {
  try {
    stream.push({ type: 'start', partial: output });

    const port = process.env[BRIDGE_ENV_PORT];
    if (!port || port.length === 0) {
      throw new Error(
        `${BRIDGE_ENV_PORT} not set — Pi was started without the CTRL ` +
          `provider port. Restart CTRL (the shell sets this env when ` +
          `spawning Pi).`,
      );
    }
    const url = `http://127.0.0.1:${port}/text-chat`;
    const token = process.env[BRIDGE_ENV_TOKEN];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (token && token.length > 0) {
      headers.Authorization = `Bearer ${token}`;
    }

    const body = JSON.stringify({
      messages: assembleMessages(ctx),
      model: output.model,
      capability: 'text.chat',
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: opts?.signal,
      });
    } catch (err: unknown) {
      throw new Error(
        `ctrl-bridge: kernel provider unreachable at ${url}: ${describe(err)}`,
      );
    }

    if (!response.ok || !response.body) {
      const detail = await safeReadText(response);
      throw new Error(
        `ctrl-bridge: kernel provider returned HTTP ${response.status}` +
          (detail ? `: ${detail}` : ''),
      );
    }

    // Open the first text block lazily on first delta so empty responses
    // don't emit an empty text_start/text_end pair.
    let textBlockOpened = false;
    let textBlockIndex = -1;
    let textAccum = '';

    const openTextBlock = () => {
      output.content.push({ type: 'text', text: '' });
      textBlockIndex = output.content.length - 1;
      textBlockOpened = true;
      stream.push({
        type: 'text_start',
        contentIndex: textBlockIndex,
        partial: output,
      });
    };

    const closeTextBlock = () => {
      if (!textBlockOpened) return;
      stream.push({
        type: 'text_end',
        contentIndex: textBlockIndex,
        content: textAccum,
        partial: output,
      });
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let currentEvent = '';
    let receivedTerminal = false;
    let stopReason: PiStopReason = 'stop';

    try {
      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        while (true) {
          const nl = buf.indexOf('\n');
          if (nl < 0) break;
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          if (line.length === 0) {
            currentEvent = '';
            continue;
          }
          if (line.startsWith('event: ')) {
            currentEvent = line.slice('event: '.length).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            const payload = line.slice('data: '.length);
            const event = currentEvent;
            if (event === 'delta') {
              const parsed = safeJson(payload);
              const delta =
                parsed && typeof parsed === 'object' && 'delta' in parsed
                  ? String((parsed as { delta: unknown }).delta ?? '')
                  : '';
              if (delta.length > 0) {
                if (!textBlockOpened) openTextBlock();
                textAccum += delta;
                (output.content[textBlockIndex] as PiTextContent).text = textAccum;
                stream.push({
                  type: 'text_delta',
                  contentIndex: textBlockIndex,
                  delta,
                  partial: output,
                });
              }
            } else if (event === 'done') {
              const parsed = safeJson(payload);
              const reason =
                parsed && typeof parsed === 'object' && 'stop_reason' in parsed
                  ? String((parsed as { stop_reason: unknown }).stop_reason ?? '')
                  : '';
              stopReason = mapStopReason(reason);
              receivedTerminal = true;
              break outer;
            } else if (event === 'error') {
              const parsed = safeJson(payload);
              const message =
                parsed && typeof parsed === 'object' && 'message' in parsed
                  ? String((parsed as { message: unknown }).message ?? 'unknown')
                  : payload || 'unknown';
              throw new Error(`ctrl-bridge: provider error: ${message}`);
            }
            // unknown event: ignore for forward-compat
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }

    closeTextBlock();

    if (!receivedTerminal) {
      // Stream closed without explicit done; treat as normal stop.
      stopReason = 'stop';
    }

    // Pi's "done" event only accepts non-error stop reasons.
    const doneReason: 'stop' | 'length' | 'toolUse' =
      stopReason === 'length' || stopReason === 'toolUse' ? stopReason : 'stop';
    output.stopReason = doneReason;
    stream.push({ type: 'done', reason: doneReason, message: output });
    stream.end();
  } catch (err: unknown) {
    const aborted = opts?.signal?.aborted === true;
    output.stopReason = aborted ? 'aborted' : 'error';
    output.errorMessage = describe(err);
    stream.push({
      type: 'error',
      reason: aborted ? 'aborted' : 'error',
      error: output,
    });
    stream.end();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function assembleMessages(
  ctx: PiStreamContext,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const out: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  if (ctx.system && ctx.system.length > 0) {
    out.push({ role: 'system', content: ctx.system });
  }
  for (const m of ctx.messages) {
    if (m.role === 'system' || m.role === 'user' || m.role === 'assistant') {
      out.push({ role: m.role, content: normalizeContent(m.content) });
    }
  }
  return out;
}

function normalizeModel(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.id === 'string') return obj.id;
    if (typeof obj.name === 'string') return obj.name;
  }
  return '';
}

function normalizeContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((b) => {
        if (b == null) return '';
        if (typeof b === 'string') return b;
        if (typeof b === 'object' && 'text' in b) {
          const t = (b as { text?: unknown }).text;
          return typeof t === 'string' ? t : '';
        }
        return '';
      })
      .filter((s) => s.length > 0)
      .join('');
  }
  if (value == null) return '';
  return JSON.stringify(value);
}

function mapStopReason(raw: string): PiStopReason {
  switch (raw) {
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'tool_use':
    case 'toolUse':
      return 'toolUse';
    case 'aborted':
    case 'cancel':
      return 'aborted';
    case 'error':
      return 'error';
    default:
      return 'stop';
  }
}

function emptyUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ─── TypeBox-shaped schema helpers (inline, zero deps) ──────────────────
//
// Pi's `ToolDefinition.parameters` is typed `TParams extends TSchema`
// where TSchema is from `@sinclair/typebox`. At runtime it just needs to
// be a JSON Schema object. We can't depend on typebox (ADR-002 1 zero-
// deps invariant), so we build the same shape inline.

const T = {
  Object(
    properties: Record<string, TSchema>,
    required: string[] = Object.keys(properties),
  ): TSchema {
    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    };
  },
  String(description?: string): TSchema {
    return description ? { type: 'string', description } : { type: 'string' };
  },
  Record(description?: string): TSchema {
    return description
      ? { type: 'object', additionalProperties: true, description }
      : { type: 'object', additionalProperties: true };
  },
};

// ─── Kernel tool wrappers (ADR-005 7.3, 2026-06-04) ─────────────────────
//
// Each tool calls the kernel HTTP bridge on CTRL_PROVIDER_PORT at the
// tool-specific path /tool/<toolName>. Kernel side dispatches to the
// matching Tauri command. Tools throw on transport failure; Pi shows
// that error to the model so it can recover.

interface KernelToolReply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

async function callKernelTool(
  toolName: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const port = process.env[BRIDGE_ENV_PORT];
  if (!port) {
    throw new Error(
      `${BRIDGE_ENV_PORT} not set — Pi was started without the CTRL ` +
        `provider port. Restart CTRL.`,
    );
  }
  const url = `http://127.0.0.1:${port}/tool/${encodeURIComponent(toolName)}`;
  const token = process.env[BRIDGE_ENV_TOKEN];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
    signal,
  });
  if (!response.ok) {
    const text = await safeReadText(response);
    throw new Error(
      `tool ${toolName}: HTTP ${response.status}` + (text ? `: ${text}` : ''),
    );
  }
  const payload = (await response.json()) as KernelToolReply;
  if (!payload.ok) {
    throw new Error(payload.error || `tool ${toolName}: unknown error`);
  }
  return payload.result;
}

function toolReply(value: unknown): PiToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolError(message: string): PiToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

function buildKernelTools(): PiToolDefinition[] {
  return [
    // ─── C1: Note Writer ─────────────────────────────────────────────
    {
      name: 'vault_write',
      label: 'Write note to vault',
      description:
        'Write a markdown note to the user vault. Use this for ONE-SHOT ' +
        'writes. DO NOT call install_mcp when the user just wants a ' +
        'note saved. Path is relative to vault root (e.g. ' +
        '"notes/2026-06-04-poem.md"). Frontmatter is an optional ' +
        'YAML-shaped JSON object.',
      parameters: T.Object(
        {
          path: T.String('Relative path under vault root.'),
          content: T.String('Markdown body, without --- framing.'),
          frontmatter: T.Record('Optional YAML frontmatter object.'),
        },
        ['path', 'content'],
      ),
      promptSnippet: 'vault_write — save a note to the vault (one-shot writes only).',
      execute: async (_id, params, signal) => {
        try {
          const reply = await callKernelTool('vault_write', params, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`vault_write: ${describe(e)}`);
        }
      },
    },

    // ─── C4: Knowledge Retriever ─────────────────────────────────────
    {
      name: 'vault_read',
      label: 'Read vault note',
      description: 'Read a markdown file from the vault; returns frontmatter + body.',
      parameters: T.Object({
        path: T.String('Relative path under vault root.'),
      }),
      execute: async (_id, params, signal) => {
        try {
          const reply = await callKernelTool('vault_read', params, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`vault_read: ${describe(e)}`);
        }
      },
    },
    {
      name: 'vault_search',
      label: 'Search vault',
      description:
        'Full-text search the vault (FTS5 with substring fallback). ' +
        'Returns matching file paths.',
      parameters: T.Object({
        query: T.String('Search query.'),
      }),
      execute: async (_id, params, signal) => {
        try {
          const reply = await callKernelTool('vault_search', params, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`vault_search: ${describe(e)}`);
        }
      },
    },
    {
      name: 'vault_tags',
      label: 'List vault tags',
      description: 'List every tag in the vault with usage count, descending.',
      parameters: T.Object({}, []),
      execute: async (_id, _params, signal) => {
        try {
          const reply = await callKernelTool('vault_tags', {}, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`vault_tags: ${describe(e)}`);
        }
      },
    },
    {
      name: 'vault_backlinks',
      label: 'Vault backlinks',
      description: 'Get backlinks (other notes linking to this one) by path.',
      parameters: T.Object({
        path: T.String('Vault-relative path of the target note.'),
      }),
      execute: async (_id, params, signal) => {
        try {
          const reply = await callKernelTool('vault_backlinks', params, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`vault_backlinks: ${describe(e)}`);
        }
      },
    },

    // ─── C2: Cap Builder ─────────────────────────────────────────────
    {
      name: 'list_local_skills',
      label: 'List skills',
      description:
        'List SKILL.md files installed under the CTRL skill directories. ' +
        'Returns name + description + path. Pass a space-separated query ' +
        'string to filter by token match.',
      parameters: T.Object(
        {
          query: T.String('Optional space-separated query.'),
        },
        [],
      ),
      execute: async (_id, params, signal) => {
        try {
          const reply = await callKernelTool('list_local_skills', params, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`list_local_skills: ${describe(e)}`);
        }
      },
    },
    {
      name: 'install_mcp',
      label: 'Install mcp',
      description:
        'Install a REUSABLE mcp on the user keyboard. ONLY use when ' +
        'the user explicitly asked for a reusable shortcut (they said ' +
        '"a key for X", "a button I can reuse", "shortcut for Y", or the ' +
        'language-equivalent triggers in the capability segment). For ' +
        'one-shot writes / drafts / content generation, use vault_write ' +
        'instead. When uncertain, ask one short question first; never ' +
        'install on a guess.',
      parameters: T.Object({
        manifest: T.Record('Mcp manifest (JSON object with id + name + ...).'),
        server_code: T.String('Optional MCP server TS source.'),
        server_code_filename: T.String('Filename for server_code.'),
      }),
      execute: async (_id, params, signal) => {
        try {
          const reply = await callKernelTool('install_mcp', params, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`install_mcp: ${describe(e)}`);
        }
      },
    },
    {
      name: 'list_mcps',
      label: 'List installed mcps',
      description: 'List the mcps currently installed in the user keyboard.',
      parameters: T.Object({}, []),
      execute: async (_id, _params, signal) => {
        try {
          const reply = await callKernelTool('list_mcps', {}, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`list_mcps: ${describe(e)}`);
        }
      },
    },

    // ─── C3: Cap Invoker ─────────────────────────────────────────────
    {
      name: 'mcp_run',
      label: 'Run mcp',
      description:
        'Run an already-installed mcp by id with the given args. Use ' +
        'when the user names a specific mcp to invoke (e.g. "use ' +
        'frontend-slide" or its language-equivalent trigger).',
      parameters: T.Object({
        mcp_id: T.String('The id of the mcp to run.'),
        args: T.Record('Args matching mcp manifest io.inputs.'),
      }),
      execute: async (_id, params, signal) => {
        try {
          const reply = await callKernelTool('mcp_run', params, signal);
          return toolReply(reply);
        } catch (e: unknown) {
          return toolError(`mcp_run: ${describe(e)}`);
        }
      },
    },

    // bao 2026-06-05 Pi-first: `brain_status` REMOVED from Pi's tool
    // surface. Reason: Pi-first means Pi connects directly to its own
    // LLM provider (via pi-claude-auth → anthropic OAuth). CTRL's
    // provider_registry no longer routes that call, so the brain_status
    // tool returned a stale view ("irisy.primary = ollama-local") even
    // when Pi was actually calling Claude. When the user asked "what
    // model are you", Claude would call brain_status, get the stale
    // CTRL view, and faithfully report "Ollama (local)" — which was
    // wrong. Now Claude self-describes from its training knowledge.
    // The brain_status Tauri command stays — Settings → Providers chip
    // still uses it for CTRL provider_registry inspection (separate
    // concern from Pi's runtime model).
  ];
}

// ─── before_agent_start — capability segment chain-injection ────────────
//
// ADR-005 6 + 7.4 (2026-06-04). The PWA sends a thin base persona; we
// pre-screen the user prompt and append 1-3 capability segments. Each
// segment teaches Pi WHEN to fire which tool, in English (Pi handles
// bilingual user input natively).
//
// Chain semantics: if multiple extensions return {systemPrompt}, Pi
// chains them in registration order. We always run first today because
// ctrl-pi-bridge is the only extension loaded; the chain rule still
// applies so future extensions can append after us without conflict.

type CapabilityId =
  | 'note_writer'
  | 'cap_builder'
  | 'cap_invoker'
  | 'knowledge_retriever'
  | 'system_doctor'
  | 'coding_companion'
  | 'conversation';

const CAPABILITY_SEGMENTS: Record<CapabilityId, string> = {
  note_writer: [
    '## Note writing (C1)',
    'When the user asks to write / save / draft a markdown note (in any',
    'language — see the trigger keyword table) — call vault_write directly.',
    'ONE-LINE acknowledgement with the path. NEVER install a mcp for a',
    'one-shot write. Default save path:',
    '  notes/<YYYY-MM-DD>-<short-slug>.md',
    'Add minimal frontmatter: {kind: "note", created_at: "<ISO>"}.',
  ].join('\n'),

  cap_builder: [
    '## Building a reusable mcp (C2)',
    'ONLY fire when the user explicitly framed the request as a REUSABLE',
    'shortcut — words like "a key for", "a shortcut for", "a button I can',
    'press", "a tool I can reuse", or their language-equivalent triggers.',
    'Without one of those trigger words, DO NOT call install_mcp.',
    'Default to vault_write (C1) or plain chat (C8) instead. If ambiguous,',
    'ask ONE short question: "Just do it once, or do you want a reusable',
    'shortcut?" — never guess and install.',
    '',
    'To build: call list_local_skills with relevant keywords (in the',
    "user's language), then install_mcp with a manifest. All manifest",
    'text (name, icon, input/output labels) MUST be English even when the',
    'user writes in another language — CTRL is English-first; mcps',
    'live on a shared keyboard.',
  ].join('\n'),

  cap_invoker: [
    '## Running an installed mcp (C3)',
    'When the user names a specific installed mcp to invoke ("use X",',
    '"run X cap", or the language-equivalent trigger), call mcp_run',
    'with the matching mcp_id. Get the id from list_mcps if',
    "uncertain. NEVER say \"I don't have skills\" — mcps exist and you",
    'can run them.',
  ].join('\n'),

  knowledge_retriever: [
    '## Vault retrieval (C4)',
    'When the user asks about their existing notes — "find my notes on X",',
    '"what did I write last week", or language-equivalent triggers — use',
    'vault_search first, then vault_read on the most relevant hits. Cite',
    'results as path:line. Use vault_tags to enumerate available tags;',
    'vault_backlinks to walk the link graph.',
  ].join('\n'),

  system_doctor: [
    '## System status questions (C6)',
    'When the user asks about provider / model / login / "which model am',
    'I on", answer briefly from your own self-knowledge (your model),',
    'and point them to Settings -> Providers if they want to change',
    'anything. Do NOT diagnose subsystems out loud. Do NOT name',
    'internal codenames (Pi / claude-oauth / volc / kimi / ollama-local',
    '— these are CTRL routing primitives, not user-facing brand labels).',
  ].join('\n'),

  coding_companion: [
    '## Coding mode (C7)',
    'The user is in Coding mode; project_dir is set in their session.',
    "Use Pi's built-in read / write / edit / bash / grep / find / ls",
    'tools to explore + modify files in that directory. Report changes',
    'as unified diffs in chat. Prefer vault_write for notes about the',
    'project (session summary, design notes) rather than scattering',
    'files in the project tree.',
  ].join('\n'),

  conversation: [
    '## Conversation (C8)',
    'When the user is just chatting ("who are you", "hello", or the',
    'language-equivalent), answer in 1-2 short sentences. No tools,',
    "no preamble. Match the user's language.",
  ].join('\n'),
};

// ─── Trigger keyword tables (pure-ASCII source via \uXXXX escapes) ──────
//
// CTRL pre-commit hook forbids non-ASCII source. The majority of CTRL
// users type in Chinese, so capability triggers must match CJK phrasings.
// We use plain string literals built from \uXXXX escapes and compile via
// `new RegExp(...)`. Source stays ASCII; runtime regex matches CJK input.
//
// Token map (auditable without a Unicode chart):
//   \u952E\u5E3D    = key+cap = mcp
//   \u6309\u94AE    = button
//   \u4E00\u952E    = one-key
//   \u5FEB\u6377    = shortcut
//   \u505A\u4E2A\u952E      = "make a key"
//   \u505A\u4E2A\u6309\u94AE = "make a button"
//   \u6211\u7ECF\u5E38       = "I often"
//   \u7528          = use
//   \u8DD1          = run
//   \u542F\u52A8    = launch
//   \u5199\u7B14\u8BB0       = write-note
//   \u8349\u7A3F             = draft
//   \u5E2E\u6211\u5199       = "help me write"
//   \u5199\u4E2A             = "write a"
//   \u5199\u4E00\u4EFD       = "write one"
//   \u5B58\u5230             = save-to
//   \u5B58\u4E3A             = save-as
//   \u7B14\u8BB0             = note
//   \u521B\u5EFA             = create
//   \u641C                   = search
//   \u67E5                   = look-up
//   \u524D\u51E0\u5929       = "the past few days"
//   \u5386\u53F2             = history
//   \u5207\u6362             = switch (long)
//   \u5207                   = switch (short)
//   \u767B\u5F55             = login
//   \u54EA\u4E2A             = which-one
//   \u4EC0\u4E48\u6A21\u578B = "what model"
//   \u4EE3\u7801             = code
//   \u6539\u4E0B             = fix
//   \u6539\u4E2A             = fix-one
//   \u4F60\u662F\u8C01       = "who are you"
//   \u54C8\u55BD             = hello
//   \u600E\u4E48\u6837       = "how is X"

const CN_CAP_BUILDER =
  '\u952E\u5E3D|\u6309\u94AE|\u4E00\u952E|\u5FEB\u6377|' +
  '\u505A\u4E2A\u952E|\u505A\u4E2A\u6309\u94AE|\u6211\u7ECF\u5E38';

const CN_CAP_INVOKER = '\u7528\\s|\u8DD1\\s|\u542F\u52A8';

const CN_NOTE_WRITER =
  '\u5199\u7B14\u8BB0|\u8349\u7A3F|\u5E2E\u6211\u5199|\u5199\u4E2A|' +
  '\u5199\u4E00\u4EFD|\u5B58\u5230|\u5B58\u4E3A|\u7B14\u8BB0|\u521B\u5EFA';

const CN_KNOWLEDGE_RETRIEVER = '\u641C|\u67E5|\u524D\u51E0\u5929|\u5386\u53F2';

const CN_SYSTEM_DOCTOR =
  '\u5207\u6362|\u5207\\s|\u767B\u5F55|\u54EA\u4E2A|\u4EC0\u4E48\u6A21\u578B';

const CN_CODING_COMPANION = '\u4EE3\u7801|\u6539\u4E0B|\u6539\u4E2A';

const CN_CONVERSATION = '\u4F60\u662F\u8C01|\u54C8\u55BD|\u600E\u4E48\u6837';

const CAPABILITY_KEYWORDS: Record<CapabilityId, RegExp> = {
  cap_builder: new RegExp(
    '(' +
      CN_CAP_BUILDER +
      '|\\bshortcut\\b|\\bmcp\\b|make.*\\bkey\\b|a button|' +
      'reusable|build.*\\btool\\b|tool I can reuse)',
    'i',
  ),
  cap_invoker: new RegExp(
    '(' +
      CN_CAP_INVOKER +
      '|\\brun\\s|\\binvoke\\b|\\btrigger\\b|\\bfire\\b|' +
      'use the .*cap|use my .*cap)',
    'i',
  ),
  note_writer: new RegExp(
    '(' +
      CN_NOTE_WRITER +
      '|\\bsave\\b|\\bdraft\\b|note about|\\bmarkdown\\b|\\bmd\\b)',
    'i',
  ),
  knowledge_retriever: new RegExp(
    '(' +
      CN_KNOWLEDGE_RETRIEVER +
      '|\\bfind\\b|\\bsearch\\b|\\blook up\\b|notes about|recent notes)',
    'i',
  ),
  system_doctor: new RegExp(
    '(' +
      CN_SYSTEM_DOCTOR +
      '|\\bprovider\\b|\\bmodel\\b|\\blogin\\b|\\bAPI key\\b|' +
      '\\bsettings\\b)',
    'i',
  ),
  coding_companion: new RegExp(
    '(' +
      CN_CODING_COMPANION +
      '|\\bcode\\b|\\bbug\\b|\\bfix\\b|\\bdebug\\b|\\brefactor\\b|' +
      '\\bimplement\\b|\\bgit\\b|\\bbuild\\b|\\btest\\b)',
    'i',
  ),
  conversation: new RegExp(
    '(' + CN_CONVERSATION + '|\\bhello\\b|\\bhi\\b|\\bwho are you\\b)',
    'i',
  ),
};

function pickCapabilities(prompt: string): CapabilityId[] {
  const out: CapabilityId[] = [];
  const text = prompt || '';
  // cap_builder before note_writer — "make a key for X" must route to
  // C2 instead of being treated as a generic write.
  for (const cap of [
    'cap_builder',
    'cap_invoker',
    'note_writer',
    'knowledge_retriever',
    'system_doctor',
    'coding_companion',
    'conversation',
  ] as CapabilityId[]) {
    const re = CAPABILITY_KEYWORDS[cap];
    if (re.test(text)) {
      out.push(cap);
      if (out.length >= 3) break;
    }
  }
  if (out.length === 0) out.push('conversation');
  return out;
}

/** Build a 1-paragraph "your runtime is X" block from the live env Pi
 *  was spawned with. Pi-first means CTRL no longer routes the LLM call;
 *  the only honest source for "what am I?" is the Pi process's own
 *  PI_PROVIDER + PI_MODEL env (set by ctrl-pi-plugin PiBridge before
 *  RpcClient.start). We DO NOT call any external tool to look this up
 *  — that's what got us into the stale-state loop when CTRL's
 *  brain_status was the source. bao 2026-06-05 — "give Irisy the truth,
 *  stop guessing". */
function runtimeTruthBlock(): string {
  const provider = process.env.PI_PROVIDER ?? 'unknown';
  const model = process.env.PI_MODEL ?? 'unknown';
  const isClaudeOAuth = provider === 'anthropic';
  const billingHint = isClaudeOAuth
    ? "no per-token cost (the user's Claude Pro/Max subscription via Claude Code OAuth — pi-claude-auth extension wired this)"
    : provider.startsWith('ollama')
      ? 'local Ollama, no network cost'
      : 'see ~/.pi/agent/models.json for endpoint';
  return [
    '## Your runtime (truth, not a guess)',
    `- Provider: ${provider}`,
    `- Model: ${model}`,
    `- Cost: ${billingHint}`,
    '',
    'When asked "what model are you", answer with the model + a short',
    'phrase about the path. Do NOT say "I don\'t know" / "go check',
    'Settings" / "no brain_state configured". You DO know — the values',
    'above are the live runtime, set by the Pi process you are running in.',
  ].join('\n');
}

async function beforeAgentStartHandler(
  evt: PiBeforeAgentStartEvent,
): Promise<PiBeforeAgentStartResult> {
  // Reset the tool_call loop guard at the start of every new turn.
  recentCalls = [];

  const capabilities = pickCapabilities(evt.prompt);
  const segments = [runtimeTruthBlock()];
  for (const c of capabilities) {
    const seg = CAPABILITY_SEGMENTS[c];
    if (typeof seg === 'string') segments.push(seg);
  }
  const appended = segments.join('\n\n');
  const next = evt.systemPrompt
    ? `${evt.systemPrompt}\n\n${appended}`
    : appended;
  return { systemPrompt: next };
}

// ─── tool_call inspector — runaway loop guard (ADR-005 7.4) ─────────────

interface CallRecord {
  toolName: string;
  inputKey: string;
}

let recentCalls: CallRecord[] = [];
const MAX_IDENTICAL_CALLS = 5;

function inputKey(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

async function toolCallInspectorHandler(
  evt: PiToolCallEvent,
): Promise<PiToolCallResult> {
  const key = inputKey(evt.input);
  recentCalls.push({ toolName: evt.toolName, inputKey: key });
  if (recentCalls.length > MAX_IDENTICAL_CALLS * 2) {
    recentCalls = recentCalls.slice(-MAX_IDENTICAL_CALLS);
  }

  const tail = recentCalls.slice(-MAX_IDENTICAL_CALLS);
  if (tail.length === MAX_IDENTICAL_CALLS) {
    const first = tail[0];
    const allSame = tail.every(
      (r) => r.toolName === first?.toolName && r.inputKey === first?.inputKey,
    );
    if (allSame) {
      recentCalls = [];
      return {
        block: true,
        reason:
          `Detected ${MAX_IDENTICAL_CALLS} identical ${evt.toolName} calls ` +
          `in a row. Blocking to prevent infinite loop. The previous ` +
          `attempts did not change the world; try a different approach.`,
      };
    }
  }
  return {};
}

// ─── resources_discover — bridge ~/.claude/skills into Pi Skills ────────
//
// ADR-005 7.4 (2026-06-04). CTRL skills live in ~/.claude/skills/
// (user-managed) + ~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/skills/
// (plugin-supplied). Pi already understands SKILL.md but only scans
// ~/.pi/agent/skills/ by default. We hand it the CTRL paths so the user
// gets /skill:<name> slash commands without symlinks.

async function resourcesDiscoverHandler(
  _evt: PiResourcesDiscoverEvent,
): Promise<PiResourcesDiscoverResult> {
  const skillPaths: string[] = [];
  const home = os.homedir();

  // 1. User skills: ~/.claude/skills/<name>/SKILL.md
  collectSkillsInto(path.join(home, '.claude', 'skills'), skillPaths);

  // 2. Plugin-cached skills:
  //    ~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/skills/<name>/SKILL.md
  const cacheRoot = path.join(home, '.claude', 'plugins', 'cache');
  try {
    for (const mkt of safeReadDir(cacheRoot)) {
      const mktPath = path.join(cacheRoot, mkt);
      for (const plugin of safeReadDir(mktPath)) {
        const pluginPath = path.join(mktPath, plugin);
        for (const version of safeReadDir(pluginPath)) {
          collectSkillsInto(
            path.join(pluginPath, version, 'skills'),
            skillPaths,
          );
        }
      }
    }
  } catch {
    // Plugin cache absent on a fresh install — fine.
  }

  return { skillPaths };
}

function collectSkillsInto(rootDir: string, out: string[]): void {
  for (const name of safeReadDir(rootDir)) {
    const skillMd = path.join(rootDir, name, 'SKILL.md');
    try {
      if (fs.statSync(skillMd).isFile()) {
        out.push(skillMd);
      }
    } catch {
      // Not a skill dir — skip.
    }
  }
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// ─── ADR-009 P2 — apply default active tools after runtime bind ─────────
//
// pi.setActiveTools() is a runtime ACTION method (loader.js:115-123 in
// pi-coding-agent 0.73), backed by a `notInitialized` throwing stub
// during the extension factory pass. Calling it eagerly from register()
// throws → loader.js:314 catches → the whole extension fails to load
// (no handlers, no commands, no tools). Defer to `session_start`,
// which fires after the runner has bound real implementations.
//
// Fires on every session_start (reason: startup|reload|new|resume|fork)
// because each session is a fresh mode context — within-session
// `/switch coding` is per-session and a new session should reset to
// the conservative default (extension tools only).
async function applyDefaultActiveTools(): Promise<void> {
  // bao 2026-06-05: DO NOT restrict Pi's built-in tools.
  //
  // Previously this called pi.setActiveTools([10 kernel tool names]),
  // restricting the active set to bridge-registered tools only. That
  // silently excluded Pi's built-in WebSearch / WebFetch / Read / Write /
  // Edit / Bash / Grep / Find / Ls / TodoWrite / Task / NotebookRead /
  // NotebookEdit — making Irisy answer "I do not have internet" when the
  // user asked for a web research task, and unable to organize files
  // without installing extra mcps.
  //
  // bao directive: do not exclude any of Pi's built-in capabilities; the
  // assistant must default to the complete Pi tool surface. The persona
  // layer must not silently strip what Pi already provides.
  //
  // The function is kept (instead of deleted) so future opt-in scope
  // policy (e.g. user-explicit /scope minimal) can hook here.
  // Aligns with irisy-build skill I5 ("tools come from outside Irisy").
  return;
}

// Set by register() so out-of-band handlers (session_start, etc.) can
// reach the Pi API without us threading it through every event signature.
let activePiRef: PiExtensionApi | null = null;

// ─── ADR-009 P1 — session_compact → vault summary ───────────────────────
//
// When Pi compacts a session (token-budget hit, automatic), persist the
// LLM-generated summary into `vault/irisy/compacted/<date>-<session>.md`
// so the user can grep / vim / git-diff what was forgotten. ADR-009 §3
// D4 lock: compaction summary lives in vault, never Pi-internal-only —
// vault is source of truth (`decision_ctrl_obsidian_philosophy`).

async function sessionCompactHandler(evt: PiSessionCompactEvent): Promise<void> {
  const entry = evt.compactionEntry;
  if (!entry || !entry.summary || entry.summary.trim().length === 0) return;
  const date = new Date().toISOString().slice(0, 10);
  // entry.id may contain : / etc; sanitize to a vault-safe basename.
  const sessionSlug = entry.id.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 64);
  const vaultPath = `irisy/compacted/${date}-${sessionSlug}.md`;
  const body = [
    '# Compaction summary',
    '',
    `_Pi compacted this session at ${entry.timestamp}; ${entry.tokensBefore} tokens before compaction._`,
    '',
    entry.summary.trim(),
  ].join('\n');
  try {
    await callKernelTool(
      'vault_write',
      {
        path: vaultPath,
        content: body,
        frontmatter: {
          kind: 'irisy-compaction',
          created_at: entry.timestamp,
          session_id: entry.id,
          tokens_before: entry.tokensBefore,
          first_kept_entry_id: entry.firstKeptEntryId,
          from_extension: entry.fromHook === true,
        },
      },
      undefined,
    );
  } catch {
    // Best-effort: a vault write failure here must not crash Pi. The
    // compaction has already happened on Pi's side; we just lose the
    // audit log for this one event.
  }
}

// ─── ADR-009 P4 — turn_end → curator cadence trigger ────────────────────

const CURATOR_CADENCE = 5;
let turnsSinceCuration = 0;

async function turnEndHandler(
  pi: PiExtensionApi,
  evt: PiTurnEndEvent,
): Promise<void> {
  turnsSinceCuration += 1;
  if (turnsSinceCuration < CURATOR_CADENCE) return;
  turnsSinceCuration = 0;
  if (!pi.sendMessage) return;
  try {
    pi.sendMessage(
      {
        customType: 'irisy-curator-nudge',
        content: {
          reason: 'cadence',
          turnsSinceLast: CURATOR_CADENCE,
          requestedAt: new Date().toISOString(),
        },
        display: {
          title: 'Curator nudge',
          summary: `${CURATOR_CADENCE} turns since last curation - consider proposing playbook updates.`,
        },
      },
      { triggerTurn: false, deliverAs: 'followUp' },
    );
  } catch {
    /* sendMessage shape mismatch is non-fatal */
  }
  void evt.turnIndex;
}

// ─── ADR-009 P4 — tool_execution_end (isError) → reflection trigger ─────

async function toolExecutionEndHandler(
  pi: PiExtensionApi,
  evt: PiToolExecutionEndEvent,
): Promise<void> {
  if (!evt.isError) return;
  if (!pi.sendUserMessage) return;
  const tool = evt.toolName || 'unknown';
  const resultSummary = summariseToolResult(evt.result);
  try {
    pi.sendUserMessage(
      `Tool '${tool}' failed. Result: ${resultSummary}. Briefly tell me what blocked and one concrete next step. No apology.`,
      { deliverAs: 'followUp' },
    );
  } catch {
    /* non-fatal */
  }
}

function summariseToolResult(result: unknown): string {
  if (result == null) return '(no result)';
  if (typeof result === 'string') return result.slice(0, 300);
  try {
    const s = JSON.stringify(result);
    return s.length > 300 ? s.slice(0, 297) + '...' : s;
  } catch {
    return String(result).slice(0, 300);
  }
}

// ─── ADR-009 P4 — session_shutdown → final curator pass ─────────────────

async function sessionShutdownHandler(
  pi: PiExtensionApi,
  evt: PiSessionShutdownEvent,
): Promise<void> {
  turnsSinceCuration = 0;
  recentCalls = [];
  if (!pi.sendMessage) return;
  try {
    pi.sendMessage(
      {
        customType: 'irisy-curator-nudge',
        content: {
          reason: 'session_end',
          shutdownReason: evt.reason,
          requestedAt: new Date().toISOString(),
        },
        display: {
          title: 'Curator nudge (session end)',
          summary: 'Session ending - consider distilling 1 lasting lesson.',
        },
      },
      { triggerTurn: false, deliverAs: 'followUp' },
    );
  } catch {
    /* non-fatal */
  }
}

// ─── ADR-009 P5 — slash commands (Raycast "surface = intent") ──────────
//
// User types `/<name> <args>` in chat; Pi routes to our handler before
// the LLM round-trip. Deterministic intent surface — brain never has
// to classify natural language for these. Brainstorm §0.2.
//
// Examples (kept English-only per CLAUDE.md code-language rule; CJK
// args from users still flow through fine):
//   /discover twenty crm
//   /cap html-slides
//   /note Read about LangChain 0.3 today
//   /soul
//   /switch coding

function registerSlashCommands(pi: PiExtensionApi): void {
  if (!pi.registerCommand) return;

  pi.registerCommand('discover', {
    description: 'Open Discover to find + install caps (skills / MCP servers).',
    handler: (args, _ctx) => {
      const query = (args || '').trim();
      pi.sendMessage?.(
        {
          customType: 'irisy-open-discover',
          content: { query },
          display: {
            title: 'Open Discover',
            summary: query ? `Searching "${query}"...` : 'Browsing all caps...',
          },
        },
        { triggerTurn: false },
      );
    },
  });

  pi.registerCommand('cap', {
    description: 'Run an installed cap by id. Example: /cap html-slides topic',
    handler: async (args, _ctx) => {
      const trimmed = (args || '').trim();
      if (!trimmed) {
        pi.sendUserMessage?.(
          'Tell me which cap to run, e.g. `/cap html-slides`.',
          { deliverAs: 'followUp' },
        );
        return;
      }
      const [capId, ...rest] = trimmed.split(/\s+/);
      const inputText = rest.join(' ');
      try {
        await callKernelTool(
          'mcp_run',
          { mcp_id: capId, input: { text: inputText } },
          undefined,
        );
      } catch (err) {
        pi.sendUserMessage?.(
          `Cap '${capId}' failed to run: ${err instanceof Error ? err.message : String(err)}`,
          { deliverAs: 'followUp' },
        );
      }
    },
  });

  pi.registerCommand('note', {
    description: 'Save a quick note to vault. Example: /note Read X today',
    handler: async (args, _ctx) => {
      const body = (args || '').trim();
      if (!body) {
        pi.sendUserMessage?.(
          'Give me the note body, e.g. `/note Read about X today`.',
          { deliverAs: 'followUp' },
        );
        return;
      }
      const date = new Date().toISOString().slice(0, 10);
      // CJK range 一-鿿 kept as escape so source stays ASCII
      // (CLAUDE.md code-language rule). Runtime regex still matches
      // Chinese chars when the user's note body is in Chinese.
      const slug =
        body
          .slice(0, 40)
          .replace(/[^a-zA-Z0-9一-鿿]+/g, '-')
          .replace(/^-|-$/g, '')
          .toLowerCase() || 'note';
      const vaultPath = `notes/${date}/${slug}.md`;
      try {
        await callKernelTool(
          'vault_write',
          {
            path: vaultPath,
            content: body,
            frontmatter: {
              kind: 'note',
              created_at: new Date().toISOString(),
              source: 'irisy-slash-note',
            },
          },
          undefined,
        );
        pi.sendMessage?.(
          {
            customType: 'irisy-vault-write-ack',
            content: { path: vaultPath },
            display: { title: 'Saved', summary: vaultPath },
          },
          { triggerTurn: false },
        );
      } catch (err) {
        pi.sendUserMessage?.(
          `Could not save note: ${err instanceof Error ? err.message : String(err)}`,
          { deliverAs: 'followUp' },
        );
      }
    },
  });

  pi.registerCommand('soul', {
    description: 'Open SOUL.md so you can edit how Irisy behaves.',
    handler: (_args, _ctx) => {
      pi.sendMessage?.(
        {
          customType: 'irisy-open-vault-tab',
          content: { path: 'irisy/SOUL.md' },
          display: {
            title: 'Open SOUL.md',
            summary: 'vault/irisy/SOUL.md',
          },
        },
        { triggerTurn: false },
      );
    },
  });

  // /switch — toggle session mode + reshape Pi's active tool set
  // accordingly. ADR-009 P2: coding mode enables the 7 Pi built-ins
  // (read/write/edit/bash/grep/find/ls) on top of our 10 extension
  // tools; personal / cap mode restricts to extension tools only so
  // Pi can't quietly read user files outside vault.
  pi.registerCommand('switch', {
    description: 'Switch session mode. Example: /switch coding',
    handler: (args, _ctx) => {
      const mode = (args || '').trim().toLowerCase();
      if (!['personal', 'coding', 'cap'].includes(mode)) {
        pi.sendUserMessage?.(
          'Modes are `personal` / `coding` / `cap`. Example: `/switch coding`.',
          { deliverAs: 'followUp' },
        );
        return;
      }
      if (pi.setActiveTools) {
        const kernelToolNames = buildKernelTools().map((t) => t.name);
        const builtins = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'];
        const active =
          mode === 'coding'
            ? [...kernelToolNames, ...builtins]
            : kernelToolNames;
        try {
          pi.setActiveTools(active);
        } catch {
          /* tool name mismatch on Pi update — skip silently */
        }
      }
      pi.sendMessage?.(
        {
          customType: 'irisy-mode-switch',
          content: { mode },
          display: { title: 'Mode', summary: `Now in ${mode} mode.` },
        },
        { triggerTurn: false },
      );
    },
  });
}
