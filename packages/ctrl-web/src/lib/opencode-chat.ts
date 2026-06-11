// Opencode direct HTTP client — real API verified against opencode 1.17
// docs + generated SDK on 2026-06-10 (ADR-002 substrate §1 v20):
//   POST /session                         -> Session { id, ... }
//   POST /session/{id}/prompt_async       -> 204 (fire-and-forget)
//   GET  /event                           -> global SSE bus of
//        { type, properties } events; text deltas arrive as
//        message.part.updated (properties.delta), completion as
//        session.idle, errors as session.error, file writes as
//        file.edited.
// There is no per-request SSE stream — one bus subscription per server,
// reduced per session.

export interface OpencodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

export type OpencodeBusListener = (evt: OpencodeEvent) => void;

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export async function createOpencodeSession(port: number): Promise<string> {
  const res = await fetch(`${baseUrl(port)}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`opencode session create failed: ${res.status} ${await res.text()}`);
  }
  const session = (await res.json()) as { id?: string };
  if (!session.id) throw new Error('opencode session create returned no id');
  return session.id;
}

export async function promptOpencodeAsync(
  port: number,
  sessionId: string,
  text: string,
): Promise<void> {
  const res = await fetch(`${baseUrl(port)}/session/${sessionId}/prompt_async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    throw new Error(`opencode prompt failed: ${res.status} ${await res.text()}`);
  }
}

// ── Event bus (one per port, shared by chat + artifact pane) ──────────

interface Bus {
  listeners: Set<OpencodeBusListener>;
  abort: AbortController;
}

const buses = new Map<number, Bus>();

/** Subscribe to the server's /event SSE bus. Returns an unsubscribe fn.
 *  The underlying connection is shared per port and closed when the last
 *  listener unsubscribes. */
export function subscribeOpencodeEvents(
  port: number,
  listener: OpencodeBusListener,
): () => void {
  let bus = buses.get(port);
  if (!bus) {
    const abort = new AbortController();
    bus = { listeners: new Set(), abort };
    buses.set(port, bus);
    void pumpEvents(port, bus, abort.signal);
  }
  bus.listeners.add(listener);
  return () => {
    const b = buses.get(port);
    if (!b) return;
    b.listeners.delete(listener);
    if (b.listeners.size === 0) {
      b.abort.abort();
      buses.delete(port);
    }
  };
}

async function pumpEvents(port: number, bus: Bus, signal: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`${baseUrl(port)}/event`, {
      headers: { Accept: 'text/event-stream' },
      signal,
    });
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data: ')) {
          try {
            const evt = JSON.parse(line.slice(6)) as OpencodeEvent;
            for (const l of bus.listeners) l(evt);
          } catch {
            // non-JSON keepalive — ignore
          }
        }
        nl = buffer.indexOf('\n');
      }
    }
  } catch {
    // aborted or connection lost — listeners see silence; chat surfaces
    // its own request errors, and the artifact pane just stops updating.
  } finally {
    buses.delete(port);
  }
}

// ── Per-session reduction helpers ─────────────────────────────────────

export interface SessionStreamHandlers {
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** Reduce bus events for one session into delta/done/error callbacks. */
export function sessionReducer(
  sessionId: string,
  handlers: SessionStreamHandlers,
): OpencodeBusListener {
  return (evt) => {
    const props = evt.properties as {
      sessionID?: string;
      delta?: string;
      part?: { sessionID?: string; type?: string };
      error?: { data?: { message?: string }; name?: string };
    };
    switch (evt.type) {
      case 'message.part.updated': {
        if (props.part?.sessionID !== sessionId) return;
        if (props.part?.type === 'text' && typeof props.delta === 'string') {
          handlers.onDelta(props.delta);
        }
        return;
      }
      case 'session.idle': {
        if (props.sessionID === sessionId) handlers.onDone();
        return;
      }
      case 'session.error': {
        if (props.sessionID && props.sessionID !== sessionId) return;
        const message =
          props.error?.data?.message ?? props.error?.name ?? 'opencode session error';
        handlers.onError(message);
        return;
      }
      default:
    }
  };
}

/** Extract edited-file paths from bus events (for the artifact pane). */
export function fileEditedPath(evt: OpencodeEvent): string | null {
  if (evt.type !== 'file.edited') return null;
  const file = (evt.properties as { file?: unknown }).file;
  return typeof file === 'string' ? file : null;
}

// ── Active server slot (shared between chat + artifact pane) ──────────
// OpencodeChat publishes the launched port; sibling panes subscribe
// without triggering a second launch_agent.

type PortListener = (port: number | null) => void;
let activePort: number | null = null;
const portListeners = new Set<PortListener>();

export function setActiveOpencodePort(port: number | null): void {
  activePort = port;
  for (const l of portListeners) l(port);
}

export function subscribeActiveOpencodePort(listener: PortListener): () => void {
  listener(activePort);
  portListeners.add(listener);
  return () => {
    portListeners.delete(listener);
  };
}
