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
import type { Surface } from '@/components/remote/SurfaceRenderer';

type Inbound =
  | { t: 'hello'; pass?: string }
  | { t: 'invoke'; id: number; tool: string; args: Record<string, unknown> };

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

  // Build a pack's mobile Surface (a flat list of generic parts). TRANSITIONAL:
  // the stock mapping lives here until packs describe their own surface; every
  // OTHER pack already flows through unchanged (empty surface until it opts in).
  // The phone stays 100% generic — it never knows a pack is "stock".
  private async buildSurface(pack: string): Promise<Surface> {
    if (!pack.includes('stock')) {
      return { v: 1, pack, parts: [] };
    }
    const grab = (tool: string): Promise<Record<string, unknown> | undefined> =>
      gateInvoke<Record<string, unknown>>(tool).catch(() => undefined);
    const [mood, leaders, ladder] = await Promise.all([
      grab('market_mood'),
      grab('leaders'),
      grab('limit_ladder'),
    ]);
    const parts: Surface['parts'] = [];
    const moodCard = mood?.card as Record<string, unknown> | undefined;
    if (moodCard != null) {
      parts.push({
        kind: 'gauge',
        id: 'mood',
        data: {
          value: moodCard.temp,
          verdict: moodCard.verdict,
          tone: moodCard.tone,
          read: moodCard.read,
        },
      });
      if (moodCard.metrics != null) {
        parts.push({ kind: 'metrics', id: 'breadth', data: { items: moodCard.metrics } });
      }
    }
    const leadersCard = leaders?.card as Record<string, unknown> | undefined;
    if (leadersCard != null) {
      const rows = ((leadersCard.rows as Array<Record<string, unknown>>) ?? []).map((r) => ({
        name: r.name,
        sub: r.code,
        value: r.value != null ? `${String(r.value)}${String(leadersCard.unit ?? '')}` : null,
        ratio: r.ratio,
        tone: r.tone,
        tag: r.tag,
      }));
      parts.push({ kind: 'barlist', id: 'leaders', title: leadersCard.verdict as string, data: { rows } });
    }
    const ladderCard = ladder?.card as Record<string, unknown> | undefined;
    if (ladderCard != null) {
      const tiers = ((ladderCard.tiers as Array<Record<string, unknown>>) ?? []).map((t) => ({
        label: t.label,
        items: t.stocks,
        tag: t.theme,
      }));
      parts.push({ kind: 'tiers', id: 'ladder', title: ladderCard.verdict as string, data: { tiers } });
    }
    return { v: 1, pack, parts };
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
