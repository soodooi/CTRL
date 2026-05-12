# @ctrl/memory

Client-side event-sourced query helper for CTRL AI memory. Provides an append-only log + cursor-based reader over [`@ctrl/stss`](../ctrl-stss) envelopes.

> **Not a mirror of kernel state.** The Rust kernel (`src-tauri/src/kernel/persistence.rs`) owns the canonical SQLite event store. This TS package is the companion the UI layer and 创作者助手 use to iterate over recent envelopes, replay state, and query for "show me the last N tool results on this stream" without round-tripping every read to the kernel.

> Bridge to the kernel SQLite is **P3.5** — a separate handoff. The {@link AppendSink} / {@link LineSource} interfaces here are shaped so the bridge drops in as a new implementation without changing call sites.

## Layout

```
src/
├── types.ts                    EnvelopeFilter + matchesFilter
├── log/
│   ├── types.ts                AppendSink / LineSource interfaces
│   ├── format.ts               JSONL line format helpers
│   └── in-memory.ts            InMemoryLog (implements both interfaces)
└── reader/
    ├── types.ts                MemoryReader interface
    └── memory-reader.ts        DefaultMemoryReader — iterate / seek / current
```

## Quick start

```ts
import {
  DefaultMemoryReader,
  InMemoryLog,
} from '@ctrl/memory';
import {
  createCell,
  createDelta,
  createKeyframe,
} from '@ctrl/stss';

const log = new InMemoryLog();
const reader = new DefaultMemoryReader(log);

await log.append(createKeyframe({
  source: 'clipboard-ai:pid-42', seq: 1, ts_ms: 1_000,
  cells: [createCell({
    id: 'clipboard', kind: 'clipboard_snapshot',
    payload: { text: 'hello' }, ts_ms: 950,
  })],
}));
await log.append(createDelta({
  source: 'clipboard-ai:pid-42', seq: 2, ref: 1, ts_ms: 1_100,
  cells: [createCell({
    id: 'clipboard', kind: 'clipboard_snapshot',
    payload: { text: 'hello world' }, ts_ms: 1_050,
  })],
}));

for await (const env of reader.iterate({
  source: 'clipboard-ai:pid-42',
  types: ['delta'],
})) {
  console.log(env.seq, env.payload);
}

await reader.seekToTime(1_000);
console.log(reader.current().cells.get('clipboard')?.payload);
// → { text: 'hello' }
```

## Filtering

`EnvelopeFilter` combines fields with AND semantics. All fields optional.

```ts
interface EnvelopeFilter {
  source?: string;
  types?: readonly EnvelopeType[];
  fromTsMs?: number;
  toTsMs?: number;
  fromSeq?: number;
  toSeq?: number;
  where?: (env: Envelope) => boolean;
}
```

`where` runs for every envelope — keep it cheap.

## Roadmap (separate handoffs)

The `AppendSink` and `LineSource` interfaces let alternative backends drop in transparently:

- **v1 (this package)** — `InMemoryLog` for tests + dev.
- **v1.5** — `FileLog` backed by JSONL on disk. Uses `format.ts` helpers.
- **P3.5** — `KernelBridgeLog` Tauri command bridge to `kernel::persistence::EventStore`.
- **P12+** — `SyncedLog` Yjs CRDT layer for cross-device memory sync.

## License

UNLICENSED — see [`LICENSE`](../../LICENSE) at the repo root.
