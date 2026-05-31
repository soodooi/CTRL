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

/** Minimum surface of Pi's extension API this extension touches. We type
 *  it locally rather than importing from `@mariozechner/pi-coding-agent`
 *  so this package has no hard runtime dependency on a specific Pi
 *  version — the host Pi process injects the real API at load time. */
export interface PiExtensionApi {
  registerProvider: (id: string, provider: PiProvider) => void;
}

/** Pi message shape mirrors OpenAI-shape conversation history. */
export interface PiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Subset of Pi's per-call context. We currently use only `messages`,
 *  but accept the full object so future Pi fields (system prompt,
 *  tool definitions, etc.) flow through unchanged. */
export interface PiStreamContext {
  messages: PiMessage[];
  system?: string;
}

export interface PiStreamOpts {
  signal?: AbortSignal;
}

/** One yielded chunk from Pi's `streamSimple`. We only emit
 *  `assistant_message_delta` (text tokens) + `stop` (terminal). */
export type PiStreamEvent =
  | { type: 'assistant_message_delta'; delta: string }
  | { type: 'stop'; stop_reason: string };

export interface PiProvider {
  api: string;
  models: string[];
  streamSimple: (
    model: string,
    ctx: PiStreamContext,
    opts?: PiStreamOpts,
  ) => AsyncIterable<PiStreamEvent>;
}

/** Pi loads this default export with the extension API as its argument.
 *  Synchronous registration only — Pi caches the provider on first call.
 *
 *  When `CTRL_PROVIDER_PORT` is unset we still register so Pi has at
 *  least one provider; the first stream call surfaces a typed error
 *  instead of a load-time crash. The supervisor always sets the env;
 *  the unset path is purely for unit tests + paranoia. */
export default function register(pi: PiExtensionApi): void {
  pi.registerProvider(BRIDGE_PROVIDER_NAME, {
    api: BRIDGE_PROVIDER_NAME,
    // Pi's registerProvider validates that any provider declaring
    // `models` must also declare `baseUrl` AND (`apiKey` | `oauth`),
    // even when `streamSimple` bypasses HTTP entirely and never reads
    // either field. Placeholder values keep validation happy; the real
    // transport target is read from env (`CTRL_PROVIDER_PORT`) at
    // stream time. bao 2026-05-31 (118-trail): two-step probe surfaced
    // "baseUrl required" then "apiKey or oauth required".
    baseUrl: 'http://127.0.0.1',
    apiKey: 'ctrl-bridge-streamSimple-bypass',
    models: [BRIDGE_MODEL_NAME],
    streamSimple: (model, ctx, opts) => streamFromKernel(model, ctx, opts),
  });
}

// ── Stream wiring ───────────────────────────────────────────────────────

async function* streamFromKernel(
  model: string,
  ctx: PiStreamContext,
  opts: PiStreamOpts | undefined,
): AsyncIterable<PiStreamEvent> {
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
    // Pi delivers `model` as a `Model<Api>` object (`{id, name, ...}`),
    // but the kernel /text-chat endpoint takes the bare id string. Pick
    // the most string-like field; fall back to empty so the registry
    // routes to the active provider's default.
    model: normalizeModel(model),
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let currentEvent = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE: events are separated by blank lines, each line is either
      // `event: <name>` or `data: <json>`.
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
          const parsed = parseEventPayload(event, payload);
          if (parsed) {
            yield parsed;
          }
          if (event === 'done' || event === 'error') {
            return;
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader may already be released; ignore.
    }
  }

  // Stream closed without an explicit `done` — synthesize a stop so Pi
  // doesn't hang waiting for terminal.
  yield { type: 'stop', stop_reason: 'end_of_stream' };
}

function parseEventPayload(event: string, raw: string): PiStreamEvent | null {
  switch (event) {
    case 'delta': {
      const parsed = safeJson(raw);
      const delta =
        parsed && typeof parsed === 'object' && 'delta' in parsed
          ? String((parsed as { delta: unknown }).delta ?? '')
          : '';
      if (delta.length === 0) return null;
      return { type: 'assistant_message_delta', delta };
    }
    case 'done': {
      const parsed = safeJson(raw);
      const stopReason =
        parsed && typeof parsed === 'object' && 'stop_reason' in parsed
          ? String((parsed as { stop_reason: unknown }).stop_reason ?? 'end_turn')
          : 'end_turn';
      return { type: 'stop', stop_reason: stopReason };
    }
    case 'error': {
      const parsed = safeJson(raw);
      const message =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message ?? 'unknown error')
          : raw || 'unknown error';
      throw new Error(`ctrl-bridge: provider error: ${message}`);
    }
    default:
      // Unknown SSE event — ignore for forward-compatibility.
      return null;
  }
}

function assembleMessages(ctx: PiStreamContext): PiMessage[] {
  const out: PiMessage[] = [];
  if (ctx.system && ctx.system.length > 0) {
    out.push({ role: 'system', content: normalizeContent(ctx.system) });
  }
  for (const m of ctx.messages) {
    out.push({ role: m.role, content: normalizeContent(m.content) });
  }
  return out;
}

/** Pi delivers `model` as `Model<Api>` (`{id, name, ...}`) rather than a
 *  bare string. The kernel /text-chat endpoint takes a string id; pick
 *  the most string-like field. bao 2026-05-31 (118-trail): "HTTP 422:
 *  model: invalid type: map, expected a string". */
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

/** Pi delivers `content` as either a plain string OR an array of Anthropic-
 *  style blocks (`[{type:"text", text:"..."}]`). The kernel /text-chat
 *  endpoint takes a string; collapse arrays by joining each block's text
 *  field. Anything we can't recognize falls back to JSON.stringify so the
 *  call doesn't silently lose payload. bao 2026-05-31 (118-trail): "HTTP
 *  422: messages[0].content: invalid type: sequence, expected a string". */
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
