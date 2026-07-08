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
import { engineTransport } from './llm-transport';
import { surfaceToolFor } from './remote-surface';
import type { RemoteAllowEntry, RemoteState } from './remote-connection';
import type { Surface } from '@/components/remote/SurfaceRenderer';

type Inbound =
  | { t: 'hello'; pass?: string }
  | { t: 'invoke'; id: number; tool: string; args: Record<string, unknown> }
  | { t: 'chat'; id: number; text: string };

const DEFAULT_RELAY = 'wss://ctrl-relay.soodooi2018.workers.dev';

export interface RemoteHostHandlers {
  onState?: (s: RemoteState) => void;
}

export interface RemoteHostOpts {
  /** Access credential a phone must present after the E2E channel is up. */
  passcode?: string;
  /** Stay reachable: auto-reconnect the outbound relay link (unattended mode). */
  keepAlive?: boolean;
  relayBase?: string;
}

export class RemoteHost {
  private ws: WebSocket | null = null;
  private key: CryptoKey | null = null;
  private state: RemoteState = 'disconnected';
  private stopped = false;
  private retry = 0;
  private relayBase: string;

  constructor(
    private room: string,
    private keyB64url: string,
    /** The functions this device exposes to the phone (visible + canAct). */
    private resolveAllowlist: () => Promise<RemoteAllowEntry[]>,
    private handlers: RemoteHostHandlers = {},
    private opts: RemoteHostOpts = {},
  ) {
    this.relayBase = opts.relayBase ?? DEFAULT_RELAY;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.key = await importKey(fromB64url(this.keyB64url));
    this.dial();
  }

  private dial(): void {
    this.setState('connecting');
    const ws = new WebSocket(`${this.relayBase}/?room=${encodeURIComponent(this.room)}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setState('paired');
    };
    ws.onmessage = (ev) => void this.onMessage(ev);
    ws.onclose = () => this.onDrop();
    ws.onerror = () => this.onDrop();
  }

  private onDrop(): void {
    this.setState('disconnected');
    // Unattended "stay reachable": keep the outbound link alive (the RustDesk
    // registration-heartbeat posture) with capped backoff so the phone can
    // reconnect any time without the desktop being touched.
    if (this.opts.keepAlive && !this.stopped) {
      const delay = Math.min(1000 * 2 ** this.retry++, 30_000);
      window.setTimeout(() => {
        if (!this.stopped) this.dial();
      }, delay);
    }
  }

  stop(): void {
    this.stopped = true;
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
      // ID + password model: the E2E key gates the channel, the passcode gates
      // ACCESS (verified here, after E2E — the relay never sees it).
      if (this.opts.passcode != null && this.opts.passcode !== '' && msg.pass !== this.opts.passcode) {
        await this.send({ t: 'denied', reason: 'passcode' });
        return;
      }
      const entries = await this.resolveAllowlist();
      await this.send({ t: 'allow', entries });
      return;
    }
    if (msg.t === 'chat') {
      // The phone talking to Irisy: stream the desktop engine's reply back over
      // the tunnel (the same assistant, ADR-005 §8 terminal-essence — the engine
      // owns the loop + context, so we send just this turn's user text).
      void this.streamChat(msg.id, msg.text);
      return;
    }
    if (msg.t === 'invoke') {
      // `remote_surface` = the phone asking a pack to describe its mobile surface
      // (the SDUI describe call). Answered here for now; the real design is that
      // each pack `describe`s its own surface (this desktop shim is transitional).
      if (msg.tool === 'remote_surface') {
        try {
          const value = await this.buildSurface(String((msg.args as { pack?: string }).pack ?? ''));
          await this.send({ t: 'result', id: msg.id, ok: true, value });
        } catch (e) {
          await this.send({ t: 'result', id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
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

  // A pack describes its OWN mobile Surface (§14 describe) via a `*_surface`
  // gate tool — the parts composition lives in the pack, NOT here, so core has
  // zero pack-specific rendering knowledge and the phone stays 100% generic.
  // v1 resolves the stock pack's tool by convention; a manifest-declared surface
  // tool is the full generalization (any pack opts in the same way).
  private async buildSurface(pack: string): Promise<Surface> {
    const tool = surfaceToolFor(pack);
    if (tool == null) return { v: 1, pack, parts: [] };
    try {
      return await gateInvoke<Surface>(tool);
    } catch {
      return { v: 1, pack, parts: [] };
    }
  }

  private async streamChat(id: number, text: string): Promise<void> {
    try {
      const stream = engineTransport().stream([{ role: 'user', content: text }], {});
      for await (const chunk of stream) {
        const delta = typeof chunk === 'string' ? chunk : (chunk?.delta ?? '');
        if (delta) await this.send({ t: 'chat_chunk', id, delta });
      }
      await this.send({ t: 'chat_done', id });
    } catch (e) {
      await this.send({ t: 'chat_done', id, error: e instanceof Error ? e.message : String(e) });
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
