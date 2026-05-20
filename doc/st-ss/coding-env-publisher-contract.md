# ST-SS Coding-env Publisher Contract

- **Status**: Draft v0.1 (companion to `.olym/specs/stss-protocol/spec.md` v0.7)
- **Date**: 2026-05-20
- **Handoff**: H-2026-05-20-001 (lane-C hephaestus)
- **Triggered by**: bao 2026-05-20 钦定 — coding env 通讯走 ST-SS
- **Audience**: anyone shipping a coding-env publisher (Claude Code session wrapper, cursor-agent bridge, PTY wrapper, agent runtime, etc.)
- **Companion docs**:
  - `.olym/specs/stss-protocol/spec.md` §2.1 (kind union) + §2.1.1 (payload schemas) + §3.1 (capability declaration) + §3.4 (backpressure)
  - `packages/ctrl-stss/src/protocol/kind.ts` (TypeScript types)
  - `packages/ctrl-stss/src/protocol/envelope.ts` (`HelloPayload` shape)

---

## 1. What a "coding env" is, for this contract

A **coding env** is a long-lived publisher that fronts one of:

- A Claude Code / cursor-agent / opencode / aider / etc. session (1 session = 1 publisher)
- A PTY-wrapped subprocess (terminal-only, no agent) running build / test / dev-server
- A composite (PTY + LSP + agent) — common case for Code Space (per memory `project_code_space_path_c.md`)

The env is **not the agent itself** — it is the boundary that exposes the agent + its terminal + its LSP state as one ST-SS stream so the CTRL kernel / Irisy / e-ink reader / mesh peers can subscribe.

**One env = one `stream_id`.** Multiple terminals or agents inside the env are addressed by `terminal_id` / `agent_id` inside the `payload`, not by separate streams.

---

## 2. Hello handshake (mandatory metadata)

Every coding-env publisher MUST send a v0.7-conforming `hello` envelope with this `capabilities` block:

```ts
import type { HelloPayload, Capabilities } from '@ctrl/stss';

const hello: HelloPayload = {
  role: 'sender',
  stream_id: 'coding-env-lane-C-2026-05-20T08-15Z',
  intent: 'coding-env',                              // discriminator (see §2.1)
  capabilities: {
    project_id: 'CTRL',                              // matches the bao/zeus project the env belongs to
    lane_id: 'lane-C',                               // canonical lane label (per decision_lane_a_is_frontend)
    persona_owner: 'hephaestus',                     // zeus | hephaestus | athena | apollo | daedalus | irisy
    agent_type: 'claude-code',                       // see §2.2 enum
    tags: ['spike', 'stss', 'jiazuo'],               // free-form, ≤8 entries, ≤32 chars each
    created_at: '2026-05-20T08:15:00Z',              // ISO 8601 UTC
    coding_env_version: '0.7',                       // matches the ST-SS spec version this env conforms to
    cell_kinds: [                                    // §3.1 already requires this; coding envs typically emit:
      'terminal_output', 'terminal_exit',
      'lsp_state',
      'agent_thinking', 'agent_action',
      'env_status',
    ],
    op_kinds: [                                      // ops the env accepts (subscribers MAY send these back)
      'agent_prompt', 'agent_interrupt',
      'env_signal', 'file_request',
    ],
    needs_capability: ['ProcessSpawn', 'FileRead'],  // kernel verifies subscriber before forwarding (§3.1)
  } satisfies Capabilities,
};
```

### 2.1 `intent: 'coding-env'`

Reserved string; identifies this as a coding-env publisher (vs. hardware / e-ink / generic). Kernel routers MAY shortcut routing based on this value. **Do not invent variants** (`coding-env-rust`, `coding-env-mac`) — use `tags` for variation.

### 2.2 `agent_type` enum (extensible)

| value | meaning |
|---|---|
| `claude-code`    | Anthropic Claude Code session |
| `cursor-agent`   | Cursor's background agent |
| `opencode`       | sst/opencode |
| `aider`          | paul-gauthier/aider |
| `codex-cli`      | OpenAI codex CLI |
| `goose`          | block/goose |
| `pty-only`       | no agent; just terminal wrapper for build/test/dev-server |
| `composite`      | mixed (PTY + agent + LSP); use this when no single agent dominates |
| `(custom)`       | any string allowed; kernel forwards untouched but Irisy may render generically |

### 2.3 ID format conventions

- `stream_id`: `coding-env-<lane>-<iso8601-utc-compact>` recommended (UTC compact form like `2026-05-20T08-15Z`, colons stripped because some transports treat `:` poorly). MUST be unique per env instance.
- `terminal_id` inside `payload`: opaque to subscribers, but conventionally `t<n>` (`t1`, `t2`, ...) per env.
- `agent_id` inside `payload`: opaque, conventionally `<agent_type>-<n>` (`claude-code-1`).
- `env_id` inside `payload`: SHOULD equal `lane_id` if 1 env = 1 lane (typical); otherwise opaque.

### 2.4 What does NOT go in `hello.capabilities`

- Secrets / API keys / OAuth tokens → keychain, never on the wire
- Full file paths in `cwd` — subscribers don't need it; `file_request` is how they ask
- Connected user identity — auth layer handles this (`§2.3 Authentication` in spec)
- Big blobs (>4 KB total `capabilities` size) — emit a `context_snapshot` cell instead

---

