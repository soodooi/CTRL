// Unit tests for the Pi bridge extension. We exercise the registration
// shape + the SSE parsing path via a stubbed `fetch`. End-to-end is
// covered by the brain supervisor's integration test.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import register, {
  BRIDGE_ENV_PORT,
  BRIDGE_MODEL_NAME,
  BRIDGE_PROVIDER_NAME,
  type PiExtensionApi,
  type PiProvider,
  type PiStreamEvent,
} from '../index.ts';

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

  it('parses delta + done SSE events into Pi-shaped stream chunks', async () => {
    globalThis.fetch = vi.fn(async () => sseResponse([
      'event: delta',
      'data: {"delta":"hello "}',
      '',
      'event: delta',
      'data: {"delta":"world"}',
      '',
      'event: done',
      'data: {"stop_reason":"end_turn"}',
      '',
    ])) as unknown as typeof fetch;

    const provider = collectProvider();
    const events = await drain(
      provider.streamSimple(BRIDGE_MODEL_NAME, {
        messages: [{ role: 'user', content: 'hi' }],
      }),
    );

    expect(events).toEqual<PiStreamEvent[]>([
      { type: 'assistant_message_delta', delta: 'hello ' },
      { type: 'assistant_message_delta', delta: 'world' },
      { type: 'stop', stop_reason: 'end_turn' },
    ]);
  });

  it('throws a typed error when port env is missing', async () => {
    delete process.env[BRIDGE_ENV_PORT];
    const provider = collectProvider();
    await expect(
      drain(
        provider.streamSimple(BRIDGE_MODEL_NAME, {
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    ).rejects.toThrow(/CTRL_PROVIDER_PORT/);
  });

  it('surfaces server HTTP error with status code', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('oops', { status: 503, statusText: 'Service Unavailable' }),
    ) as unknown as typeof fetch;
    const provider = collectProvider();
    await expect(
      drain(
        provider.streamSimple(BRIDGE_MODEL_NAME, {
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('propagates an `error` SSE event as a thrown Error', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        'event: error',
        'data: {"message":"provider crashed"}',
        '',
      ]),
    ) as unknown as typeof fetch;
    const provider = collectProvider();
    await expect(
      drain(
        provider.streamSimple(BRIDGE_MODEL_NAME, {
          messages: [{ role: 'user', content: 'hi' }],
        }),
      ),
    ).rejects.toThrow(/provider crashed/);
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
  it: AsyncIterable<PiStreamEvent>,
): Promise<PiStreamEvent[]> {
  const out: PiStreamEvent[] = [];
  for await (const e of it) out.push(e);
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
