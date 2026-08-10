// [H-2026-05-18-001] LLMTransport — Volc-default, OpenAI-shape messages,
// transport-agnostic.
//
// v1 production impl: RunMcpTransport — single-shot via the kernel
// builtin `ctrl.builtin.text-chat` (zeus Z3a). UI fake-streams the result
// by chunking 5 chars / 25ms so the chat pane reads like a stream until
// zeus Z3b ships true streaming.
//
// v1.x impl: ChatStreamTransport — true streaming via Tauri command
// `chat_stream` + `chat-stream-delta` event (zeus Z3b). Skeleton present
// so the call sites compile and the swap is a one-liner.
//
// Zero legacy-provider strings in this file — per ADR-006 cross-cutting § byok-no-claude v1 + memory
// `feedback_no_claude_in_production`. The PWA never sees an apiKey; auth
// stays inside the Rust process by going through `run_mcp` /
// `chat_stream` Tauri commands.

import { invoke } from './bridge';
import { runMcp, type RunMcpResult } from './kernel';

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

/** Custom message payload from Pi via the slash-command path (ADR-002 substrate (orig ADR-009 retired by v19)
 *  P3/P5). `customType` is one of the irisy-* names registered in
 *  ctrl-pi-bridge; `content` / `display` shapes vary by customType and
 *  are validated at the renderer dispatch site. */
export interface IrisyCustomMessage {
  customType: string;
  content?: unknown;
  display?: { title?: string; summary?: string };
  details?: unknown;
}

export interface LLMChunk {
  delta: string;
  done: boolean;
  error?: string;
  /** Set when this chunk carries a Pi custom message (slash command
   *  intent). `delta` is empty in this case — the chat UI should
   *  render the custom message via IrisyCustomMessage component, not
   *  append text to the assistant bubble. */
  custom?: IrisyCustomMessage;
  /** ADR-005 §8.6 terminal-essence transparency — a tool-call step the engine
   *  streamed alongside the answer (see it work). `delta` is empty; the chat UI
   *  renders it as a step in the assistant turn, drill-down to input/output. */
  tool?: ToolStep;
  /** ADR-005 §8.6 — a chunk of the engine's reasoning (see it think). `delta` is
   *  empty; the chat UI accumulates these into a collapsible "thinking" trace. */
  thought?: string;
}

/** One tool-call step from the engine (ADR-005 §8.6). Emitted twice per call:
 *  `phase: 'call'` (title + input) then `phase: 'result'` (status + output),
 *  correlated by `tool_call_id`. Mirrors the Rust `ToolStep` in irisy_chat.rs. */
export interface ToolStep {
  request_id: string;
  tool_call_id: string;
  phase: 'call' | 'result';
  title: string;
  status?: string;
  input?: string;
  output?: string;
}

/** One file dropped into a composer alongside a turn (ADR-002 substrate
 *  §1.8.6 v75; ADR-005 irisy §8.7 v32). Mirrors Coding's `CodingAttachment`
 *  (coding-chat.ts) — the kernel reads the file server-side from `path`;
 *  the frontend never reads file bytes. */
export interface LLMAttachment {
  path: string;
  name: string;
}

export interface IrisyTurnContext {
  session_id: string;
  resources: string[];
  skill_id?: string;
  capability_scope: string[];
  policy: string;
  task: string;
}

export interface LLMStreamOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
  /** Files dropped alongside this turn — only meaningful on the ACP engine
   *  path (irisy_chat_stream); the provider-router fallback has no
   *  attachment support. */
  attachments?: LLMAttachment[];
  /** The complete Irisy runtime projection for one canonical session turn.
   *  Legacy mode, project-path, and engine selectors are intentionally absent.
   *  (ADR-005 irisy §11 v40) */
  context?: IrisyTurnContext;
}

export interface LLMTransport {
  stream(messages: LLMMessage[], opts?: LLMStreamOptions): AsyncIterable<LLMChunk>;
}

