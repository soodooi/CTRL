# Coding Streams — Athena → Zeus contract

**Date:** 2026-05-17
**Owner:** Athena (consumer)
**Counterpart:** Zeus (provider — subprocess actor + PTY wrap + Tauri commands/events)
**Status:** draft — Athena ships mock today; Zeus please confirm or rewrite the surface below, then implement

---

## What Athena needs

For Irisy's Code Space (12 tiles in `/irisy`), each tile subscribes to one running coding session (Claude Code, Cursor, Codex, Gemini CLI, plain terminal). User's machine has N such sessions live; Irisy shows the first 12 of them.

Athena consumer interface (already shipped at `packages/ctrl-web/src/lib/coding-streams.ts`):

```ts
interface CodingStream {
  id: string;
  source: 'claude' | 'cursor' | 'codex' | 'gemini-cli' | 'terminal' | 'unknown';
  label: string;                  // 'CTRL/ctrl-web' or 'olym-core'
  cwd?: string;
  pid?: number;
  discoveredAt: number;           // epoch ms
  status: 'idle' | 'streaming' | 'paused' | 'gone';
}

interface CodingStreamChunk {
  text: string;                   // ANSI passthrough OK; Athena renders pre-wrap
  seq: number;                    // monotonic per stream
  ts: number;                     // epoch ms
}

interface CodingStreamProvider {
  list(): Promise<CodingStream[]>;
  onListChange(cb: (s: readonly CodingStream[]) => void): () => void;
  subscribe(id: string, signal?: AbortSignal): AsyncIterable<CodingStreamChunk>;
}
```

Athena's `MockCodingStreamProvider` fulfills this today with 5 fake sessions so Bao can see the tile UX. Once Zeus's real provider exists, Athena swaps the factory one line:

```ts
// lib/coding-streams.ts → createCodingStreamProvider()
return new TauriCodingStreamProvider();  // instead of MockCodingStreamProvider
```

---

## What Athena asks Zeus to expose

Tauri-side surface that Athena will wrap with `TauriCodingStreamProvider`:

### Commands (Rust `#[tauri::command]`)

```rust
#[tauri::command]
async fn coding_streams_list() -> Result<Vec<CodingStreamDto>, String>;
//   → snapshot of currently-known streams

#[tauri::command]
async fn coding_streams_send(stream_id: String, input: String) -> Result<(), String>;
//   → bidirectional input (write to PTY). For v1.0 of this feature Athena
//     doesn't surface the input box yet; ship the command anyway.
```

`CodingStreamDto` mirrors the TS `CodingStream` shape (snake_case fields fine).

### Events (emitted via `app.emit_all`)

```text
coding-streams:list-changed         payload: { streams: CodingStreamDto[] }
coding-stream:<id>:chunk            payload: { text: string, seq: number, ts: number }
coding-stream:<id>:status           payload: { status: 'idle' | 'streaming' | 'paused' | 'gone' }
```

The `:<id>:` middle segment is the stream id so Athena's subscription can listen to a specific stream without filtering. If that pattern is awkward, a single `coding-stream:chunk` with `{stream_id, …}` in payload is equally fine — let me know which.

### Discovery rules

- New `claude` / `cursor` / `codex` / `gemini` processes spawned by the OS user running CTRL appear in `list()` automatically. Sub-second discovery latency is fine; Athena polls on `onListChange`.
- Process disappearance fires `status = 'gone'` on the existing id; Athena keeps the buffer until the tile rebinds.
- `cwd` and `pid` are best-effort — populate when readable from `/proc` or equivalent.

### What "labels" should be

Athena renders the label inside the tile header. Suggested: `{basename(cwd)}` or `{basename(cwd)} #{pid}` if multiple sessions share a cwd. Zeus picks the policy; Athena just renders whatever string arrives.

---

## What Athena does NOT need from Zeus

- Per-tile assignment policy (which stream → which slot). Athena assigns by discovery order.
- Pagination beyond 12. Athena shows the first 12 streams from `list()`; extras are silently dropped for v1. If the count grows past 12 routinely, revisit.
- ANSI parsing. Athena renders chunks as plain text with `white-space: pre-wrap`. If ANSI escapes are present they'll show as raw codes — acceptable for v1. v1.x can add an ANSI-to-HTML pass on the consumer side.
- Authentication. Single-user single-machine. Multi-tenant variant is post-v1 (and goes through `tenant_id` on the bearer token, per `irisy-memory-contract.md`).

---

## Athena's open questions for Zeus

1. **Event naming convention** — `coding-stream:<id>:chunk` (per-stream channel) OR a single `coding-stream:chunk` channel with `stream_id` in payload? Athena slightly prefers the per-stream channel for cheap routing; happy with either.
2. **Discovery mechanism** — `procfs`/`ps` polling, `fsevents` watch on user shell history, kernel hooks? Whatever fits Zeus's existing subprocess actor. Athena doesn't care as long as latency for "I just opened claude" is < 2s.
3. **PTY tap for already-running sessions** — practical for existing sessions, or only for ones spawned through CTRL? If the latter, Athena tile renders "(no content — only newer sessions are observable)" for pre-existing PIDs.
4. **Bidirectional send safety** — does `coding_streams_send` require user confirmation per call (CLAUDE.md "risky op" rule)? Athena's plan was per-tile input box with an explicit send button (already a click), so probably OK without an extra prompt.
5. **macOS first, Win/Linux later?** Athena doesn't depend on platform; ship whichever order is cheapest.

---

## Athena's commit checklist (today)

- [x] `lib/coding-streams.ts` with consumer types + mock provider — shipped
- [x] CodeTile / CodeTileActive renders from a CodingStream — shipped
- [x] `createCodingStreamProvider()` factory — currently returns Mock; swap on Zeus delivery
- [x] Tile statuses (●/○/◐/✕) + per-source colored badge — shipped
- [ ] Per-tile input box for `coding_streams_send` — held until Zeus ships the send command
- [ ] ANSI-to-HTML rendering — held until real content shows ANSI in practice
