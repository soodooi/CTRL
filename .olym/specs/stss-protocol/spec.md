# ST-SS Protocol — CTRL Integration Specification

- **Status**: Draft v0.7 (CTRL profile — adds coding-env vocabulary, H-2026-05-20-001)
- **Date**: 2026-05-11 (v0.6) / 2026-05-20 (v0.7)
- **Parent**: `.olym/decisions/001-system-architecture.md` §3, §4 source #4, §7
- **Source**: Cherry-picked from screi `@screi/protocol-ts` + `@screi/core`
- **v0.7 changes** (H-2026-05-20-001, hephaestus lane-C, bao 2026-05-20 钦定):
  - §2.1: +6 CellKind (terminal_output / terminal_exit / lsp_state / agent_thinking / agent_action / env_status)
  - §2.1: +4 OpKind (agent_prompt / agent_interrupt / env_signal / file_request)
  - §2.1.1 (new): per-kind payload schema reference (coding-specific)
  - §2.1.2 (new): cross-language wire naming divergence note + ADR-{TBD} pointer (themis tier B H2)
  - Companion contract: `doc/st-ss/coding-env-publisher-contract.md`

---

## 1. Purpose

ST-SS (**Spatio-Temporal Semantic Stream**) is CTRL's protocol for:

1. **Independent desktop AI app integration** — any Tauri/Electron/native app can publish a ST-SS stream to expose itself as a CTRL keycap source (5th category in ADR-001 §4)
2. **Hardware sensor stream** — AI 眼镜 / 录音笔 / 摄像头 / 电纸书 / 指环 publish/subscribe semantic events instead of raw audio/video
3. **Cross-device AI memory** — keycap invocations + LLM responses + tool results stream into event store, replayable across devices

**Core idea**: ST-SS streams **semantic cells + temporal deltas** instead of pixels. 5 KB/s replaces 1.5 Mbps video. Where a traditional RDP/VNC stream pipes raw pixels of someone coding, ST-SS pipes the semantic event ("function foo returned 1") and lets the receiver render it however it likes.

---

## 2. Wire format

### 2.1 Event types

`StssEvent` is the union `Cell | Op`. Both share `type` (discriminator: `'cell'` or `'op'`), `kind`, `ts_ms` (epoch ms), `stream_id`, and a CBOR-encoded `payload`.

`CellKind` (passive observation):

- **v0.6 base** — `user_input` (typed text / voice transcript / click), `clipboard_snapshot`, `screen_snapshot` (semantic, not pixels: current_function / current_file / …), `hardware_reading` (sensor data, AI-summarized), `llm_response`, `tool_result`, `context_snapshot` (app-defined blob)
- **v0.7 coding-env** (H-2026-05-20-001) — `terminal_output` (PTY/subprocess stdout/stderr chunk), `terminal_exit` (PTY exit code + signal + duration), `lsp_state` (LSP diagnostics + symbols per file URI), `agent_thinking` (CoT delta from a coding agent, streaming), `agent_action` (tool_call / file_edit / shell_command / plan_update planned-or-done), `env_status` (cpu / mem / build / test health)

`OpKind` (action / state transition):

