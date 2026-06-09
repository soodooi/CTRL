---
adr_id: 001
module: spine
title: CTRL spine — 4-layer kernel + 5 primitives + 5 mcp sources + dual-brain reframe + 6 self-evolution loops
version: 3
status: accepted
last_updated: 2026-06-09
deciders: [bao, zeus]
sections:
  - { id: layers,         source: orig-001-§3 }
  - { id: primitives,     source: orig-001-§1.2 }
  - { id: sources,        source: orig-001-§1.3 }
  - { id: pi-centric,     source: orig-001-§11-6th }
  - { id: invariants,     source: orig-001-§4 }
  - { id: philosophy,     source: orig-001-§6 }
  - { id: self-evolution, source: brainstorm system-self-evolution-2026-06-04 }
changelog:
  - v3 2026-06-09: **§4 Pi-centric → dual-brain architecture amendment (H-2026-06-09-001, PR #66).** User-chosen opencode + Hermes as peer brains (conversation 2026-06-09 08:48): "确认 干" + "继续 干". §4 diagram updated: USER ↔ ui-ux ↔ KERNEL ↔ {opencode (coding) · Hermes (assistant)} ↔ {PROVIDER · MCP}. Both brains spawned as peer subprocess agents with independent provider management. Each brain owns its context; no cross-brain context sharing. Pi removed from dual-brain (still available as standalone CLI for advanced workflows). Hermes installed via `npm install -g hermes-agent` (NousResearch). Locks: (1) **No brain switcher UI** — Coding L1 chip routes to opencode, Assistant L1 chip routes to Hermes. (2) **Independent credential vault** — each brain reads from keychain separately (`opencode` → `~/.local/share/opencode/auth.json`, Hermes → `~/.hermes/config.yaml`). (3) **Stdio + MCP** — opencode uses HTTP API (parsed port), Hermes uses MCP stdio protocol. 8 code review issues fixed (race condition, health check, vault, event leaks, constants, graceful degradation). ADR-002 substrate §1 updated v17→v18 (dual-brain).
  - v2 2026-06-04: add §8 self-evolution v1 — 6 parallel loops × 6 stages (Detect/Diagnose/Plan/Execute/Verify/Learn) governing how CTRL improves itself across Irisy chat, provider routing, cap curation, vault index, system self-healing, and cross-user MCP/SKILL recommendation. Locks Typed ISA + microkernel validation + audit ledger + policy envelope + vim-test as the 5 cross-loop invariants. Per bao "整个系统都要自我升级成长" + "经常整理 ADR".
  - v1 2026-05-31: module reorg — merged from numbered ADR-001 (4-layer + 5 primitives + 5 sources + Pi-centric reframe + 10 invariants + design philosophy locks). 21 numbered ADRs collapsed into 7 module ADRs; this is the spine.
related:
  - .olym/decisions/002-substrate.md
  - .olym/decisions/003-frontend.md
  - .olym/decisions/005-irisy.md
  - .olym/decisions/006-cross-cutting.md
  - .olym/brainstorm/system-self-evolution-2026-06-04.md
---

> **Spine — immutable**. New session reads §1. All module-specific detail in module ADR (see `.olym/decisions/INDEX.md`).

## §1 Layers — 4-layer stack (physical topology)

```
L3 Userland — subprocess-isolated mcps via MCP
       ↑↓
L2 SDK — @ctrl/{kernel-sdk, stss, memory, mcp-sdk}
       ↑↓
L1 CTRL Kernel — Rust microkernel
                 5 primitives + mcp_host (out) + mcp_server :17873 (in)
                 + ST-SS WS :17872 + vault_index (SQLite FTS5)
                 + provider sub-system (ADR-002 § provider)
       ↑↓
L0 Tauri 2 Native Shell — ~500 LOC Rust
                          (hotkey / tray / window / keychain / kernel_supervisor)
       ↑↓ embeds WebView2 / WKWebView
PWA — single web codebase (Tauri WebView desktop + browser mobile)
```

## §2 Primitives — 5 (`src-tauri/src/kernel/`)

| Primitive | File | Role |
|---|---|---|
| Actor | `actor.rs` · `subprocess_actor.rs` | subprocess-isolated runtime unit |
| Capability | `capability.rs` · `capability_resolver.rs` | typed kernel↔userland surface |
| Channel | `channel.rs` | bidi message stream |
| Event | `event.rs` | pub/sub bus |
| Effect | `effect.rs` | controlled side-effect proxy |

## §3 Mcp sources — 5

1. **MCP servers** (10k+ Day-1, via `mcp_host.rs`)
2. **Big-platform OAuth** (Feishu / Notion / Linear / Slack / …)
3. **Local agents** (subprocess + portable-pty, ADR-002 § subprocess)
4. **ST-SS shared windows** (long-tail desktop + hardware, `stss_bridge.rs`)
5. **Builtin** (`packages/ctrl-mcps/` ships with app)

## §4 Dual-brain 5-block view (logical, co-exists with §1)

```
USER ↔ ui-ux (PWA) ↔ KERNEL ↔ {opencode (coding) · Hermes (assistant)} ↔ {PROVIDER (LLM) · MCP (tool)}
```

- **ui-ux** — PWA, single React 18 + Vite 5 + TanStack codebase (ADR-003)
  - **Coding L1 chip** (`/coding`) → `<CodingArtifactPane />` + `<IrisyChat forceMode="coding" />` (v16 legacy, retained as placeholder pending opencode PWA integration)
  - **Assistant L1 chip** (`/assistant`) → `<OpencodeChat />` + `<HermesChat />` (dual-brain streaming)
- **KERNEL** — Rust microkernel + sub-systems (ADR-002)
  - `opencode_supervisor.rs` — spawns opencode subprocess, parses HTTP port, manages lifecycle
  - `hermes_supervisor.rs` — spawns Hermes subprocess via MCP stdio, manages lifecycle
  - `opencode_chat_stream` — SSE streaming to PWA (delta/done/error events)
  - `hermes_chat_stream` — SSE streaming to PWA (MCP tool calling, Tauri events)
- **opencode** ★ — coding brain (LSP integration, formatter, symbol search, plan/summary agents). Spawns via `npm run opencode:spawn` → HTTP API on random port. Provider: user-configured BYOK (stored in `~/.local/share/opencode/auth.json`). Context: isolated coding sessions, no cross-brain sharing.
- **Hermes** ★ — assistant brain (RAG + long-term memory). Spawns via `hermes mcp serve` → MCP stdio protocol. Provider: user-configured BYOK (stored in `~/.hermes/config.yaml`). Context: isolated assistant sessions, no cross-brain sharing.
- **PROVIDER** — LLM adapters opencode/Hermes call (ADR-002 § provider)
- **MCP** — tools opencode/Hermes invoke via MCP (ADR-004)

Two views are not mutually exclusive: §1 = process / binary boundary; §4 = role in dual-brain run.

## §5 Filesystem invariants (10 — ship-after immutable)

1. One mcp = one directory `~/.ctrl/mcps/<id>/`. `rm -rf` fully uninstalls.
2. Vault sibling-structured `~/Documents/CTRL/{notes,assets/}`. Obsidian / VMark default compatible.
3. `~/.ctrl/state/` is derivative (event-log / vault-index / cache). Out of backup scope.
4. Prompts are markdown (vim-editable, git-diffable, agentskills.io standard).
5. Secrets → macOS Keychain. `~/.ctrl/config.toml` non-sensitive only.
6. Manifest = YAML/TOML frontmatter. Zod-validated, plain text.
7. Mobile = IndexedDB queue + LRU evict + soft quota.
8. Backup source = `~/Documents/CTRL/` + `~/.ctrl/{mcps,config.toml,mesh/identity}`.
9. Skills truth model — `~/.ctrl/mcps/<id>/skills/` source; `~/.ctrl/skills/<mcp-id>/<sub-id>/` aggregated view.
10. v1.0 mcp runtime = `.ts` / `.js` only. Python / Rust deferred.

## §6 Design philosophy locks

1. **Subprocess + Tauri ACL > WASM** — Tauri Capability + Isolation + CSP, no double-sandbox.
2. **Kernel atomic, composition in brain/skill** — one-shot per kernel call.
3. **MCP is the tool wire** — inbound (kernel-as-MCP-server) + outbound (kernel-as-MCP-host).
4. **Lean kernel** — only what v1 uses; v1.x WASM target = WasmEdge if ever needed.

## §7 Anti-list (what CTRL is NOT)

Workflow editor (Coze/n8n own that) · 自己造硬件 · 100+ 长尾 platform adapter · Quicker 8000 clone · ChatGPT GPTs 接入 · 多 tenant SaaS · AI chat app (workbench framing).

## §8 Self-evolution — 6 parallel loops × 6 stages v1

bao 2026-06-04: **整个 CTRL 系统都要自我升级成长**, 不仅是 Irisy LLM. CTRL self-evolution = **6 闭环并行**, 每个走相同 6 阶段管道. Detail brainstorm: `system-self-evolution-2026-06-04.md`.

### §8.1 The 6 loops

| # | Loop | Scope |
|---|---|---|
| 1 | **Irisy chat reflection** | LLM behavior tuning via failure-signal detect → sleep-time subagent reflect → playbook inject (Letta-code mode) |
| 2 | **Provider routing self-tuning** | per-provider trust score + per-action telemetry (extends v3 byok-first cooldown, Nova AI Ops) |
| 3 | **Cap curation** | usage telemetry → cap rating / recommend / uninstall proposal (Voyager skill library) |
| 4 | **Vault index optimization** | search query log + click-through → re-rank embeddings / auto-alias (Mem0 consolidate) |
| 5 | **System self-healing** | kernel/Pi error → Pi diagnostic agent → typed remediation + verify + rollback (ReCiSt 4-layer) |
| 6 | **Cross-user MCP/SKILL recommendation** | opt-in cross-user usage aggregation → recommendation (v1.x scope, privacy-preserving) |

### §8.2 The 6 stages (cross-loop invariant)

Every loop, regardless of scope, executes the same 6 stages:

```
1. Detect       0-cost rule-based signal recognition (no LLM, no latency)
2. Diagnose     LLM causal hypothesis (on-demand, NOT per-turn / per-event)
3. Plan         Typed ISA action (NOT raw commands; arxiv 2604.09963: -95% harm)
4. Execute      Microkernel-validated + policy-envelope-gated + transactional
5. Verify       Did the signal actually recover? (skip = "auto-fix loops forever")
6. Learn        Consolidate to markdown playbook + SQLite audit ledger + Pi prompt
```

### §8.3 5 cross-loop invariants (locked)

1. **Typed ISA** — every Plan output is a typed `SelfEvolutionAction` variant; agents cannot express raw shell / DB / fs writes. Naturally extends ADR-001 §2 primitives (Effect type) to self-improvement actions. arxiv 2604.09963 evidence: -95% agent-caused harm (77% → 4%).
2. **Microkernel validation** — the CTRL kernel itself validates every typed action against capability scope + blast-radius limit + autonomy level. Reuses `capability_resolver.rs` (ADR-002 § primitives).
3. **Audit ledger** — every self-evolution event (detect → learn) writes an immutable row in `persistence.rs` SQLite event store (ADR-002 § audit-ledger v1, ship 2026-06-04). Replay-able, queryable.
4. **Policy envelope + autonomy L3/L4/L5** — UUMit autonomy ladder (cap-design-v2 §14 #8) becomes the cross-loop default: L3 = suggest-only, L4 = low-risk auto + high-risk suggest, L5 = full auto within envelope. ADR-006 cross-cutting § policy-envelope v1.
5. **vim test守住** — every learnable artifact lands in `vault/.irisy-memory/*.md` + `vault/.ctrl/*.yaml`. Markdown + YAML, user-readable, user-editable. No black-box vector stores.

### §8.4 Rollout — Crawl / Walk / Run (risk-layered, not time-phased)

bao `feedback_no_planning_no_phasing` lock: this is **risk layering**, not v1 / v1.x phase delivery. Single branch, accumulating commits.

- **Crawl (suggest-only)**: All loops emit detect signals to audit ledger; no auto-act. Settings → 自我升级 tab surfaces "what CTRL would have done". Loops 1 (Irisy detect) + 5 (audit ledger schema) ship first — Loop 5 is the substrate every other Learn stage writes to.
- **Walk (low-risk auto)**: Loops 1 (reflect + improve) + 2 (provider trust score) + 3 (cap rating) + 4 (vault alias) auto-execute; verify mandatory; auto-rollback on verify-fail.
- **Run (full auto, deferred)**: Loops 5 (Pi restart, kernel recover) + 6 (cross-user telemetry, opt-in) ship after audit ledger has weeks of evidence and Memory-R1-style RL fine-tune signal.

### §8.5 Sequencing

```
Loop 5 audit ledger schema  ← substrate, ships first
        │
        ├── Loop 1 (Irisy reflect)        ← parallel
        ├── Loop 2 (provider trust)       ← parallel
        │
        ├── Loop 3 (cap curation)         ← depends on Loop 5 schema
        ├── Loop 4 (vault index)          ← depends on Loop 5 schema
        │
        └── Loop 6 (cross-user)           ← deferred, needs opt-in telemetry + ctrl-cloud aggregator
```

### §8.6 Acceptance

- [ ] 6-loop architecture documented in brainstorm `system-self-evolution-2026-06-04.md`.
- [ ] Typed ISA enum `SelfEvolutionAction` lands in `kernel/self_evolution/isa.rs` (ADR-002 § typed-isa v1 amend, P1).
- [ ] Audit ledger schema lands in `persistence.rs` (ADR-002 § audit-ledger v1 amend, P0).
- [ ] Policy envelope L3/L4/L5 lands cross-loop (ADR-006 § policy-envelope v1 amend, P0).
- [ ] Loop 1 detect + Loop 5 audit ledger ship as Crawl-phase MVP.
- [ ] Per-loop §3 detail amends arrive in their owning ADRs (1 → ADR-005 §5, 2 → ADR-002 § provider amend, 3 → ADR-007 § cap-curation, 4 → ADR-002 § vault amend, 5 → new section or ADR-002 § self-healing, 6 → ADR-006 § telemetry).

## Acceptance

- [x] 5 primitive Rust modules in `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs`. Verified.
- [x] 5 mcp source types documented. Verified.
- [x] Repo topology — single deliverable repo + ctrl-cloud separate. Verified.
- [x] Dual-brain architecture — opencode (coding) + Hermes (assistant) as peer brains, independent contexts, kernel supervisors (opencode_supervisor.rs, hermes_supervisor.rs), PWA streaming commands. Verified 2026-06-09 (H-2026-06-09-001).
- [x] Vault stack — Tiptap + CodeMirror 6 + mermaid.js + FTS5 (ADR-003). Verified.
- [x] Lean kernel — wasmtime / cranelift / sandbox.rs / composition.rs removed. Verified.
- [x] Kernel-as-MCP-server @ :17873 (ADR-002 § mcp-bus). Verified.
- [x] Provider router shipped v0.1.126 (ADR-002 § provider v1). Verified 2026-05-31.

## Provenance

Original ADR-001 v1.x (2026-05-11 → 2026-05-30) — 4-layer architecture + 5 primitives + 5 sources + 6 校准 narrative. Full校准 history preserved in git log; this v1 keeps the load-bearing decisions only.
