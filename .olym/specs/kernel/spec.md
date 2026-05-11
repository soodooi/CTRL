# CTRL Kernel — L1 Microkernel Specification

- **Status**: Draft (RFC, awaiting P2 implementation review)
- **Date**: 2026-05-11
- **Parent**: `.claude/ADR/001-system-architecture.md` §3
- **Language**: Rust (Tauri host process)

---

## 1. Purpose

The L1 Kernel is the **only privileged code path** in CTRL. It exposes 5 primitives to L2 SDK, mediates all L3 userland actor interactions, and enforces capability-based security. Every keycap invocation, hardware sensor stream, LLM call, MCP tool invocation, and OAuth flow runs as an actor under kernel scheduling.

**Design principle**: minimal kernel surface area. If a feature can live in L2 SDK or L3 userland, it MUST live there. The kernel does scheduling, capability mediation, and event routing — nothing else.

---

## 2. Five primitives

### 2.1 Actor

```rust
pub trait Actor: Send + 'static {
    type Message: Event;
    type State: Send;
    
    fn name(&self) -> &str;
    fn handle(
        &mut self,
        state: &mut Self::State,
        msg: Self::Message,
        ctx: ActorContext,
    ) -> Vec<Effect>;
    
    fn on_spawn(&mut self, _state: &mut Self::State, _ctx: ActorContext) -> Vec<Effect> {
        vec![]
    }
    
    fn on_shutdown(&mut self, _state: &mut Self::State) {}
}

pub struct ActorContext {
    pub self_id: ActorId,
    pub parent_id: Option<ActorId>,
    pub capability: Capability,
    pub deadline_ms: Option<u64>,
}
```

**Properties**:
- Each actor has its own state (no shared mutable memory across actors)
- Mailbox is bounded MPSC channel (back-pressure on producers)
- Actor handler MUST be pure: input message + state → list of effects + state transition
- No direct IO, no direct LLM, no direct file system — all via `Effect`

### 2.2 Capability

```rust
pub struct Capability {
    tokens: BTreeSet<CapToken>,
}

pub enum CapToken {
    // LLM
    LlmCall { model: String, max_tokens: Option<u32> },
    // Storage
    FsRead { path_glob: String },
    FsWrite { path_glob: String },
    KvRead { namespace: String },
    KvWrite { namespace: String },
    // Network
    HttpGet { url_glob: String },
    HttpPost { url_glob: String },
    // System
    ClipboardRead,
    ClipboardWrite,
    HotkeyRegister { combo: String },
    // MCP
    McpInvoke { server: String, tool_glob: String },
    // ST-SS
    StssEmit { stream_id: String },
    StssSubscribe { stream_id: String },
    // Inter-actor
    Spawn { prototype: String },
    Send { target: ActorId },
}
```

**Rules**:
- Capabilities are **static** — declared in manifest at actor spawn time
- No ambient authority — kernel reject effects whose capability is not held
- Child actors inherit a SUBSET of parent capability (no escalation)
- Capability tokens are immutable post-spawn; mutation requires re-spawn

**Example**: a translation keycap manifest declares:
```yaml
capabilities:
  - ClipboardRead
  - ClipboardWrite
  - LlmCall: { model: "workers-ai/qwen-3", max_tokens: 4096 }
```
Any attempt to read filesystem or call non-Qwen model is rejected by Capability Broker.

### 2.3 Event

```rust
pub enum Event {
    Cell {
        kind: CellKind,
        ts_ms: u64,
        payload: CborValue,
    },
    Op {
        kind: OpKind,
        ts_ms: u64,
        payload: CborValue,
    },
}

pub enum CellKind {
    UserInput,       // keypress, click, voice
    ClipboardSnapshot,
    ScreenSnapshot,
    HardwareReading, // camera frame, audio chunk, sensor
    LlmResponse,
    McpToolResult,
    ApiResponse,
}

pub enum OpKind {
    KeycapInvoked,
    KeycapCompleted,
    KeycapFailed,
    ActorSpawned,
    ActorTerminated,
    HotkeyTriggered,
    LlmCallStarted,
    LlmCallChunk,
    LlmCallFinished,
}
```