- **v0.6 base** — `keycap_invoked`, `keycap_completed`, `hotkey_triggered`, `app_focus_changed`, `file_saved`, `cursor_moved`
- **v0.7 coding-env** — `agent_prompt` (user/zeus → agent prompt sent into env), `agent_interrupt` (abort agent's current action), `env_signal` (SIGINT/SIGTERM/restart/reload_config), `file_request` (pull a specific file; correlates by `request_id`)

*(TS wire types. Implementation: `packages/ctrl-stss/src/protocol/kind.ts` and matching Rust `CellKind`/`OpKind` in `src-tauri/src/kernel/event.rs`.)*

### 2.1.1 Coding-env payload schemas (v0.7)

> Every coding-env publisher (PTY wrapper / Claude Code session / cursor-agent / ST-SS bridge) MUST emit these `payload` shapes. Receivers MAY index custom fields but MUST NOT depend on them.

**Cells**:

| kind | payload fields | example |
|---|---|---|
| `terminal_output` | `terminal_id: string`, `stream: 'stdout' \| 'stderr'`, `bytes: string` (utf-8 or base64 if `encoding='base64'`), `encoding?: 'utf8' \| 'base64'` (default `utf8`), `seq?: number` (monotonic per terminal) | `{terminal_id:"t1", stream:"stdout", bytes:"running tests...\n"}` |
| `terminal_exit` | `terminal_id: string`, `exit_code: number \| null`, `signal?: string`, `duration_ms?: number` | `{terminal_id:"t1", exit_code:0, duration_ms:4280}` |
| `lsp_state` | `uri: string` (file://...), `language_id: string`, `version?: number`, `diagnostics: Array<{severity:'error'\|'warn'\|'info'\|'hint', message:string, range:{start:{line,character}, end:{line,character}}, source?:string}>`, `symbols?: Array<{name:string, kind:string, range:{...}}>` | `{uri:"file:///src/app.ts", language_id:"typescript", diagnostics:[{severity:"error", message:"Cannot find name 'foo'", range:{start:{line:10,character:4}, end:{line:10,character:7}}}]}` |
| `agent_thinking` | `agent_id: string`, `delta: string`, `done: boolean`, `token_count?: number`, `turn_id?: string` (correlates with `agent_prompt`) | `{agent_id:"claude-1", delta:"Let me check the file...", done:false}` |
| `agent_action` | `agent_id: string`, `action_kind: 'tool_call' \| 'file_edit' \| 'shell_command' \| 'plan_update' \| 'task_update'`, `summary: string` (≤200 chars), `status: 'planned' \| 'in_progress' \| 'done' \| 'failed'`, `payload: unknown` (kind-specific blob; SHOULD be CBOR-encodable), `correlates_with?: string` (prior `agent_prompt` id) | `{agent_id:"claude-1", action_kind:"file_edit", summary:"edit src/app.ts:10", status:"done", payload:{path:"src/app.ts", lines_added:3, lines_removed:1}}` |
| `env_status` | `env_id: string`, `cpu_pct?: number` (0-100), `mem_mb?: number`, `build: 'idle' \| 'building' \| 'ok' \| 'failed'`, `tests: 'idle' \| 'running' \| 'ok' \| 'failing'`, `last_changed_at_ms: number` | `{env_id:"lane-C", build:"ok", tests:"running", cpu_pct:42, mem_mb:1230, last_changed_at_ms:1716200000000}` |

**Ops**:

| kind | payload fields | example |
|---|---|---|
| `agent_prompt` | `agent_id: string`, `prompt_id: string` (uuid), `content: string`, `attachments?: Array<{kind:'file'\|'image', uri?:string, base64?:string, mime?:string}>` | `{agent_id:"claude-1", prompt_id:"p-9af2", content:"fix the failing test in app.spec.ts"}` |
| `agent_interrupt` | `agent_id: string`, `reason?: string` | `{agent_id:"claude-1", reason:"user pressed Esc"}` |
| `env_signal` | `env_id: string`, `signal: 'SIGINT' \| 'SIGTERM' \| 'SIGKILL' \| 'restart' \| 'reload_config'` | `{env_id:"lane-C", signal:"SIGINT"}` |
| `file_request` | `env_id: string`, `request_id: string` (uuid), `path: string`, `max_bytes?: number` (default 256 KB) | `{env_id:"lane-C", request_id:"r-1a", path:"src/app.ts", max_bytes:65536}` |

**Notes**:

- `terminal_id` / `env_id` / `agent_id` are publisher-scoped opaque strings; receivers MUST treat them as cookies, not parse semantics
- `agent_thinking` is streaming-friendly: emit many cells with `done:false`, terminal one with `done:true` + same `turn_id`. Coalesce policy (§3.4) MAY merge by `turn_id` if subscriber buffer overflows
- `agent_action.payload` is intentionally `unknown` — the shape depends on `action_kind`. Stable enough for v0.7; if a publisher needs strong typing it MAY narrow via custom kind (`(string & {})` extension)
- `env_status.build` / `tests` enums are 4-state and DELIBERATELY not extended; richer telemetry goes through custom cells the receiver opts in to
- `file_request` is an op (one-shot), the response comes back as a `tool_result` cell correlated by `request_id`

### 2.1.2 Cross-language wire naming divergence (v0.7 known gap)

**The wire string for a given semantic cell kind is not yet unified between the TS and Rust implementations.** Known divergence as of v0.7:

| Semantic kind | TS wire string (`packages/ctrl-stss/src/protocol/kind.ts`) | Rust wire string (`src-tauri/src/kernel/...` serde-tagged enum) |
|---|---|---|
| MCP tool result   | `tool_result`        | `mcp_tool_result` (`CellKind::McpToolResult` default serde name) |

**Subscribers consuming streams from mixed-language publishers MUST tolerate both spellings** until alignment lands. Two viable resolutions, tracked in **ADR-{TBD} (v1.0 ST-SS cross-language alignment)** — owner zeus to open:

1. Rename Rust enum's serde tag to `tool_result` (matches TS, breaks any in-flight Rust publishers)
2. Rename TS literal to `mcp_tool_result` (matches Rust, breaks any in-flight TS subscribers)

Either way, the migration window MUST include a forward-compat shim that accepts both. v0.7 explicitly does NOT pick a winner — picking is part of the v1.0 cross-language stability gate.

**Same risk applies to the v0.7 additions**: when zeus mirrors the 6 new `CellKind` + 4 new `OpKind` into Rust, prefer plain snake_case matching the TS literals (`terminal_output`, `agent_prompt`, etc.) without `mcp_`-style prefixes. If Rust enum naming forces a prefix (per Rust crate convention), the `#[serde(rename = "...")]` attribute MUST keep the wire string aligned with TS.

### 2.2 Transport

Three transport profiles:

| Transport | Use case |
|---|---|
| **Local WebSocket** (`ws://localhost:N`) | App on same machine → CTRL desktop |
| **Cloudflared tunnel** (`wss://stream.ctrl.app/<token>`) | Cross-device, NAT traversal, mobile/hardware |
| **In-process channel** | Built-in actors inside CTRL kernel |

### 2.3 Authentication

- Local: shared secret in OS keychain
- Remote: short-lived JWT issued by `ctrl-auth`
- Hardware: device pairing flow (QR code or BLE), persistent device token

---

## 3. CTRL Profile (this spec's contribution to ST-SS)

screi's base protocol is application-agnostic. CTRL profile adds:

### 3.1 Capability declaration (every stream)

Every ST-SS source MUST declare what it can emit + needs at handshake. Required fields: `stream_id`, `publisher`, `cell_kinds: [...]`, `op_kinds: [...]`, `needs_capability: [...]` (e.g. `LlmCall`, `ClipboardRead`).

*(Handshake metadata schema elided — see `packages/ctrl-stss/src/protocol/handshake.ts` for the YAML/JSON shape.)*

CTRL kernel verifies subscriber actor's Capability matches `needs_capability` before forwarding.

### 3.2 Hardware profile

Hardware publishers attach a `hardware_profile` declaring `device_type` (`ai_glasses` / `voice_recorder` / `desktop_camera` / `eink_reader` / `ai_ring`), `power_class` (`always_on` / `intermittent` / `user_triggered`), `bandwidth_class` (`5kbps` / `50kbps` / `500kbps`), `latency_budget_ms` (e.g. 100 for AI glasses), and `battery_aware: true|false`.

*(Profile schema elided — see `packages/ctrl-stss/src/protocol/hardware-profile.ts`.)*

Kernel scheduler uses these to:
- Hardware power_class=`always_on` → priority `Hardware` (preempts everything)
- bandwidth_class=`5kbps` → enables lossy compression / sampling
- battery_aware → reduce poll frequency when device on battery

### 3.3 E-ink rendering profile (杀手用例)

E-ink reader (Boox / Supernote / Daylight) subscribes to a coding context stream by declaring an `eink_render_profile` with `ppi` (e.g. 227), `refresh_class: 'static'` (no 60fps expected), `page_size: [1404, 1872]`, `contrast_class` (`binary` / `16_grey` / `full_grey`), and `preferred_cells: [current_function, pending_diff, test_status, ai_summary]`.

*(Profile schema elided — see `packages/ctrl-stss/src/protocol/eink-render-profile.ts`.)*

CTRL kernel emits **e-ink-friendly cells**: pre-formatted text, low-frequency updates, large fonts. User on coffee shop reads code stream on Boox, taps to add comments, comments stream back as `op:annotation_added`.

### 3.4 Backpressure semantics

Hardware streams can outpace consumers. CTRL kernel:

- Each ST-SS subscription has bounded buffer (default 1024 events)
- On overflow: drop policy declared in subscription (drop-oldest / drop-newest / coalesce / block)
- Coalesce: same `cell_kind` from same stream within 100ms → keep latest
- Useful for screen snapshots, cursor movements

---

## 4. CTRL keycap as ST-SS sink

A keycap MAY subscribe to ST-SS streams to receive triggers. In the manifest, declare an `on_stss` block: each entry binds a `stream` id + `filter` (e.g. `cell_kind: screen_snapshot`, `payload.app: vscode`) + `action` (e.g. `spawn_actor("code_companion")`).

*(Manifest subscription block elided — see `.olym/specs/tool-manifest/spec.md` for the authoritative schema.)*

This enables "AI 陪我 coding" use case: VSCode extension publishes coding context stream → CTRL keycap subscribes + reacts.

---

## 5. CTRL keycap as ST-SS source

Equally, a keycap MAY emit ST-SS events. Inside a keycap actor handler, return an `Effect::EmitEvent` targeting `ActorId::STSS_BROKER` with `Event::Cell { kind: CellKind::LlmResponse, payload, ts_ms }`.

*(Emit-pattern elided — see `src-tauri/src/kernel/stss_bridge.rs` and keycap reference examples under `src-tauri/src/actors/`.)*

This event:
1. Persisted to local event store (replayable AI memory)
2. Broadcast to subscribed devices (E-ink reader gets the LLM response page)
3. Optionally synced via CRDT layer (Phase 11+)

---

## 6. Cross-device sync

Phase 11+, `ctrl-sync` worker hosts CRDT broker:

```
桌面 CTRL ──┐
            ├── Yjs CRDT doc ──→ ctrl-sync (CF Worker) ──→ 移动 / 电纸书 / 眼镜
手机 app ───┤
            │
眼镜 SDK ───┘
```

Sync content:
- AI memory (event store)
- Manifest installed list
- Subscription state
- Preset / template library

Resolution: causal order (Lamport timestamp). Conflicts merged by Yjs / Automerge.

---

## 7. Cherry-pick from screi

Source location: `D:/code-space/screi/packages/{protocol-ts, core}/`

What to import into `packages/ctrl-stss/`:
- `protocol-ts/src/envelope.ts` — Cell/Op types
- `protocol-ts/src/cbor.ts` — encoding
- `core/src/reducer.ts` — namespaced state reducer (selective)
- `core/src/transport/ws.ts` — local WebSocket transport

What to drop:
- `protocol-ts/src/v1-legacy/*` — remote-viewing specific (apps/remote payloads)
- `core/src/transport/relay.ts` — defer to Phase 11 cross-device
- `auth/` — CTRL has its own auth via ctrl-auth, not screi auth
- `stss-composer/` — multi-source aggregation, defer to v1.2

What to add (CTRL-specific):
- Hardware profile schema (§3.2)
- E-ink rendering profile (§3.3)
- Backpressure policy declaration (§3.4)
- CTRL kernel Effect bridge (§5)

---

## 8. Phase plan

| Phase | Content |
|---|---|
| P3 | Cherry-pick screi → `packages/ctrl-stss/` + `packages/ctrl-memory/` |
| P3.5 | Wire `ctrl-stss` to L1 Kernel event bus (`Event::Cell/Op` ↔ ST-SS wire) |
| P4 | MCP host events also routed through ST-SS event bus |
| P5-P7 | Manifest schema can subscribe/emit ST-SS streams |
| P11 | Hardware SDK (Rust + TS): `@ctrl/stss-hardware` for device makers |
| P11.5 | E-ink + AI 眼镜 + 录音笔 reference implementations |
| P12 | Cross-device sync via ctrl-sync + Yjs |

---

## 9. Schema version + migration

ST-SS v0.5 (screi base) → v0.6 (CTRL profile):

- Added: `stream_id`, `capability` declaration, `hardware_profile`
- Added: `eink_render_profile`
- Renamed: `kind` → split into `cell_kind` / `op_kind`
- Removed: `agent.output`, `window.capture`, `webrtc.*` (remote-viewing legacy)

Backward compat: v0.5 streams (apps/remote) detected by absence of `stream_id`, auto-wrapped in v0.6 envelope with `stream_id="legacy-remote"`.

---

## 10. References

- screi v0.5 ship report — `D:/code-space/screi/docs/handoff/2026-05-05-zeus-flagship-loop-result.md`
- screi protocol spec — `D:/code-space/screi/docs/protocol/v0.5/` (read once during cherry-pick)
- Yjs CRDT — https://github.com/yjs/yjs
- Automerge — https://automerge.org/