// ── C: single-shot via runMcp('ctrl.builtin.text-chat', ...) ──────────
// The kernel builtin reads `volc-credentials.json` for default model + key
// (zeus Z3a). Pseudo-streams the returned content so the chat pane animates
// while we wait for Z3b.

interface RunMcpTextChatInput extends Record<string, unknown> {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
}

interface RunMcpTextChatOutput {
  content: string;
}

const PSEUDO_STREAM_CHUNK = 5;
const PSEUDO_STREAM_TICK_MS = 25;

export class RunMcpTransport implements LLMTransport {
  async *stream(
    messages: LLMMessage[],
    opts: LLMStreamOptions = {},
  ): AsyncIterable<LLMChunk> {
    const input: RunMcpTextChatInput = { messages };
    if (opts.model !== undefined) input.model = opts.model;
    if (opts.temperature !== undefined) input.temperature = opts.temperature;

    let result: RunMcpResult;
    try {
      result = await runMcp('ctrl.builtin.text-chat', input);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error';
      yield { delta: '', done: true, error: message };
      return;
    }

    const output = result.output as RunMcpTextChatOutput | null | undefined;
    const full = typeof output?.content === 'string' ? output.content : '';

    for (let i = 0; i < full.length; i += PSEUDO_STREAM_CHUNK) {
      if (opts.signal?.aborted) {
        yield { delta: '', done: true, error: 'aborted' };
        return;
      }
      yield { delta: full.slice(i, i + PSEUDO_STREAM_CHUNK), done: false };
      await new Promise<void>((resolve) => {
        setTimeout(resolve, PSEUDO_STREAM_TICK_MS);
      });
    }
    yield { delta: '', done: true };
  }
}

// ── B: true streaming via chat_stream + chat-stream-delta ─────────────────
// Contract per bao 2026-05-18:
//   invoke('chat_stream', { request_id, messages, model, temperature })
//   listen('chat-stream-delta', payload => { request_id, delta, done, error? })
// Skeleton compiles today; flip `enabled` to true once zeus Z3b lands.

interface ChatStreamDelta {
  request_id: string;
  delta: string;
  done: boolean;
  error?: string;
  /** ADR-002 substrate (orig ADR-009 retired by v19) P3 — Pi custom message relayed by irisy_chat.rs through
   *  the same chat-stream-delta channel. Skipped when absent. */
  custom?: IrisyCustomMessage;
}

interface UnlistenFn {
  (): void;
}

export class ChatStreamTransport implements LLMTransport {
  // `commandName` lets one class drive both wires:
  //   - 'chat_stream'        → raw LLM (kernel llm_port direct, mcp-internal)
  //   - 'irisy_chat_stream'  → BrainRouter inline → active brain mcp MCP
  // Both emit the same chat-stream-delta event shape; only the Tauri
  // command name differs.
  constructor(
    private readonly enabled: boolean = false,
    private readonly commandName: string = 'chat_stream',
  ) {}