**Properties**:
- All inter-actor communication uses Event
- ST-SS protocol = wire format for Event when crossing process / device boundary
- Events persisted to event store (SQLite + WAL) for replay / debug / AI memory
- CBOR encoding (compact, schema-flexible)

### 2.4 Channel

```rust
pub struct Channel<T: Event> {
    tx: ChannelTx<T>,
    rx: ChannelRx<T>,
    capacity: usize,
}

impl<T: Event> Channel<T> {
    pub fn bounded(capacity: usize) -> (ChannelTx<T>, ChannelRx<T>) { ... }
    pub fn typed<U: Event>(&self) -> Result<Channel<U>, TypeError> { ... }
}
```

**Properties**:
- Typed pipes between actors (compile-time message type check)
- Bounded — back-pressure when full (Tokio `mpsc::channel`)
- Drop policy configurable: block / drop-oldest / drop-newest

### 2.5 Effect

```rust
pub enum Effect {
    LlmCall {
        model: String,
        prompt: LlmPrompt,
        deadline_ms: u64,
        reply_to: ActorId,
    },
    McpInvoke {
        server: String,
        tool: String,
        args: CborValue,
        reply_to: ActorId,
    },
    EmitEvent {
        target: ActorId,
        event: Event,
    },
    SpawnActor {
        prototype: String,
        capability: Capability,
        parent_id: ActorId,
        initial_state: CborValue,
    },
    PersistEvent {
        event: Event,
        index: Vec<String>,  // for query
    },
    ShellExec {
        cmd: String,
        args: Vec<String>,
        reply_to: ActorId,
    },
    HttpRequest {
        method: HttpMethod,
        url: String,
        headers: BTreeMap<String, String>,
        body: Option<CborValue>,
        reply_to: ActorId,
    },
}
```

**Properties**:
- Effects are **values returned from actor handlers**, not invoked directly
- Kernel executes effects asynchronously
- Each effect carries `reply_to` ActorId for async result delivery
- Capability check: kernel verifies actor's `Capability` includes the effect's token before execution

---

## 3. Kernel modules

### 3.1 Actor Scheduler

```rust
pub struct Scheduler {
    actors: HashMap<ActorId, ActorHandle>,
    priority_queue: PriorityHeap<ActorId>,
    deadline_queue: BinaryHeap<DeadlineEntry>,
}

pub enum ActorPriority {
    Hardware,    // 0 — preempts all (camera, audio, hotkey)
    LlmStream,   // 1 — LLM streaming chunks
    UserAction,  // 2 — keycap invocation, UI
    Background,  // 3 — analytics, market sync
    Idle,        // 4
}
```

**RTOS-inspired scheduling**:
- Priority preemption: hardware actors preempt user-action actors
- Deadline-aware: LLM call with deadline 2s, kernel kills + fails over if exceeded
- Bounded memory: actor declares budget at spawn, kernel rejects over-allocation

### 3.2 Capability Broker

```rust
pub struct CapabilityBroker {
    actor_caps: HashMap<ActorId, Capability>,
    inheritance_graph: HashMap<ActorId, ActorId>,
}

impl CapabilityBroker {
    pub fn check(&self, actor: ActorId, effect: &Effect) -> Result<(), CapabilityError> { ... }
    pub fn derive_child(&self, parent: ActorId, requested: Capability) 
        -> Result<Capability, CapabilityError> { ... }
}
```

**Rules**:
- No ambient authority — every effect requires explicit capability token check
- Child capability MUST be subset of parent
- Capability cannot be granted at runtime — only at actor spawn

### 3.3 Event Bus

```rust
pub struct EventBus {
    subscriptions: HashMap<EventFilter, Vec<ActorId>>,
    persistence: EventStore,
}
```

