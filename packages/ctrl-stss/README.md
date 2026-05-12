# @ctrl/stss

CTRL profile of the **ST-SS** (Spatio-Temporal Semantic Stream) protocol — the wire format every keycap, hardware device, and external desktop app uses to publish into the CTRL kernel.

> See [ADR-001 §3 §4](../../.claude/ADR/001-system-architecture.md) for where ST-SS sits in CTRL's 4-layer architecture, and [`.olym/specs/stss-protocol/spec.md`](../../.olym/specs/stss-protocol/spec.md) for the protocol-level reference. This package is the TypeScript reference implementation of that spec.

## What ST-SS is (and is not)

ST-SS streams **semantic cells + temporal deltas** instead of pixels. 5 KB/s replaces 1.5 Mbps video.

```
Traditional RDP/VNC :  [pixels stream of someone coding]
ST-SS               :  [semantic stream: function foo() { return 1; }]
```

CTRL v1 uses ST-SS for three things — all derived from CTRL's mental model, not remote viewing:

1. **Desktop AI app integration** — any Tauri / Electron / native app publishes a stream to register as a CTRL keycap source.
2. **Hardware sensor stream** — AI glasses / voice recorders / desktop cameras / e-ink readers / AI rings emit semantic events, not raw audio/video.
3. **Cross-device AI memory** — keycap invocations, LLM responses, and tool results stream into the event store and replay across devices.

What ST-SS in `@ctrl/stss` deliberately **does not do** in v1:

- No remote viewing (no Layer A/B/C QoS multiplexing, no WebRTC pixel fallback).
- No receiver-to-sender input plane (key / pointer / command / text).
- No bandwidth-adaptive feedback loop (NACK / BWE / window-hint).
- No UI bandwidth optimisation ops (move / transform / subtree-* — terminal-append, list-scroll bandwidth tricks).

Those features exist in screi v0.5 (the upstream this package was cherry-picked from); CTRL v1 has no use for them. They can be re-introduced as a deliberate spec amendment, never as a silent forward-compat fallback.

## Layout

```
src/
├── protocol/        Wire types — Cell / Op / Envelope / framing / errors
├── ctrl/            CTRL profile — stream-id helpers, hardware / e-ink / backpressure capability slots
├── encode/          Envelope ↔ bytes (JSON in v1; CBOR deferred to P11 hardware)
├── transport/       Transport interface + WebSocket adapter + in-memory loopback
└── reducer/         Receiver-side cell-tree reducer
```

## Quick start — sender

```ts
import {
  createCell,
  createDelta,
  createHello,
  createKeyframe,
  formatStreamId,
  JsonEncoder,
  type CtrlCapabilities,
} from '@ctrl/stss';

const enc = new JsonEncoder();
const stream_id = formatStreamId({ publisher: 'clipboard-ai', instance: 'pid-42' });

const caps: CtrlCapabilities = {
  cell_kinds: ['clipboard_snapshot'],
  needs_capability: ['ClipboardRead'],
};

ws.send(enc.encode(createHello({
  source: stream_id, seq: 0,
  role: 'sender',
  stream_id,
  capabilities: caps,
})));

const kf = createKeyframe({
  source: stream_id, seq: 1,
  cells: [
    createCell({ id: 'clipboard', kind: 'clipboard_snapshot',
                 payload: { text: 'hello', mime: 'text/plain' } }),
  ],
});
ws.send(enc.encode(kf));

const df = createDelta({
  source: stream_id, seq: 2, ref: 1,
  cells: [createCell({
    id: 'clipboard', kind: 'clipboard_snapshot',
    payload: { text: 'hello world', mime: 'text/plain' },
  })],
});
ws.send(enc.encode(df));
```

## Quick start — receiver

```ts
import {
  DefaultReducer,
  JsonEncoder,
  WebSocketTransport,
  isEnvelope,
} from '@ctrl/stss';

const enc = new JsonEncoder();
const reducer = new DefaultReducer();
const transport = new WebSocketTransport(new WebSocket('ws://localhost:9000'));

transport.onMessage((bytes) => {
  const env = enc.decode(bytes);
  if (!isEnvelope(env)) return;
  const { snapshot, semanticOps } = reducer.apply(env);
  render(snapshot);
  for (const op of semanticOps) auditLog.push(op);
});
```

## Hardware streams

A device publishes its profile in the Hello handshake. The kernel scheduler uses it for priority preemption, bandwidth-aware compression, and battery-aware throttling.

```ts
const caps: CtrlCapabilities = {
  cell_kinds: ['hardware_reading'],
  needs_capability: ['CameraRead', 'LlmCall'],
  hardware_profile: {
    device_type: 'ai_glasses',
    power_class: 'always_on',
    bandwidth_class: '50kbps',
    latency_budget_ms: 100,
    battery_aware: true,
  },
};
```

## E-ink reader subscriptions

An e-ink consumer declares its render budget; senders coalesce and pre-format accordingly.

```ts
const caps: CtrlCapabilities = {
  eink_render_profile: {
    ppi: 227,
    refresh_class: 'static',
    page_size: [1404, 1872],
    contrast_class: '16_grey',
    preferred_cells: ['llm_response', 'tool_result'],
  },
  backpressure: {
    buffer_size: 32,
    drop_policy: 'coalesce',
    coalesce_window_ms: 500,
  },
};
```

## Relationship to screi

ST-SS originated in [screi](https://github.com/soodooi/screi) v0.5 — a remote-viewing-of-AI-sessions protocol. This package lifts the engineering primitives that are domain-agnostic:

- `Transport` / `Encoder` / `Reducer` interface shapes
- Length-prefix framing helpers
- WebSocket adapter pattern
- In-memory loopback transport pattern
- `ProtocolError` hierarchy pattern
- Hello / Welcome capability negotiation pattern

The data model (Cell / Op / Envelope / kind enums) was rewritten native per CTRL spec §2.1 instead of imported verbatim. Rationale: screi's Cell models a UI accessibility tree (`id + bbox + role + AXRole + content`), which does not fit CTRL's semantic event domain (clipboard snapshots, sensor readings, LLM responses). The screi v0.7-draft `cell.attrs` extension would have worked, but at the cost of dragging an accessibility-tree vocabulary into every CTRL audit log entry.

screi will be archived after this cherry-pick. Future protocol evolution is CTRL-native.

## License

UNLICENSED — see [`LICENSE`](../../LICENSE) at the repo root.
