---
adr_id: 004
title: Kernel capability surface — 10 namespaces / 28 well-known methods (frequency ≥3 rule)
status: proposed
date: 2026-05-22
deciders: [bao, zeus]
related:
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/005-no-claude-in-production-runtime.md
  - .olym/specs/kernel/capability-surface.md       # spec to land alongside accept
  - .olym/handoffs/H-2026-05-18-002-jiazuo-capability-spike.md
  - doc/keycap-integration-research/06-jiazuo-result.md
scope: framework
module: substrate
---

## Context

ADR-010 fixed keycap execution to "MCP outward, Actor inward" but left the inner contract — what the kernel actually exposes to in-process Actors / WASM modules — undefined. Without that surface:

- Keycap authors have no contract: every new keycap re-asks "where do I read the clipboard / fire HTTP / read keyring".
- We risk the inverse bug pile: 16 starter keycaps each binding to a different ad-hoc Tauri command, leaking provider strings into manifest space.
- Reviewers cannot tell the difference between "this is a kernel primitive" and "this is keycap-local code that should stay out of `src-tauri/src/kernel/`".

Jiazuo spike (`H-2026-05-18-002`, RESULT in `doc/keycap-integration-research/06-jiazuo-result.md`, merged 2026-05-20 via PR #15, themis tier-C APPROVE 2026-05-22) sampled the full v1 corpus — 16 starter builtins + 5 keycap-integration patterns A-F + the 45-row long-tail backlog — and produced an evidence-based capability count per namespace. The decision below lifts that evidence into a load-bearing contract.

## Decision

The kernel exposes **10 capability namespaces / 28 well-known methods**, selected by frequency ≥3 across the v1 corpus, plus two infrastructure exceptions:

| # | Namespace | v1 methods |
|---|---|---|
| 1 | `clipboard` | `read`, `write` |
| 2 | `text` | `chat` (LLM stream), `transform`, `template`, `embed` |
| 3 | `network` | `http` (allowlist-bound), `open_url` |
| 4 | `keyring` | `read`, `write` |
| 5 | `screen` | `capture` |
| 6 | `file` | `read`, `write` |
| 7 | `mcp` | `spawn`, `invoke_tool`, `list_tools`, `notifications` |
| 8 | `platform` | `notify`, `hotkey`, `window_list`, `window_focus`, `os_filter` |
| 9 | `image` | `ocr` *(v1.1, kept in surface for forward declaration)* |
| 10 | `text` (extension) | reserved sub-bucket for in-flight providers (see §Consequences) |

**Frequency rule (load-bearing)**: a method enters the kernel surface iff it is consumed by ≥3 keycaps across the v1 corpus, OR it is `mcp.*` / `platform.notify` (the two exemptions — infrastructure not driven by frequency). Methods consumed by 1-2 keycaps stay **keycap-local** (the keycap implements them in its own Actor / MCP server, not the kernel).

**v1.1 promotion candidates** (must NOT ship in v1, will promote on second keycap consumer): `process.spawn` (Pattern B / CLI wrapper), `network.local_rpc` (Pattern C / daemon controller), `oauth.broker` (Pattern E), `stss.{publish,subscribe}` (Pattern F), `image.ocr` (智识 + poster). Until the second consumer lands they remain keycap-local.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | "Expose everything keycap-1 asks for" (grow-on-demand) | First-mover bias: whatever the first keycap needs becomes a primitive, even if no second keycap will ever reuse it. Locks the kernel surface to one keycap's accidental shape. |
| A2 | "Pure MCP-only surface, no native kernel methods" | Forces every clipboard read through an MCP roundtrip — 4-6 ms hop per call, hostile to the hotkey-driven low-latency UX (Top-15 keycap median latency budget = 150 ms total). Also re-introduces the provider-binding leakage ADR-005 forbade. |
| A3 | "Per-keycap negotiated surface" (capability requests via manifest) | Manifests would need a strong capability-checker; every keycap install becomes a security review. v1 doesn't have the manpower; defer to v2 if zero-trust install becomes a requirement. |
| A4 | "Frequency ≥2 instead of ≥3" | Spike showed the ≥3 boundary correctly separates "actually shared infra" from "this keycap's accidental need" — moving to ≥2 would pull in 7 single-use methods (verified in `06-jiazuo-result.md` §Q2.13 table). |

## Consequences

**Positive**:
- 28 typed methods is a small enough surface to ship hand-written Rust + a single derived TS type-gen (`packages/ctrl-kernel-sdk`). No code-generation infrastructure required.
- Frequency rule gives reviewers a one-line test ("Is this used by 3+ keycaps? If yes, promote. If no, keep local."). Eliminates judgment calls.
- v1.1 promotion list is explicit: when a second consumer for `process.spawn` ships, the promotion PR is mechanical, not a re-architecture.
- `text.chat` named at the namespace level isolates LLM provider drift to one method — Volc / BYOK swap (ADR-005) lands in one place.

**Negative / cost**:
- Two infrastructure exceptions (`mcp.*`, `platform.notify`) mean the rule is not pure frequency. Future debates may try to add a third exception; the door must stay closed by default (only bao + zeus can add).
- Kernel surface drift is now a quarterly ADR amendment cost: every consumer-count change above the threshold needs a one-line note. Acceptable price.
- Keycaps doing "rare" things (Pattern C daemon controllers) bear their own `network.local_rpc` implementation in v1. Marginal duplication across 2-3 keycaps until v1.1.

**Reversal cost**: **medium**. The surface is referenced by `@ctrl/kernel-sdk` types + 16 starter keycap manifests. Renaming a namespace = grep-and-replace + sdk re-publish. Dropping a method is harder (existing keycaps would break) and requires a deprecation cycle. Adding a method is cheap.

## Acceptance

- [x] Capability surface lives in code (`src-tauri/src/kernel/capability.rs` + `commands/mod.rs` Tauri command registry) — standalone Zod spec deferred per CLAUDE.md 灵活开发 + memory `feedback_no_planning_no_phasing`. Closed 2026-05-31.
- [x] `packages/ctrl-kernel-sdk/` exists with namespace TS exports; per-namespace surface lives in code. Closed 2026-05-31.
- [x] Ongoing-lock: capability namespaces registered in code; CI lint deferred to ADR-024 substrate composition activation (which bao deferred). Reviewer enforces per-PR until then. Closed as policy-active.
- [x] Builtin manifest validation lives in `shell/builtin_keycaps.rs` boot; ad-hoc lint deferred to ADR-024 activation. Closed.
- [x] CLAUDE.md "Stack" table already references kernel + substrate sub-systems (lines 152+ "Kernel (L1)" row + ADR-001 anchor); standalone spec link not required per 灵活开发. Closed.
- [x] `.olym/decisions/INDEX.md` lists ADR-004 active (verified 2026-05-31). Closed.

## Amendment 2026-05-30 — Kernel sub-systems (Provider + Mesh)

> Scope expansion: this ADR now covers both **capability surface** (28 methods, §Decision) and **kernel sub-systems** (modules under `src-tauri/src/kernel/`). Sub-systems are the implementation backing the capability surface. bao 2026-05-30: "ADR-004 = kernel" 含全部 kernel 范畴.

### §9 Kernel sub-systems (modules under `src-tauri/src/kernel/`)

Each sub-system = a kernel-internal Rust module. Public services serve PWA (via Tauri commands), Pi (via `kernel/mcp_server.rs`), and keycaps (via subprocess MCP). Sub-systems are public services; the 5 primitives (§3) are internal scaffolding.

| Sub-system | Path | Service surface | Consumers |
|---|---|---|---|
| **provider** *(new, 2026-05-30 amendment §9.1)* | `kernel/provider/` | LLM 调用 (text.chat backend) | Pi (主, via thin extension) + keycap (次) |
| **mcp** | `kernel/mcp_host.rs` + `kernel/mcp_server.rs` | MCP client (kernel → external) + MCP server (Pi / external → kernel) | Pi, keycap, external MCP clients |
| **vault** | `kernel/vault.rs` + `kernel/vault_index.rs` | Markdown + FTS5 索引 | PWA (commands/vault.rs), Pi (vault.* MCP tools), keycap |
| **storage** | `kernel/persistence.rs` + `kernel/local_storage.rs` + `kernel/cache.rs` | Event log (internal) + per-keycap KV + LRU blob cache | kernel internal (persistence), keycap (kv/cache via Tauri command) |
| **stss** | `kernel/stss_bridge.rs` + `kernel/subprocess_stss_adapter.rs` | ST-SS WS @17872 intra-device stream protocol | PWA mobile mode, shared windows, hardware keycaps |
| **mesh** *(2026-05-30 amendment §9.2, content moved from former ADR-003)* | `packages/ctrl-mesh/` (independent crate, not yet integrated into `src-tauri/src/kernel/`) | Cross-device E2E sync (vodozemac + Automerge + WebRTC + mDNS + ctrl-relay) | PWA mobile (WASM build), kernel (planned integration) |

**Rule** (binding): each sub-system has one canonical Rust module folder. New LLM/transport/storage code goes into the matching sub-system, not as ad-hoc files. Pre-amendment scatter (`brain_config.rs` + `llm_port.rs` + `llm_adapters/*` — 6 files in 3 places) is the anti-pattern this amendment fixes via §9.1.

---

### §9.1 Provider sub-system (7 条 lock)

bao directive 2026-05-30 "一切以 Pi 为核心 + 统一 adapter + 国产兼容 + Pi 自升级". Round-1 + Round-2 industry research in `.provider-research/FINDING.md` + `FINDING-R2.md` (LiteLLM 125 .py / LobeChat 70 thin TS / Goose / Cline / Vercel AI / Pi-mono) validated the design below.

**Module location**: `src-tauri/src/kernel/provider/` (replaces current scatter: `brain_config.rs` + `llm_port.rs` + `llm_adapters/*` + `commands/brain.rs`).

| # | Lock | Detail |
|---|---|---|
| 1 | Provider trait | `chat_stream(prompt, opts) -> Stream<Chunk>` + `trial_verify() -> Result` + `capabilities() -> Set<Capability>`. One trait, three concrete adapters. |
| 2 | Manifest schema | TOML, fields: `id` / `kind` (cli/openai-shape/anthropic-shape) / `auth` (keychain/env/config_key) / `binary`+`args_template` OR `endpoint`+`headers` / `input_format` / `output_format` / `env_strip` / `env_inject` / `capabilities` / `models[]`. |
| 3 | Registry | `ProviderRegistry::load()` at startup reads builtin TOMLs + user-installed under `~/.ctrl/providers/`. `active_provider(capability) -> ProviderHandle` lookup. |
| 4 | Trial chat verify | `set_active(provider_id)` MUST send a real 1-token `"hi"` chat, await first chunk within 5 s deadline. First chunk → commit active + persist; timeout/error → keep previous + surface specific error (auth / network / model-not-found). Replaces current `healthz/binary-exists` conflation. |
| 5 | 3 shared adapters + `claude_persistent` exception | `cli/one_shot.rs` (codex/gemini, manifest-driven ~200 LOC), `http_api.rs` (openai-shape, manifest-driven ~400 LOC), `http_api.rs` shared with anthropic-shape variant. `cli/claude_persistent.rs` is bespoke (~600 LOC, Goose-style OnceCell<Mutex<CliProcess>> + drain_pending_response + NDJSON control protocol) — claude CLI is the one provider that doesn't fit a generic spawner. |
| 6 | 6 builtin presets | Day-1 ship: `claude-oauth.toml` (claude_persistent), `anthropic-api.toml` + `openai-api.toml` + `volc.toml` + `kimi.toml` + `deepseek.toml` (http_api shape variants). Adding a provider = adding a TOML, no Rust change. 国产 Anthropic-shape endpoints (api.moonshot.cn/anthropic, api.deepseek.com/anthropic, open.bigmodel.cn/api/coding/paas/v4) supported via manifest preset. |
| 7 | Pi consumer path | Pi reaches the provider sub-system via thin TS extension (`packages/ctrl-pi-bridge/`, ~30 LOC) using `pi.registerProvider({ streamSimple })` that HTTP-fetches a new kernel endpoint `localhost:<port>/text-chat`. One spawn logic (Rust kernel), two consumers (Irisy direct Tauri invoke + Pi extension HTTP reverse-call). Per Round-2 finding: Pi has no MCP-client surface (`grep mcp pi-mono/coding-agent/src/` = 0), so ADR-013 kernel-as-MCP-server path can't carry Pi's LLM call. |

**Retired by this lock** (no longer in scope, code to remove):
- `brain_config.rs` + `commands/brain.rs` (brain registry / switcher) — Pi is sole brain, user switches **provider** not brain. PWA brain switcher UI also retires.
- `lib/irisy-tools.ts` + `lib/irisy-llm-runner.ts` (PWA frontend ReAct agent loop) — Pi agent loop takes over per ADR-003 Brain.

**Pi自升级 not in §9.1** — that's the brain (Pi) layer concern. See ADR-003 Brain (Pi) for the upgrade mechanism.

---

### §9.2 Mesh sub-system (content from former ADR-003)

> Former ADR-003 (multi-device-mesh, accepted 2026-05-14) content moved here. ADR-003 file repurposed for Brain (Pi) per bao 2026-05-30 领域 ADR convention (001 架构 / 002 前端 / 003 brain / 004 kernel).

**Decision**: Cross-device communication is a mesh of user-owned devices with E2E encryption + CRDT state, NOT a central CTRL server.

**Stack**: `vodozemac` (Olm 1:1 sessions) + `webrtc-rs` v0.17.x (data channel) + `Automerge` v0.7.x (CRDT) + `mdns-sd` v1.71+ (LAN discovery) + `ctrl-relay` CF Worker (outbound WSS-only for NAT traversal — never holds plaintext). PWA gets WASM builds of vodozemac + Automerge. Zero listening ports for cross-device; intra-device PWA uses 127.0.0.1:17872 WS bridge with token auth.

**Implementation status (2026-05-30)**: `packages/ctrl-mesh/` Rust crate exists (8 files: channel/document/identity/peer/session/signaling/wire/lib), kernel integration = 0 (`grep mesh src-tauri/src/` returns 0 hits). ADR-024 cap_asset.vault references "mesh-synced" but the wire-up is pending.

**Alternatives rejected** (from former ADR-003):

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Central CTRL server (Firebase / Supabase model) | Privacy regression; CN data localization risk; bandwidth bill on us; cannot offer E2E credibly |
| A2 | Bluetooth / wifi-direct only | Fails when devices on different networks |
| A3 | WebRTC without app-layer crypto | DTLS only; no forward secrecy; can't claim Matrix-grade E2E |
| A4 | Yjs CRDT instead of Automerge | Yjs JS-native; needs JS-on-Rust bridge; Automerge has clean Rust+WASM split |

**Consequences** (positive): Real E2E claim → enterprise/OPC trust + differentiation vs cloud-state competitors (豆包 / Coze); no central state on CTRL → bandwidth on user devices + CF free tier; CN-friendly (`*.workers.dev`); hardware peer-ready.

**Consequences** (negative): WebRTC + Olm + Automerge learning curve; cross-platform WASM testing; mdns iOS restrictions.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-22 | Initial draft from `06-jiazuo-result.md` TL;DR; status proposed (awaiting bao accept). |
| 2026-05-30 | Amendment: scope expanded to cover kernel sub-systems (§9). Added §9.1 Provider sub-system (7 条 lock; replaces scattered llm_port/llm_adapters/brain_config). Added §9.2 Mesh sub-system (content moved from former ADR-003, which is repurposed for Brain). bao directive 2026-05-30 "ADR-004 = kernel" + "一切以 Pi 为核心" + 领域 ADR convention. |
