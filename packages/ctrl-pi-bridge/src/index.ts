// @ctrl/pi-bridge — Pi extension that routes Pi's LLM calls back into the
// CTRL kernel provider sub-system.
//
// Loaded into Pi via `pi --extension <bundled-path>` (see
// shell/brain_supervisor.rs). On load, registers a single provider named
// "ctrl-bridge" with Pi's extension API. Pi's agent loop then has one
// provider, one model — "ctrl-bridge" / "default" — and every LLM call
// goes through `streamSimple`, which HTTP-POSTs to a kernel endpoint
// the Rust side owns (ADR-004 §9.1 lock #7).
//
// Rationale (ADR-003 §2 + Round-2 finding): Pi has no MCP-client surface,
// so the only seam for routing Pi's LLM call through the kernel provider
// sub-system is `pi.registerProvider({ streamSimple })`. Keeping this
// extension thin (one file, no transitive deps beyond Pi's own surface)
// means upstream Pi version bumps either keep working or fail loudly at
// extension-load time, never silently.
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

export const BRIDGE_PROVIDER_NAME = 'ctrl-bridge';
export const BRIDGE_MODEL_NAME = 'default';
export const BRIDGE_ENV_PORT = 'CTRL_PROVIDER_PORT';
export const BRIDGE_ENV_TOKEN = 'CTRL_PROVIDER_TOKEN';

// ── Pi extension API surface (locally typed) ────────────────────────────

export interface PiExtensionApi {
  registerProvider: (id: string, provider: PiProvider) => void;
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
  pi.registerProvider(BRIDGE_PROVIDER_NAME, {
    api: BRIDGE_PROVIDER_NAME,
    baseUrl: 'http://127.0.0.1',
    apiKey: 'ctrl-bridge-streamSimple-bypass',
    models: [BRIDGE_MODEL_NAME],
    streamSimple: (model, ctx, opts) => streamFromKernel(model, ctx, opts),
  });
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