- Pub-sub with filter by `CellKind` / `OpKind` / payload patterns
- All events persisted to local SQLite via WAL (durable)
- Replay support for debugging + AI memory queries

### 3.4 LLM Port

```rust
pub trait LlmAdapter {
    fn name(&self) -> &str;  // "workers-ai", "anthropic", "openai", "ollama"
    fn supports(&self, model: &str) -> bool;
    fn invoke(&self, prompt: LlmPrompt, deadline_ms: u64) -> BoxStream<LlmChunk>;
}

pub struct LlmPort {
    adapters: Vec<Box<dyn LlmAdapter>>,
    fallback_chain: Vec<String>,  // ["workers-ai/qwen", "anthropic/claude", "ollama/llama"]
}
```

**Fallback logic**:
- Try primary (CF Workers AI / Qwen) first
- On timeout / error / quota exhausted → next adapter (BYOK Anthropic)
- Final fallback: local Ollama if available
- All attempts emit `OpKind::LlmCallChunk` for streaming observability

### 3.5 MCP Host

```rust
pub struct McpHost {
    discovered_servers: HashMap<String, McpServerHandle>,
    sandbox: Arc<dyn Sandbox>,
}

impl McpHost {
    pub async fn discover_from_registry(&mut self, url: &str) -> Result<Vec<McpServer>>;
    pub async fn install(&mut self, server: &McpServer) -> Result<()>;
    pub async fn invoke(&self, server: &str, tool: &str, args: CborValue) -> Result<CborValue>;
}
```

- Uses Anthropic MCP SDK (Rust port or shells out to TS reference impl)
- Every MCP server runs inside WASM sandbox (Anthropic Sandbox Runtime port)
- Discovery via official MCP Registry + community sources

### 3.6 Persistence

```rust
pub struct EventStore {
    db: SqlitePool,  // local
    crdt: Option<YjsDoc>,  // optional cross-device sync
}
```

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

```sql
-- Event store
CREATE TABLE events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms       INTEGER NOT NULL,
    actor_id    TEXT NOT NULL,
    kind        TEXT NOT NULL,   -- "Cell:UserInput" / "Op:KeycapInvoked"
    payload     BLOB NOT NULL,   -- CBOR
    idx_a       TEXT,            -- optional index col (e.g., conversation_id)
    idx_b       TEXT,
    idx_c       TEXT
);
CREATE INDEX idx_events_ts ON events(ts_ms);
CREATE INDEX idx_events_actor ON events(actor_id);
CREATE INDEX idx_events_kind ON events(kind);
CREATE INDEX idx_events_a ON events(idx_a) WHERE idx_a IS NOT NULL;

-- Actor registry
CREATE TABLE actors (
    id            TEXT PRIMARY KEY,
    prototype     TEXT NOT NULL,
    parent_id     TEXT,
    capability    BLOB NOT NULL,  -- CBOR-encoded Capability
    state         BLOB,           -- CBOR snapshot, periodically updated
    spawned_at_ms INTEGER NOT NULL,
    status        TEXT NOT NULL   -- "running" / "terminated"
);

-- Manifest cache
CREATE TABLE manifests (
    id            TEXT PRIMARY KEY,
    version       TEXT NOT NULL,
    source        TEXT NOT NULL,  -- "builtin" / "market" / "local-dev"
    spec          BLOB NOT NULL,  -- CBOR-encoded manifest
    cached_at_ms  INTEGER NOT NULL
);
```

---

## 6. L2 SDK surface (TypeScript view)

```typescript
// @ctrl/kernel-sdk
export function defineActor(manifest: ActorManifest): ActorPrototype;
export function spawn(prototype: ActorPrototype, capability: Capability): ActorId;
export function send(target: ActorId, event: Event): Promise<void>;
export function subscribe(filter: EventFilter, handler: (e: Event) => void): Subscription;
export function emit(effect: Effect): Promise<EffectResult>;
export function capability(...tokens: CapToken[]): Capability;
```

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
