# @screi/memory

> Event-sourced persistence for ST-SS streams. Append-only log, derived
> indexes, query API.

The memory tier is **not** a renderable receiver — it is the source of
truth for past sessions. It enables:

- **Replay** — reconstruct a `CellTreeSnapshot` at any past timestamp
- **Query** — find all cells with `role: "code"` containing `"function foo"`
- **Multi-source aggregation** (v0.2) — overlay streams from multiple machines

## Modules

| Module | Concern |
|---|---|
| `log/` | Append-only writer + sequential reader, framed records |
| `index/` | Time / role / content indexes built from log |
| `reader/` | `MemoryReader` — high-level seek / replay / query API |
| `compact/` | (v0.2) snapshot compaction |

See [`docs/concept/architecture-v0.1-draft.md §5`](../../docs/concept/architecture-v0.1-draft.md).
