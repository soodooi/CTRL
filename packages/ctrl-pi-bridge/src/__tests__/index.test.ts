// Unit tests for the Pi bridge extension. We exercise the registration
// shape + the SSE parsing path via a stubbed `fetch`. End-to-end is
// covered by the brain supervisor's integration test.
//
// Contract under test (bao 2026-05-31 118-trail rewrite): streamSimple
// returns a BridgeEventStream synchronously. Errors flow through the
// stream as `error` events (Pi's `AssistantMessageEventStream` shape) —
// they do NOT throw out of streamSimple itself.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import register, {
  BRIDGE_ENV_PORT,
  BRIDGE_MODEL_NAME,
  BRIDGE_PROVIDER_NAME,
  BridgeEventStream,
  type PiAssistantMessageEvent,
  type PiExtensionApi,
  type PiProvider,
} from '../index.js';

describe('register', () => {
  it('registers a single ctrl-bridge provider with one default model', () => {
    const seen: Record<string, PiProvider> = {};
    const api: PiExtensionApi = {
      registerProvider: (id, provider) => {
        seen[id] = provider;
      },
    };
    register(api);
    expect(Object.keys(seen)).toEqual([BRIDGE_PROVIDER_NAME]);
    expect(seen[BRIDGE_PROVIDER_NAME]?.api).toBe(BRIDGE_PROVIDER_NAME);
    expect(seen[BRIDGE_PROVIDER_NAME]?.models).toEqual([BRIDGE_MODEL_NAME]);
  });
});

describe('streamSimple', () => {
  let originalFetch: typeof fetch;
  let originalPort: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalPort = process.env[BRIDGE_ENV_PORT];
    process.env[BRIDGE_ENV_PORT] = '17875';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalPort === undefined) {
      delete process.env[BRIDGE_ENV_PORT];
    } else {
      process.env[BRIDGE_ENV_PORT] = originalPort;
    }
  });

  it('emits start / text_start / text_delta / text_end / done sequence', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        'event: delta',
        'data: {"delta":"hello "}',
        '',
        'event: delta',
        'data: {"delta":"world"}',
        '',
        'event: done',
        'data: {"stop_reason":"end_turn"}',
        '',
      ]),
    ) as unknown as typeof fetch;

    const provider = collectProvider();
    const stream = provider.streamSimple(BRIDGE_MODEL_NAME, {
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(stream).toBeInstanceOf(BridgeEventStream);

    const events = await drain(stream);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      'start',
      'text_start',
      'text_delta',
      'text_delta',
      'text_end',
      'done',
    ]);

    const deltas = events.filter(
      (e): e is Extract<PiAssistantMessageEvent, { type: 'text_delta' }> =>
        e.type === 'text_delta',
    );
    expect(deltas.map((e) => e.delta)).toEqual(['hello ', 'world']);

    const done = events.find(
      (e): e is Extract<PiAssistantMessageEvent, { type: 'done' }> =>
        e.type === 'done',
    );
    expect(done?.reason).toBe('stop');
    expect(done?.message.content).toEqual([
      { type: 'text', text: 'hello world' },
    ]);

    const final = await stream.result();
    expect(final.stopReason).toBe('stop');
    expect(final.content).toEqual([{ type: 'text', text: 'hello world' }]);
  });

  it('emits an error event when the port env is missing', async () => {
    delete process.env[BRIDGE_ENV_PORT];
    const provider = collectProvider();
    const events = await drain(
      provider.streamSimple(BRIDGE_MODEL_NAME, {
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    const errEvent = events.find(
      (e): e is Extract<PiAssistantMessageEvent, { type: 'error' }> =>
        e.type === 'error',
    );
    expect(errEvent).toBeDefined();
    expect(errEvent?.error.errorMessage).toMatch(/CTRL_PROVIDER_PORT/);
  });

  it('emits an error event when the server returns a non-2xx status', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('oops', { status: 503, statusText: 'Service Unavailable' }),
    ) as unknown as typeof fetch;
    const provider = collectProvider();
    const events = await drain(
      provider.streamSimple(BRIDGE_MODEL_NAME, {
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    const errEvent = events.find(
      (e): e is Extract<PiAssistantMessageEvent, { type: 'error' }> =>
        e.type === 'error',
    );
    expect(errEvent?.error.errorMessage).toMatch(/HTTP 503/);
  });

  it('propagates an SSE `error` event as a stream error event', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        'event: error',
        'data: {"message":"provider crashed"}',
        '',
      ]),
    ) as unknown as typeof fetch;
    const provider = collectProvider();
    const events = await drain(
      provider.streamSimple(BRIDGE_MODEL_NAME, {
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );
    const errEvent = events.find(
      (e): e is Extract<PiAssistantMessageEvent, { type: 'error' }> =>
        e.type === 'error',
    );
    expect(errEvent?.error.errorMessage).toMatch(/provider crashed/);
  });
});

// ── helpers ────────────────────────────────────────────────────────────

function collectProvider(): PiProvider {
  let captured: PiProvider | null = null;
  register({
    registerProvider: (_id, provider) => {
      captured = provider;
    },
  });
  if (!captured) throw new Error('register did not capture a provider');
  return captured;
}

async function drain(
  stream: AsyncIterable<PiAssistantMessageEvent>,
): Promise<PiAssistantMessageEvent[]> {
  const out: PiAssistantMessageEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

function sseResponse(lines: string[]): Response {
  const body = lines.join('\n') + '\n';
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
