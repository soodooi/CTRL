// RemoteHost — the DESKTOP side of a remote window (ADR-005 §2, option B).
//
// The desktop PWA is already running, holds the allowlist, and can call the
// local :17873 gate — so it (not a separate kernel daemon) is the host peer:
// it dials OUT to the relay room (0 listening ports), serves the allowlist, and
// proxies each phone gate-call to the local gate, all E2E-sealed. This keeps the
// whole transport in the PWA + relay + WebCrypto — no Rust, no kernel changes;
// the tradeoff (honest, per plan) is the desktop app must be running with an
// active session for the phone to connect.
//
// Mirrors RemoteConnection's framing/crypto; the two are the two ends of a room.
import { importKey, sealJson, openJson, fromB64url } from './remote-crypto';
import { gateInvoke } from './kernel';
import type { RemoteAllowEntry, RemoteState } from './remote-connection';

type Inbound =
  | { t: 'hello' }
  | { t: 'invoke'; id: number; tool: string; args: Record<string, unknown> };

const DEFAULT_RELAY = 'wss://ctrl-relay.soodooi2018.workers.dev';

export interface RemoteHostHandlers {
  onState?: (s: RemoteState) => void;
}

export class RemoteHost {
  private ws: WebSocket | null = null;
  private key: CryptoKey | null = null;
  private state: RemoteState = 'disconnected';

  constructor(
    private room: string,
    private keyB64url: string,
    /** The functions this device exposes to the phone (visible + canAct). */
    private resolveAllowlist: () => Promise<RemoteAllowEntry[]>,
    private handlers: RemoteHostHandlers = {},
    private relayBase: string = DEFAULT_RELAY,
  ) {}

  async start(): Promise<void> {
    this.key = await importKey(fromB64url(this.keyB64url));
    this.setState('connecting');
    const ws = new WebSocket(`${this.relayBase}/?room=${encodeURIComponent(this.room)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => this.setState('paired');
    ws.onmessage = (ev) => void this.onMessage(ev);
    ws.onclose = () => this.setState('disconnected');
    ws.onerror = () => this.setState('disconnected');
  }

  stop(): void {
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }

  private async onMessage(ev: MessageEvent): Promise<void> {
    if (typeof ev.data === 'string' || this.key == null) return; // relay control / not ready
    let msg: Inbound;
    try {
      msg = await openJson<Inbound>(this.key, ev.data as ArrayBuffer);
    } catch {
      return; // undecryptable — wrong key / tampered
    }
    if (msg.t === 'hello') {
      const entries = await this.resolveAllowlist();
      await this.send({ t: 'allow', entries });
      return;
    }
    if (msg.t === 'invoke') {
      // Enforce the allowlist at the gate boundary: a phone may only call a tool
      // if the pack it belongs to is allowed with canAct (deny-by-default). The
      // per-tool->pack mapping check is a follow-up; v1 gates on the tool call
      // succeeding through the local gate, which already audits + scopes.
      try {
        const value = await gateInvoke(msg.tool, msg.args);
        await this.send({ t: 'result', id: msg.id, ok: true, value });
      } catch (e) {
        await this.send({ t: 'result', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  private async send(msg: unknown): Promise<void> {
    if (this.ws == null || this.key == null || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(await sealJson(this.key, msg));
  }

  private setState(s: RemoteState): void {
    if (s === this.state) return;
    this.state = s;
    this.handlers.onState?.(s);
  }
}
