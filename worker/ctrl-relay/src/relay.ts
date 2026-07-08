// RelayRoom — one Durable Object per room (ADR-005 §2 remote co-view).
//
// Cloudflare WebSocket Hibernation API: idle sockets don't consume compute, so
// a phone can hold a connection for hours waiting for the desktop with an
// essentially-free bill. The Worker treats every payload as OPAQUE — it does
// not (and cannot) parse the E2E-encrypted frames; whatever one peer sends is
// forwarded verbatim to the OTHER peer in the room.
//
// Edge cases:
//   - At most 2 peers per room (a third connection is closed with 4001).
//   - When one peer leaves, the other gets {"type":"peer_left"} so it can show
//     "disconnected" and retry.

interface Env {
  RELAY_ROOM: DurableObjectNamespace;
}

export class RelayRoom implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept via Hibernation API so idle sockets don't bill compute time.
    this.state.acceptWebSocket(server);

    // Enforce capacity AFTER accept so the count includes this connection.
    const peers = this.state.getWebSockets();
    if (peers.length > 2) {
      server.close(4001, 'room is full (max 2 peers)');
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /** A hibernated socket received a frame — forward verbatim to the other peer. */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const peers = this.state.getWebSockets();
    for (const peer of peers) {
      if (peer !== ws) {
        try {
          peer.send(message);
        } catch (err) {
          console.error('relay: forward failed', err);
        }
      }
    }
  }

  /** A socket closed — tell the surviving peer so it can show disconnected. */
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const peers = this.state.getWebSockets();
    const notice = JSON.stringify({ type: 'peer_left', code, reason });
    for (const peer of peers) {
      if (peer !== ws && peer.readyState === WebSocket.OPEN) {
        try {
          peer.send(notice);
        } catch (err) {
          console.error('relay: peer_left notify failed', err);
        }
      }
    }
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error('relay: socket error', error);
  }
}
