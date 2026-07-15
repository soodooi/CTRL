// ctrl-relay — zero-knowledge WebSocket relay for CTRL remote windows.
// (ADR-005 §2 remote co-view, option B: relay-only + E2E.)
//
// One Durable Object per room. Two peers join by room id over WebSocket — the
// desktop kernel (dials out, never listens) and the phone PWA. The relay
// forwards OPAQUE bytes between them; every frame is E2E-encrypted at the
// application layer with a key established during phone<->desktop pairing, so
// the relay is zero-knowledge (it cannot read the traffic, even us). This is
// the ngrok / VS Code Tunnels / Home-Assistant-Cloud (SniTun) pattern, sized
// for small JSON (gate calls + event stream), not video — so no WebRTC/TURN.
//
// Deliberately minimal:
//   - No auth here (room id + the E2E pairing key are the security boundary;
//     the relay just forwards opaque bytes and can't decrypt them anyway).
//   - No persistence (rooms vanish when both peers disconnect).
//   - Hibernation API: idle sockets don't bill compute.
//
// `.kiro/steering/development-philosophy.md` Hard Rules: no local
// `wrangler dev`; deploys go to *.workers.dev staging.

export interface Env {
  RELAY_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const roomId = url.searchParams.get('room');

    if (!roomId) {
      return new Response('ctrl-relay — GET wss://...?room=<id> (WebSocket upgrade)', {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(roomId)) {
      return new Response('invalid room id (8-64 chars [A-Za-z0-9_-])', { status: 400 });
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('ctrl-relay requires a WebSocket upgrade', { status: 426 });
    }

    const id = env.RELAY_ROOM.idFromName(roomId);
    const stub = env.RELAY_ROOM.get(id);
    return stub.fetch(request);
  },
};

export { RelayRoom } from './relay.js';
