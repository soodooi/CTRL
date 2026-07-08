// RemoteConnection — the phone side of a remote window (ADR-005 §2, option B).
//
// Dials the ctrl-relay room over WSS and tunnels CTRL's own protocol through it,
// every frame E2E-sealed (remote-crypto) so the relay is zero-knowledge. The
// phone calls gate tools and receives events exactly as if local — the desktop
// kernel (the other peer in the room) executes them through the :17873 gate and
// returns. This is the relay-only transport bao chose (0 listening ports); LAN
// and remote both ride it (offline-LAN is deliberately out, per the plan).
//
// The desktop half (kernel dials the same room, unseals, runs the gate) is Rust
// and is the device-gated piece. This file is the browser side.
import { importKey, sealJson, openJson, fromB64url } from './remote-crypto';

export type RemoteState = 'connecting' | 'paired' | 'disconnected';

/** Frames we send to the desktop. */
type Outbound =
  | { t: 'hello'; pass?: string } // request allowlist; present the passcode
  | { t: 'invoke'; id: number; tool: string; args: Record<string, unknown> };

/** Frames the desktop sends back. */
type Inbound =
  | { t: 'allow'; entries: RemoteAllowEntry[] }
  | { t: 'denied'; reason: string }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'event'; stream?: string; payload: unknown };

export interface RemoteAllowEntry {
  key: string;
  label: string;
  icon: string;
  canAct: boolean;
}

export interface RemoteHandlers {
  onState?: (s: RemoteState) => void;
  onAllowlist?: (entries: RemoteAllowEntry[]) => void;
  onEvent?: (stream: string | undefined, payload: unknown) => void;
  /** Desktop rejected the passcode — prompt the user for it. */
  onDenied?: (reason: string) => void;
}

export interface RemoteConnOpts {
  /** Access passcode presented to the desktop after E2E (unattended model). */
  passcode?: string;
  /** Auto-reconnect when the desktop drops (reach an always-on desktop). */
  keepAlive?: boolean;
  relayBase?: string;
}

/** Parse a pairing URL/blob: `?remote=<room>` + `#k=<b64url key>`. Key rides in
 *  the fragment so it never reaches the server (not even the relay) in a request
 *  line. Returns null when the params are absent/malformed. */
export function parsePairing(search: string, hash: string): { room: string; key: string } | null {
  const room = new URLSearchParams(search).get('remote');
  const key = new URLSearchParams(hash.replace(/^#/, '')).get('k');
  if (!room || !key) return null;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(room)) return null;
  return { room, key };
}

const DEFAULT_RELAY = 'wss://ctrl-relay.soodooi2018.workers.dev';

// Public host of the CTRL PWA — where a phone loads the app from (the desktop's
// local Tauri origin is unreachable from a phone). The pairing link points here;
// the DATA still flows peer-to-peer over the relay, so this host only ever
// serves the static shell (data sovereignty unchanged). Same for every user —
// the PWA host + relay are shared multi-tenant infra; each session is isolated
// by its random room id + E2E key.
export const REMOTE_APP_BASE =
  (import.meta.env.VITE_REMOTE_APP_BASE as string | undefined) ?? 'https://app.ctrlapplab.com';

export class RemoteConnection {
  private ws: WebSocket | null = null;
  private key: CryptoKey | null = null;
  private seq = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private state: RemoteState = 'disconnected';

  private relayBase: string;
  private stopped = false;
  private retry = 0;

  constructor(
    private room: string,
    private keyB64url: string,
    private handlers: RemoteHandlers = {},
    private opts: RemoteConnOpts = {},
  ) {
    this.relayBase = opts.relayBase ?? DEFAULT_RELAY;
  }

  async connect(): Promise<void> {
    this.stopped = false;
    this.key = await importKey(fromB64url(this.keyB64url));
    this.dial();
  }

  /** Update the passcode (after the user enters it on a `denied`) + retry. */
  setPasscode(passcode: string): void {
    this.opts = { ...this.opts, passcode };
    if (this.ws?.readyState === WebSocket.OPEN) void this.sendFrame({ t: 'hello', pass: passcode });
  }

  private dial(): void {
    this.setState('connecting');
    const ws = new WebSocket(`${this.relayBase}/?room=${encodeURIComponent(this.room)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      void this.sendFrame({ t: 'hello', pass: this.opts.passcode });
      this.setState('paired');
    };
    ws.onmessage = (ev: MessageEvent) => void this.onMessage(ev);
    ws.onclose = () => this.onDrop();
    ws.onerror = () => this.onDrop();
  }

  private onDrop(): void {
    this.setState('disconnected');
    if (this.opts.keepAlive && !this.stopped) {
      const delay = Math.min(1000 * 2 ** this.retry++, 30_000);
      window.setTimeout(() => {
        if (!this.stopped) this.dial();
      }, delay);
    }
  }

  close(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
    for (const p of this.pending.values()) p.reject(new Error('connection closed'));
    this.pending.clear();
    this.setState('disconnected');
  }

  /** Tunnel a gate tool call to the desktop; resolves with the tool's result. */
  invoke<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = this.seq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      void this.sendFrame({ t: 'invoke', id, tool, args }).catch(reject);
      // 20s ceiling so a dropped desktop peer doesn't hang the phone forever.
      window.setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`remote invoke timed out: ${tool}`));
      }, 20_000);
    });
  }

  private async sendFrame(msg: Outbound): Promise<void> {
    if (this.ws == null || this.key == null || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('remote connection not open');
    }
    this.ws.send(await sealJson(this.key, msg));
  }

  private async onMessage(ev: MessageEvent): Promise<void> {
    // Relay control (peer_left, etc.) arrives as a plaintext JSON STRING; our
    // E2E frames arrive as ArrayBuffer. Never try to decrypt the former.
    if (typeof ev.data === 'string') {
      try {
        const ctrl = JSON.parse(ev.data) as { type?: string };
        if (ctrl.type === 'peer_left') this.setState('connecting');
      } catch {
        // ignore malformed relay control
      }
      return;
    }
    if (this.key == null) return;
    let msg: Inbound;
    try {
      msg = await openJson<Inbound>(this.key, ev.data as ArrayBuffer);
    } catch {
      // Undecryptable = wrong key / tampered; drop it (zero-knowledge relay).
      return;
    }
    switch (msg.t) {
      case 'allow':
        this.handlers.onAllowlist?.(msg.entries);
        break;
      case 'denied':
        this.handlers.onDenied?.(msg.reason);
        break;
      case 'event':
        this.handlers.onEvent?.(msg.stream, msg.payload);
        break;
      case 'result': {
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new Error(msg.error));
        break;
      }
    }
  }

  private setState(s: RemoteState): void {
    if (s === this.state) return;
    this.state = s;
    this.handlers.onState?.(s);
  }
}
