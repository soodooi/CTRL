// Opencode direct HTTP client — ADR-002 substrate §1 v19 (2026-06-09,
// 3-agent aggregator): /coding talks to the opencode HTTP API directly;
// the kernel SSE bridge (opencode_chat_stream) is retired.
//
// Endpoint shapes mirror the wire validated by the retired kernel bridge:
//   POST {base}/session                      → { id }
//   POST {base}/session/{id}/prompt          → SSE stream
//     event: delta  data: { delta }
//     event: done   data: {}
//     event: error  data: { message }
// A non-SSE JSON response degrades gracefully to a single delta.

export interface OpencodeStreamHandlers {
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export interface OpencodePromptArgs {
  port: number;
  sessionId: string;
  message: string;
  signal?: AbortSignal;
}

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function createOpencodeSession(port: number): Promise<string> {
  const res = await fetch(`${baseUrl(port)}/session`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`opencode session create failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error('opencode session create returned no id');
  return body.id;
}

export async function streamOpencodePrompt(
  args: OpencodePromptArgs,
  handlers: OpencodeStreamHandlers,
): Promise<void> {
  const res = await fetch(`${baseUrl(args.port)}/session/${args.sessionId}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ type: 'text', text: args.message }] }),
    signal: args.signal,
  });
  if (!res.ok) {
    handlers.onError(`opencode prompt failed: ${res.status} ${await res.text()}`);
    return;
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    // Non-streaming server build — render the whole reply at once.
    const text = await res.text();
    if (text) handlers.onDelta(extractPlainText(text));
    handlers.onDone();
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    handlers.onError('opencode prompt returned no readable body');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];
  let doneFired = false;
  const fireDone = () => {
    if (doneFired) return;
    doneFired = true;
    handlers.onDone();
  };

  const dispatch = () => {
    const data = dataLines.join('\n');
    dataLines = [];
    const name = eventName;
    eventName = '';
    if (name === 'delta') {
      try {
        const parsed = JSON.parse(data) as { delta?: string };
        if (parsed.delta) handlers.onDelta(parsed.delta);
      } catch {
        if (data) handlers.onDelta(data);
      }
    } else if (name === 'error') {
      let message = data;
      try {
        const parsed = JSON.parse(data) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // keep raw data as the message
      }
      handlers.onError(message || 'opencode stream error');
    } else if (name === 'done') {
      fireDone();
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') {
        if (eventName || dataLines.length > 0) dispatch();
      } else if (line.startsWith('event: ')) {
        eventName = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      }
      nl = buffer.indexOf('\n');
    }
  }
  // Stream closed without an explicit done event — treat as done so the
  // UI never hangs in the streaming state.
  if (eventName || dataLines.length > 0) dispatch();
  fireDone();
}

function extractPlainText(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      parts?: Array<{ type?: string; text?: string }>;
      text?: string;
    };
    if (parsed.parts) {
      return parsed.parts
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text)
        .join('');
    }
    if (parsed.text) return parsed.text;
  } catch {
    // not JSON — return as-is
  }
  return body;
}