  async *stream(
    messages: LLMMessage[],
    opts: LLMStreamOptions = {},
  ): AsyncIterable<LLMChunk> {
    if (!this.enabled) {
      yield {
        delta: '',
        done: true,
        error: 'ChatStreamTransport disabled (waiting on zeus Z3b)',
      };
      return;
    }
    // Early-out before any listener registration / invoke if the caller
    // already aborted — otherwise we'd register a Tauri listener and fire
    // chat_stream just to throw the result away.
    if (opts.signal?.aborted) {
      yield { delta: '', done: true, error: 'aborted' };
      return;
    }
    const requestId = crypto.randomUUID();

    // One ordered queue carries every channel so text, reasoning and tool steps
    // interleave in the true order the engine produced them (ADR-005 §8.6).
    type QueueItem =
      | { delta: ChatStreamDelta }
      | { tool: ToolStep }
      | { thought: string };
    const queue: QueueItem[] = [];
    const unlisteners: UnlistenFn[] = [];
    let resolveNext: (() => void) | null = null;
    const wakeWaiter = (): void => {
      const waiter = resolveNext;
      if (waiter) {
        resolveNext = null;
        waiter();
      }
    };
    const onAbort = (): void => wakeWaiter();
    opts.signal?.addEventListener('abort', onAbort);
    const aborted = (): boolean => opts.signal?.aborted === true;

    try {
      const { listen } = await import('@tauri-apps/api/event');
      if (aborted()) {
        yield { delta: '', done: true, error: 'aborted' };
        return;
      }

      unlisteners.push(await listen<ChatStreamDelta>(
        'chat-stream-delta',
        (event) => {
          if (event.payload.request_id !== requestId) return;
          queue.push({ delta: event.payload });
          wakeWaiter();
        },
      ));
      if (aborted()) {
        yield { delta: '', done: true, error: 'aborted' };
        return;
      }

      unlisteners.push(await listen<ToolStep>(
        'chat-stream-tool',
        (event) => {
          if (event.payload.request_id !== requestId) return;
          queue.push({ tool: event.payload });
          wakeWaiter();
        },
      ));
      if (aborted()) {
        yield { delta: '', done: true, error: 'aborted' };
        return;
      }

      unlisteners.push(await listen<{
        request_id: string;
        delta: string;
      }>('chat-stream-thought', (event) => {
        if (event.payload.request_id !== requestId) return;
        queue.push({ thought: event.payload.delta });
        wakeWaiter();
      }));
      if (aborted()) {
        yield { delta: '', done: true, error: 'aborted' };
        return;
      }

      // No command can cross the native boundary after cancellation during
      // dynamic import or listener setup. Partial setup is always unwound by
      // the cleanup stack below. (ADR-005 irisy §11 v40)
      await invoke(this.commandName, {
        args: {
          request_id: requestId,
          messages,
          model: opts.model,
          temperature: opts.temperature,
          max_tokens: opts.max_tokens,
          context: opts.context,
          attachments: opts.attachments ?? [],
        },
      });
      while (true) {
        if (aborted()) {
          yield { delta: '', done: true, error: 'aborted' };
          return;
        }
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
          continue;
        }
        const item = queue.shift();
        if (!item) continue;
        if ('tool' in item) {
          yield { delta: '', done: false, tool: item.tool };
          continue;
        }
        if ('thought' in item) {
          yield { delta: '', done: false, thought: item.thought };
          continue;
        }
        const next = item.delta;
        if (next.error) {
          yield { delta: '', done: true, error: next.error };
          return;
        }
        if (next.custom) yield { delta: '', done: false, custom: next.custom };
        if (next.delta) yield { delta: next.delta, done: false };
        if (next.done) {
          yield { delta: '', done: true };
          return;
        }
      }
    } finally {
      queue.length = 0;
      resolveNext = null;
      opts.signal?.removeEventListener('abort', onAbort);
      for (const unlisten of unlisteners.reverse()) unlisten();
    }
  }
}

export function defaultTransport(): LLMTransport {
  return new ChatStreamTransport(true, 'chat_stream');
}

// Irisy → active brain mcp (Pi default) via kernel's BrainRouter inline
// dispatch. Use this for the general Irisy companion chat path. Pi runs its
// own agent loop + tools through its own MCP client; the PWA stays
// single-turn streaming on this side.
export function irisyChatTransport(): LLMTransport {
  return new ChatStreamTransport(true, 'irisy_chat_stream');
}

// ── engineTransport — the one managed Irisy entrypoint ──────────────────────
//
// The embedded path is fixed to Irisy. User-owned CLIs are external :17873
// clients and are never selected, started, or supervised by this transport.
// (ADR-001 spine §4 v22; ADR-005 irisy §11 v40)
class EngineTransport implements LLMTransport {
  private readonly inner = irisyChatTransport();

  stream(
    messages: LLMMessage[],
    opts: LLMStreamOptions = {},
  ): AsyncIterable<LLMChunk> {
    return this.inner.stream(messages, opts);
  }
}

/** The sole managed Irisy transport. */
export function engineTransport(): LLMTransport {
  return new EngineTransport();
}
