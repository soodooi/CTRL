# CTRL Kernel — L1 Microkernel Specification

- **Status**: Draft (RFC, awaiting P2 implementation review)
- **Date**: 2026-05-11
- **Parent**: `.olym/decisions/001-system-architecture.md` §3
- **Language**: Rust (Tauri host process)

---

## 1. Purpose

The L1 Kernel is the **only privileged code path** in CTRL. It exposes 5 primitives to L2 SDK, mediates all L3 userland actor interactions, and enforces capability-based security. Every keycap invocation, hardware sensor stream, LLM call, MCP tool invocation, and OAuth flow runs as an actor under kernel scheduling.

**Design principle**: minimal kernel surface area. If a feature can live in L2 SDK or L3 userland, it MUST live there. The kernel does scheduling, capability mediation, and event routing — nothing else.

---

## 2. Five primitives

### 2.1 Actor

The `Actor` trait carries an associated `Message: Event` type plus a `State: Send` type, and exposes `name()`, the pure handler `handle(state, msg, ctx) -> Vec<Effect>`, plus optional `on_spawn` / `on_shutdown` hooks. Each handler call receives an `ActorContext` carrying `self_id`, optional `parent_id`, the static `Capability`, and an optional `deadline_ms`.

*(The `Actor` trait + `ActorContext` definitions. Implementation: `src-tauri/src/kernel/actor.rs`.)*

**Properties**:
- Each actor has its own state (no shared mutable memory across actors)
- Mailbox is bounded MPSC channel (back-pressure on producers)
- Actor handler MUST be pure: input message + state → list of effects + state transition
- No direct IO, no direct LLM, no direct file system — all via `Effect`

### 2.2 Capability

`Capability` is a `BTreeSet<CapToken>`. `CapToken` is an enum grouping every authority an actor can request, organized into 6 buckets:

- **LLM** — `LlmCall { model, max_tokens }`
- **Storage** — `FsRead { path_glob }`, `FsWrite { path_glob }`, `KvRead { namespace }`, `KvWrite { namespace }`
- **Network** — `HttpGet { url_glob }`, `HttpPost { url_glob }`
- **System** — `ClipboardRead`, `ClipboardWrite`, `HotkeyRegister { combo }`
- **MCP** — `McpInvoke { server, tool_glob }`
- **ST-SS** — `StssEmit { stream_id }`, `StssSubscribe { stream_id }`
- **Inter-actor** — `Spawn { prototype }`, `Send { target }`

*(The `Capability` + `CapToken` enum. Implementation: `src-tauri/src/kernel/capability.rs`.)*

**Rules**:
- Capabilities are **static** — declared in manifest at actor spawn time
- No ambient authority — kernel reject effects whose capability is not held
- Child actors inherit a SUBSET of parent capability (no escalation)
- Capability tokens are immutable post-spawn; mutation requires re-spawn

**Example**: a translation keycap manifest declares `capabilities: [ClipboardRead, ClipboardWrite, LlmCall { model: "workers-ai/qwen-3", max_tokens: 4096 }]`. Any attempt to read filesystem or call a non-Qwen model is rejected by the Capability Broker.

### 2.3 Event

`Event` is an enum with two variants — `Cell { kind: CellKind, ts_ms, payload: CborValue }` (passive observation) and `Op { kind: OpKind, ts_ms, payload }` (action / state transition).

- `CellKind` covers `UserInput`, `ClipboardSnapshot`, `ScreenSnapshot`, `HardwareReading` (camera frame / audio / sensor), `LlmResponse`, `McpToolResult`, `ApiResponse`.
- `OpKind` covers keycap lifecycle (`KeycapInvoked` / `KeycapCompleted` / `KeycapFailed`), actor lifecycle (`ActorSpawned` / `ActorTerminated`), `HotkeyTriggered`, and LLM streaming (`LlmCallStarted` / `LlmCallChunk` / `LlmCallFinished`).

*(`Event` + `CellKind` + `OpKind` enums. Implementation: `src-tauri/src/kernel/event.rs`.)*

**Properties**:
- All inter-actor communication uses Event
- ST-SS protocol = wire format for Event when crossing process / device boundary
- Events persisted to event store (SQLite + WAL) for replay / debug / AI memory
- CBOR encoding (compact, schema-flexible)

### 2.4 Channel

`Channel<T: Event>` wraps a typed `tx` / `rx` pair with a bounded `capacity` (Tokio MPSC). Static helpers `Channel::bounded(capacity)` constructs the pair; `Channel::typed::<U>()` requests a re-typed view (compile-time message check).

*(`Channel<T>` definition. Implementation: `src-tauri/src/kernel/channel.rs`.)*

