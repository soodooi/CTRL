// [H-2026-05-18-001] LLMTransport — Volc-default, OpenAI-shape messages,
// transport-agnostic.
//
// v1 production impl: RunKeycapTransport — single-shot via the kernel
// builtin `ctrl.builtin.text-chat` (zeus Z3a). UI fake-streams the result
// by chunking 5 chars / 25ms so the chat pane reads like a stream until
// zeus Z3b ships true streaming.
//
// v1.x impl: ChatStreamTransport — true streaming via Tauri command
// `chat_stream` + `chat-stream-delta` event (zeus Z3b). Skeleton present
// so the call sites compile and the swap is a one-liner.
//
// Zero legacy-provider strings in this file — per ADR-005 + memory
// `feedback_no_claude_in_production`. The PWA never sees an apiKey; auth
// stays inside the Rust process by going through `run_keycap` /
// `chat_stream` Tauri commands.

import { invoke } from './bridge';
import { runKeycap, type RunKeycapResult } from './kernel';

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMChunk {
  delta: string;
  done: boolean;
  error?: string;
}

export interface LLMStreamOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}

export interface LLMTransport {
  stream(messages: LLMMessage[], opts?: LLMStreamOptions): AsyncIterable<LLMChunk>;
}

// ── C: single-shot via runKeycap('ctrl.builtin.text-chat', ...) ──────────
// The kernel builtin reads `volc-credentials.json` for default model + key
// (zeus Z3a). Pseudo-streams the returned content so the chat pane animates
// while we wait for Z3b.

interface RunKeycapTextChatInput extends Record<string, unknown> {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
}

interface RunKeycapTextChatOutput {
  content: string;
}

const PSEUDO_STREAM_CHUNK = 5;
const PSEUDO_STREAM_TICK_MS = 25;

export class RunKeycapTransport implements LLMTransport {
  async *stream(
    messages: LLMMessage[],
    opts: LLMStreamOptions = {},
  ): AsyncIterable<LLMChunk> {
    const input: RunKeycapTextChatInput = { messages };
    if (opts.model !== undefined) input.model = opts.model;
    if (opts.temperature !== undefined) input.temperature = opts.temperature;

    let result: RunKeycapResult;
    try {
      result = await runKeycap('ctrl.builtin.text-chat', input);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown error';
      yield { delta: '', done: true, error: message };
      return;
    }

    const output = result.output as RunKeycapTextChatOutput | null | undefined;
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
}

interface UnlistenFn {
  (): void;
}

export class ChatStreamTransport implements LLMTransport {
  // `commandName` lets one class drive both wires:
  //   - 'chat_stream'        → raw LLM (kernel llm_port direct, keycap-internal)
  //   - 'irisy_chat_stream'  → BrainRouter inline → active brain keycap MCP
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
    const { listen } = await import('@tauri-apps/api/event');

    const queue: ChatStreamDelta[] = [];
    let resolveNext: (() => void) | null = null;
    const wakeWaiter = (): void => {
      const w = resolveNext;
      if (w) {
        resolveNext = null;
        w();
      }
    };
    const unlisten: UnlistenFn = await listen<ChatStreamDelta>(
      'chat-stream-delta',
      (event) => {
        if (event.payload.request_id !== requestId) return;
        queue.push(event.payload);
        wakeWaiter();
      },
    );
    // Abort listener wakes any pending Promise so the while-loop's
    // signal.aborted check fires immediately instead of hanging forever
    // when no further chat-stream-delta arrives (e.g. user cancelled
    // before the first chunk).
    const onAbort = (): void => wakeWaiter();
    opts.signal?.addEventListener('abort', onAbort);

    try {
      await invoke(this.commandName, {
        args: {
          request_id: requestId,
          messages,
          model: opts.model,
          temperature: opts.temperature,
          max_tokens: opts.max_tokens,
        },
      });
      while (true) {
        if (opts.signal?.aborted) {
          yield { delta: '', done: true, error: 'aborted' };
          return;
        }
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
          continue;
        }
        const next = queue.shift();
        if (!next) continue;
        if (next.error) {
          yield { delta: '', done: true, error: next.error };
          return;
        }
        if (next.delta) yield { delta: next.delta, done: false };
        if (next.done) {
          yield { delta: '', done: true };
          return;
        }
      }
    } finally {
      // Drain any pending deltas the listener queued after the consumer
      // stopped pulling — otherwise an aborted/early-returning stream
      // leaves them dangling in the closure until GC.
      queue.length = 0;
      opts.signal?.removeEventListener('abort', onAbort);
      unlisten();
    }
  }
}

export function defaultTransport(): LLMTransport {
  return new ChatStreamTransport(true, 'chat_stream');
}

// Irisy → active brain keycap (Pi default) via kernel's BrainRouter inline
// dispatch. Use this for the general Irisy companion chat path. Pi runs its
// own agent loop + tools through its own MCP client; the PWA stays
// single-turn streaming on this side.
export function irisyChatTransport(): LLMTransport {
  return new ChatStreamTransport(true, 'irisy_chat_stream');
}
