# ST-SS Protocol — CTRL Integration Specification

- **Status**: Draft v0.7 (CTRL profile — adds coding-env vocabulary, H-2026-05-20-001)
- **Date**: 2026-05-11 (v0.6) / 2026-05-20 (v0.7)
- **Parent**: `.olym/decisions/001-system-architecture.md` §3, §4 source #4, §7
- **Source**: Cherry-picked from screi `@screi/protocol-ts` + `@screi/core`
- **v0.7 changes** (H-2026-05-20-001, hephaestus lane-C, bao 2026-05-20 钦定):
  - §2.1: +6 CellKind (terminal_output / terminal_exit / lsp_state / agent_thinking / agent_action / env_status)
  - §2.1: +4 OpKind (agent_prompt / agent_interrupt / env_signal / file_request)
  - §2.1.1 (new): per-kind payload schema reference (coding-specific)
  - Companion contract: `doc/st-ss/coding-env-publisher-contract.md`

---

## 1. Purpose

ST-SS (**Spatio-Temporal Semantic Stream**) is CTRL's protocol for:

1. **Independent desktop AI app integration** — any Tauri/Electron/native app can publish a ST-SS stream to expose itself as a CTRL keycap source (5th category in ADR-001 §4)
2. **Hardware sensor stream** — AI 眼镜 / 录音笔 / 摄像头 / 电纸书 / 指环 publish/subscribe semantic events instead of raw audio/video
3. **Cross-device AI memory** — keycap invocations + LLM responses + tool results stream into event store, replayable across devices

**Core idea**: ST-SS streams **semantic cells + temporal deltas** instead of pixels. 5 KB/s replaces 1.5 Mbps video.

```
Traditional RDP/VNC:  [pixels stream of someone coding]
ST-SS:                [semantic stream: function foo() { return 1; }]
```

---

## 2. Wire format

### 2.1 Event types

```typescript
type StssEvent = Cell | Op;

interface Cell {
  type: 'cell';
  kind: CellKind;
  ts_ms: number;        // epoch ms
  stream_id: string;
  payload: any;         // CBOR-encoded
}

interface Op {
  type: 'op';
  kind: OpKind;
  ts_ms: number;
  stream_id: string;
  payload: any;
}

type CellKind =
  // ─── v0.6 base ───
  | 'user_input'          // typed text, voice transcript, click
  | 'clipboard_snapshot'
  | 'screen_snapshot'     // not pixels, semantic: current_function/current_file/...
  | 'hardware_reading'    // sensor data, AI-summarized
  | 'llm_response'
  | 'tool_result'
  | 'context_snapshot'    // app-defined context blob
  // ─── v0.7 coding-env (H-2026-05-20-001) ───
  | 'terminal_output'     // stdout/stderr chunk from a PTY/subprocess in a coding env
  | 'terminal_exit'       // PTY/subprocess exit (code + signal + duration)
  | 'lsp_state'           // LSP diagnostics + symbols snapshot per file URI
  | 'agent_thinking'      // chain-of-thought delta from a coding agent (streaming)
  | 'agent_action'        // tool_call / file_edit / shell_command / plan_update planned-or-done
  | 'env_status';         // env health: cpu/mem/build_status/test_status

type OpKind =
  // ─── v0.6 base ───
  | 'keycap_invoked'
  | 'keycap_completed'
  | 'hotkey_triggered'
  | 'app_focus_changed'
  | 'file_saved'
  | 'cursor_moved'
  // ─── v0.7 coding-env (H-2026-05-20-001) ───
  | 'agent_prompt'        // user/zeus → agent prompt sent into the env
  | 'agent_interrupt'     // abort the agent's current action
  | 'env_signal'          // SIGINT/SIGTERM/restart/reload_config sent to env
  | 'file_request';       // pull a specific file from the env (request_id correlates)
```

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

Every ST-SS source MUST declare what it can emit + needs:

```yaml
# ST-SS stream metadata, sent at handshake
stream_id: "my-coding-companion"
publisher: "my-vscode-extension"
cell_kinds: [screen_snapshot, llm_response]
op_kinds: [file_saved, keycap_invoked]
needs_capability: [LlmCall, ClipboardRead]
```

CTRL kernel verifies subscriber actor's Capability matches `needs_capability` before forwarding.

### 3.2 Hardware profile

Special considerations for hardware sources:

```yaml
hardware_profile:
  device_type: "ai_glasses" | "voice_recorder" | "desktop_camera" | "eink_reader" | "ai_ring"
  power_class: "always_on" | "intermittent" | "user_triggered"
  bandwidth_class: "5kbps" | "50kbps" | "500kbps"
  latency_budget_ms: 100        # AI 眼镜实时 < 100ms
  battery_aware: true
```

Kernel scheduler uses these to:
- Hardware power_class=`always_on` → priority `Hardware` (preempts everything)
- bandwidth_class=`5kbps` → enables lossy compression / sampling
- battery_aware → reduce poll frequency when device on battery

### 3.3 E-ink rendering profile (杀手用例)

E-ink reader (Boox / Supernote / Daylight) subscribes to coding context stream:

```yaml
eink_render_profile:
  ppi: 227
  refresh_class: "static"      # 不期待 60fps
  page_size: [1404, 1872]
  contrast_class: "binary" | "16_grey" | "full_grey"
  preferred_cells: [current_function, pending_diff, test_status, ai_summary]
```

CTRL kernel emits **e-ink-friendly cells**: pre-formatted text, low-frequency updates, large fonts. User on coffee shop reads code stream on Boox, taps to add comments, comments stream back as `op:annotation_added`.

### 3.4 Backpressure semantics

Hardware streams can outpace consumers. CTRL kernel:

- Each ST-SS subscription has bounded buffer (default 1024 events)
- On overflow: drop policy declared in subscription (drop-oldest / drop-newest / coalesce / block)
- Coalesce: same `cell_kind` from same stream within 100ms → keep latest
- Useful for screen snapshots, cursor movements

---

## 4. CTRL keycap as ST-SS sink

A keycap MAY subscribe to ST-SS streams to receive triggers:

```yaml
# Manifest excerpt
on_stss:
  - stream: "screen_context"
    filter: { cell_kind: "screen_snapshot", payload.app: "vscode" }
    action: spawn_actor("code_companion")
```

This enables "AI 陪我 coding" use case: VSCode extension publishes coding context stream → CTRL keycap subscribes + reacts.

---

## 5. CTRL keycap as ST-SS source

Equally, a keycap MAY emit ST-SS events:

```rust
// Inside keycap actor handler
return vec![
  Effect::EmitEvent {
    target: ActorId::STSS_BROKER,
    event: Event::Cell {
      kind: CellKind::LlmResponse,
      payload: cbor!({"text": llm_output}),
      ts_ms: now_ms(),
    },
  },
];
```

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