**Properties**:
- Typed pipes between actors (compile-time message type check)
- Bounded — back-pressure when full (Tokio `mpsc::channel`)
- Drop policy configurable: block / drop-oldest / drop-newest

### 2.5 Effect

`Effect` is the enum of operations a handler can request the kernel perform on its behalf. Each effect carries the data needed to execute it plus a `reply_to: ActorId` for async result delivery (where applicable). Variants:

- `LlmCall { model, prompt, deadline_ms, reply_to }`
- `McpInvoke { server, tool, args, reply_to }`
- `EmitEvent { target, event }`
- `SpawnActor { prototype, capability, parent_id, initial_state }`
- `PersistEvent { event, index }` (`index: Vec<String>` for query)
- `ShellExec { cmd, args, reply_to }`
- `HttpRequest { method, url, headers, body, reply_to }`

*(`Effect` enum. Implementation: `src-tauri/src/kernel/effect.rs`.)*

**Properties**:
- Effects are **values returned from actor handlers**, not invoked directly
- Kernel executes effects asynchronously
- Each effect carries `reply_to` ActorId for async result delivery
- Capability check: kernel verifies actor's `Capability` includes the effect's token before execution

---

## 3. Kernel modules

### 3.1 Actor Scheduler

The `Scheduler` owns an `actors: HashMap<ActorId, ActorHandle>` plus a `priority_queue` and a `deadline_queue` (`BinaryHeap<DeadlineEntry>`). `ActorPriority` has 5 levels: `Hardware` (0, preempts all — camera/audio/hotkey), `LlmStream` (1, LLM streaming chunks), `UserAction` (2, keycap invocation / UI), `Background` (3, analytics / market sync), `Idle` (4).

*(`Scheduler` + `ActorPriority`. Implementation: `src-tauri/src/kernel/scheduler.rs`.)*

**RTOS-inspired scheduling**:
- Priority preemption: hardware actors preempt user-action actors
- Deadline-aware: LLM call with deadline 2s, kernel kills + fails over if exceeded
- Bounded memory: actor declares budget at spawn, kernel rejects over-allocation

### 3.2 Capability Broker

`CapabilityBroker` holds `actor_caps: HashMap<ActorId, Capability>` and an `inheritance_graph` mapping child → parent. Two methods: `check(actor, effect)` verifies the actor's capability covers the requested effect's token; `derive_child(parent, requested)` derives a child capability constrained to a subset of the parent's tokens (no escalation).

*(`CapabilityBroker`. Implementation: `src-tauri/src/kernel/capability.rs` / `broker.rs`.)*

**Rules**:
- No ambient authority — every effect requires explicit capability token check
- Child capability MUST be subset of parent
- Capability cannot be granted at runtime — only at actor spawn

### 3.3 Event Bus

`EventBus` holds `subscriptions: HashMap<EventFilter, Vec<ActorId>>` and an `EventStore` for persistence.

*(`EventBus`. Implementation: `src-tauri/src/kernel/event_bus.rs`.)*

- Pub-sub with filter by `CellKind` / `OpKind` / payload patterns
- All events persisted to local SQLite via WAL (durable)
- Replay support for debugging + AI memory queries

### 3.4 LLM Port

`LlmAdapter` is a trait — each adapter declares its `name()` (e.g. `workers-ai`, `anthropic`, `openai`, `ollama`), a `supports(model)` check, and `invoke(prompt, deadline_ms) -> BoxStream<LlmChunk>` for streaming inference. `LlmPort` owns the `adapters: Vec<Box<dyn LlmAdapter>>` plus a `fallback_chain: Vec<String>` (e.g. workers-ai/qwen → anthropic/claude → ollama/llama).

*(`LlmAdapter` trait + `LlmPort`. Implementation: `src-tauri/src/kernel/llm_port.rs`.)*

**Fallback logic**:
- Try primary (CF Workers AI / Qwen) first
- On timeout / error / quota exhausted → next adapter (BYOK Anthropic)
- Final fallback: local Ollama if available
- All attempts emit `OpKind::LlmCallChunk` for streaming observability

### 3.5 MCP Host

`McpHost` owns `discovered_servers: HashMap<String, McpServerHandle>` plus a `sandbox: Arc<dyn Sandbox>`. Surface: `discover_from_registry(url)` returns available servers, `install(server)` adds one, `invoke(server, tool, args)` runs a tool call returning a CBOR result.

*(`McpHost`. Implementation: `src-tauri/src/kernel/mcp_host.rs`.)*

- Uses Anthropic MCP SDK (Rust port or shells out to TS reference impl)
- Every MCP server runs inside WASM sandbox (Anthropic Sandbox Runtime port)
- Discovery via official MCP Registry + community sources

