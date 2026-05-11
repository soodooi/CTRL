# @screi/protocol

> TypeScript reference implementation of the [ST-SS protocol](https://github.com/soodooi/screi/blob/main/docs/protocol/v0.1/index.md).

The package shape mirrors the protocol's six core modules:

| Sub-export | Concern | Spec section |
|---|---|---|
| `cell` | Atomic semantic unit (Cell, AXRole, StyleHint, CellMeta) | §3.1 |
| `op` | 8-variant op vocabulary, type guards, constructors | §3.3 |
| `envelope` | Wire-level envelope, payload types | §7 |
| `framing` | KF / DF / HB state machine helpers | §3.2 / §M2 |
| `layer` | A / B / C / D layer typing and routing | §5 |
| (root) | Re-exports everything plus `VERSION`, `PROTOCOL_VERSION` | — |

## Install

```bash
npm install @screi/protocol
```

## Usage — bridge side (encoder)

```ts
import {
  type Cell,
  type Envelope,
  createKeyframe,
  createDelta,
} from "@screi/protocol";

const cells: Cell[] = [
  { id: "c1", bbox: [0, 0, 1280, 32], role: "tabbar", content: "main.ts" },
  { id: "c2", bbox: [0, 32, 1280, 600], role: "code", content: "function foo()..." },
];

const kf: Envelope = createKeyframe({
  source: "mac-home:42",
  seq: 100,
  cells,
});

ws.send(JSON.stringify(kf));

// Later, on append:
const df: Envelope = createDelta({
  source: "mac-home:42",
  seq: 101,
  ref: 100,
  ops: [{ op: "append", id: "c2", tail: "\n  return 1;\n}" }],
});

ws.send(JSON.stringify(df));
```

## Usage — client side (decoder)

```ts
import { isKeyframe, isDelta, type Envelope } from "@screi/protocol";

ws.addEventListener("message", (msg) => {
  const env = JSON.parse(msg.data) as Envelope;
  if (isKeyframe(env)) {
    state.replaceAll(env.payload.cells);
  } else if (isDelta(env)) {
    state.applyOps(env.payload.ops);
  }
});
```

## Documentation

The TSDoc comments inside `src/` are the canonical API documentation. They
are auto-extracted by TypeDoc and rendered into the handbook's API
tier (internal: [screi-handbook.pages.dev/api/internal/](https://screi-handbook.pages.dev/api/internal/)).

## Conformance

This implementation aims to match the conformance criteria in
[`docs/protocol/v0.1/index.md` §9](https://github.com/soodooi/screi/blob/main/docs/protocol/v0.1/index.md#9-conformance). A
conformance test suite is planned for `test/`.

## Status

- v0.1.0 — initial release, JSON wire format, no compression
- v0.2 (planned) — MessagePack option
- v1.0 (planned) — binary schema (Cap'n Proto), zstd dictionary

## License

Apache 2.0.