## 3. Backpressure declaration (recommended per kind)

The spec (§3.4) defines drop-policy at subscription time. **The publisher** does not enforce; it advertises a `recommended_backpressure` block in its hello so well-behaved subscribers pick sensible defaults. Recommended values for coding envs:

| cell kind | drop policy | coalesce window | buffer | rationale |
|---|---|---|---|---|
| `terminal_output` | `coalesce` | **100 ms** | 1024 | high-volume; consumers (Irisy chat / e-ink) re-render at human speed |
| `terminal_exit`   | `block`    | —          | 64   | rare + load-bearing; never drop |
| `lsp_state`       | `coalesce` | 250 ms     | 256  | per-URI latest-wins; subscribers want current state, not history |
| `agent_thinking`  | `coalesce` by `turn_id` | 200 ms | 512 | stream of tokens; coalesce same turn under load |
| `agent_action`    | `block`    | —          | 256  | rare + load-bearing audit trail |
| `env_status`      | `coalesce` | 500 ms     | 32   | latest-wins; ticks are advisory |

Encoded in `hello.capabilities.recommended_backpressure` as `Record<CellKind, { policy, window_ms?, buffer }>`. Subscribers MAY override per their needs (e.g., e-ink reader uses 1000 ms coalesce on `terminal_output`).

**100 ms terminal_output coalesce is the headline default** — without it a `npm run build` log will saturate a mobile PWA subscriber and starve other cells in the buffer.

---

## 4. Env lifecycle ops — NOT on ST-SS

The following operations **MUST NOT** be modelled as ST-SS ops. They go through HTTP/gRPC against the env's control plane:

| operation | transport | rationale |
|---|---|---|
| Create env (`POST /envs`) | HTTP/gRPC | needs auth + idempotency key + structured response (allocated `stream_id`, control URLs); ST-SS is a stream, not an RPC |
| Destroy env (`DELETE /envs/:id`) | HTTP/gRPC | needs sync ack + cleanup confirmation; subscribers learn via `bye` envelope on the stream |
| Replace env (blue-green swap) | HTTP/gRPC | coordinated 2-step (new env up, traffic switch, old `bye`); modelling as ops invites split-brain |
| Rotate env credentials | HTTP/gRPC | secret material; never on the stream |
| List envs / discovery | HTTP/gRPC | one-shot query response |
| Snapshot / restore env state | HTTP/gRPC | blob transfer |

**What stays on ST-SS**: only events that subscribers benefit from seeing as part of the stream — i.e. the 6 cell kinds + 4 op kinds defined in spec §2.1. Configuration changes that are not visible at the cell layer (allocate more CPU, change agent_type, swap LLM provider) go through the HTTP control plane and may emit a single `env_status` cell as audit.

**Why this boundary** (per bao 2026-05-20):
1. ST-SS is a pub/sub stream — request/response with structured failure modes doesn't fit
2. Auth + idempotency on lifecycle is non-negotiable; ST-SS auth is per-session not per-op
3. Mixing lifecycle in the stream forces every subscriber to filter; clean separation = simpler subscribers

The control-plane HTTP API is **out of scope for this contract** — defined separately in `doc/coding-env/control-plane-api.md` (TBD). This doc is for the **stream layer only**.

---

## 5. Minimum-viable publisher checklist

For a new coding-env publisher to be considered conformant:

- [ ] Sends `hello` with `intent: 'coding-env'` + the full `capabilities` block from §2
- [ ] Emits `env_status` at least once on connect + on every state change (build/tests transition)
- [ ] Wraps every terminal in `terminal_id` and emits `terminal_exit` (never silently leaves a PTY open from a subscriber's view)
- [ ] Emits `agent_thinking` with `done: true` to terminate every streaming turn (subscribers count on this for UI state)
- [ ] Honours incoming `agent_interrupt` / `env_signal` ops idempotently (publisher SHOULD ack via a follow-up `env_status` cell)
- [ ] Responds to `file_request` op with a `tool_result` cell using the same `request_id`
- [ ] Closes with a `bye` envelope on graceful shutdown, including `reconnect_hint` if the env is transient

---

## 6. Non-goals (this contract)

- **Multi-env aggregation** — composing N envs into one virtual env is the kernel router's job, not the publisher's
- **Cross-device sync** — Automerge / ctrl-relay layer (ADR-003), out of scope
- **Per-message encryption** — handled at transport (vodozemac / TLS), not at envelope content
- **Schema migration tooling** — kind extensions are open via `(string & {})`; major changes bump spec version

---

## 7. Open questions (defer to zeus / bao)

1. Should `intent: 'coding-env'` accept sub-variants for hardware coding envs (e.g. Boox terminal)? Current call: **no**, use `tags`. Revisit if hardware coding pubs become common.
2. Should `agent_action.payload` get strong typing per `action_kind`? Current call: **no for v0.7**; revisit if 2+ subscribers complain about runtime type-narrowing pain.
3. Backpressure defaults — should they be enforced (kernel rejects subscriptions that opt below recommended buffer) or advisory? Current call: **advisory v0.7, enforce v0.8 if observed misuse**.
4. Where does the control-plane HTTP API spec live? Recommend `doc/coding-env/control-plane-api.md`, but this is a separate handoff.

---

**End**. ~165 lines. Companion to ST-SS spec v0.7 §2.1 / §2.1.1.