### 3.6 Persistence

`EventStore` holds a local `SqlitePool` plus an optional cross-device CRDT layer (`YjsDoc` proposed; final choice tracked in §8 Open RFC items).

*(`EventStore`. Implementation: `src-tauri/src/kernel/persistence.rs`.)*

- SQLite event store: `events(id, ts_ms, actor_id, kind, payload, idx_a, idx_b, idx_c)`
- WAL for crash recovery
- Optional CRDT layer (Phase 11+) for cross-device sync

---

## 4. Sandbox model (WASM)

Every L3 userland actor runs inside a WASM sandbox. Choices for v1:

| Option | Pros | Cons |
|---|---|---|
| `wasmtime` | Bytecode Alliance, Rust-native, mature | Larger binary |
| `wasmer` | Multiple runtimes (cranelift / LLVM / singlepass) | Younger |
| Anthropic Sandbox Runtime port | Direct fit for MCP servers, native OS primitives | Not Tauri-tested |

**P2 RFC will decide**. Default bias: `wasmtime` for actor sandbox + Anthropic Sandbox Runtime for MCP server processes.

**Capability injection**: each WASM instance gets a host import table that mirrors actor's `Capability` — only declared effects are callable.

---

## 5. Persistence schema

Three SQLite tables underpin the event store:

- **`events`** — `id` (autoinc PK), `ts_ms`, `actor_id`, `kind` (e.g. `Cell:UserInput` / `Op:KeycapInvoked`), `payload` (CBOR blob), plus three optional index columns `idx_a`/`idx_b`/`idx_c` for query (e.g. `conversation_id`). Indexed on `ts_ms`, `actor_id`, `kind`, and `idx_a` (partial, non-null).
- **`actors`** — `id` (PK), `prototype`, `parent_id`, `capability` (CBOR), `state` (CBOR snapshot, periodic), `spawned_at_ms`, `status` (`running` / `terminated`).
- **`manifests`** — `id` (PK), `version`, `source` (`builtin` / `market` / `local-dev`), `spec` (CBOR), `cached_at_ms`.

*(SQL DDL elided. Implementation: `src-tauri/src/kernel/persistence/schema.sql` (or inline migrations in `kernel/persistence.rs`).)*

---

## 6. L2 SDK surface (TypeScript view)

`@ctrl/kernel-sdk` exports six top-level functions that wrap the corresponding L1 syscall:

- `defineActor(manifest) -> ActorPrototype`
- `spawn(prototype, capability) -> ActorId`
- `send(target, event) -> Promise<void>`
- `subscribe(filter, handler) -> Subscription`
- `emit(effect) -> Promise<EffectResult>`
- `capability(...tokens) -> Capability`

*(L2 SDK signatures. Implementation: `packages/ctrl-kernel-sdk/src/index.ts`.)*

L2 wraps L1 syscalls. L3 keycaps and creator manifests target L2, never L1 directly.

---

## 7. P2 implementation order

1. Actor + Channel + Scheduler skeleton (Tokio-based) — 3 days
2. Capability Broker + token check — 2 days
3. Event Bus + SQLite persistence — 3 days
4. LLM Port (with workers-ai + anthropic adapters) — 2 days
5. Effect executor (async runtime, fan-out, capability check) — 2 days
6. MCP Host (stub initially, full integration P4) — 1 day
7. Tests + actor benchmarks — 2 days

**Total ~2 weeks**. Heaviest single deliverable in entire P1-P11 plan.

---

## 8. Open RFC items (resolve in P2 review)

- [ ] Actor runtime: pure Tokio vs `actix` framework vs Bevy ECS (parallel scheduler)
- [ ] WASM sandbox: wasmtime vs wasmer vs Anthropic Sandbox Runtime
- [ ] Event store: own SQLite vs LiveStore vs TanStack DB
- [ ] CRDT: Yjs (cross-language) vs Automerge (Rust-native) vs none for v1
- [ ] Hot reload: how to swap actor code without losing state — checkpoint/restore via event replay
- [ ] Distributed actors: in-scope for v1 (cross-device via ST-SS) or v2?

---

## 9. Validation criteria

L1 Kernel implementation considered "done" when:

- [ ] 5 primitives exposed via stable Rust API
- [ ] All effects mediated by capability check (no bypass)
- [ ] Event store survives crash + replays cleanly
- [ ] LLM Port routes to workers-ai with anthropic fail-over
- [ ] First MCP server can be discovered + invoked with full capability check
- [ ] Bench: 10,000 actor spawns + 100,000 events/sec on M1 Pro
- [ ] WASM sandbox prevents file system access outside declared capability
