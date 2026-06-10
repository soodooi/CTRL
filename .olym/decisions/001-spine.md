---
adr_id: 001
module: spine
title: CTRL spine — 4-layer kernel + 5 primitives + 5 mcp sources + 3-agent aggregator + 3-capability-face + 6 self-evolution loops
version: 4
status: accepted
last_updated: 2026-06-09
deciders: [bao, zeus]
sections:
  - { id: layers,         source: orig-001-§3 }
  - { id: primitives,     source: orig-001-§1.2 }
  - { id: sources,        source: orig-001-§1.3 }
  - { id: aggregator,     source: H-2026-06-09-002 conversation }
  - { id: invariants,     source: orig-001-§4 }
  - { id: philosophy,     source: orig-001-§6 }
  - { id: self-evolution, source: brainstorm system-self-evolution-2026-06-04 }
changelog:
  - v4 2026-06-09: **§4 dual-brain supervisor → 3-agent aggregator amendment (H-2026-06-09-002).** bao framing校准 (2026-06-09 conversation): "Irisy 是表象", "hermes opencode kairo 都是外部的", "现在重要的是前端". Dual-brain supervisor model (v3) RETRACTED — kernel no longer spawns/supervises brains. Replaced by **3-agent aggregator**: kernel lazy-installs + launches external agents (hermes / opencode / kairo), PWA consumes their native endpoints directly. Locks: (1) **CTRL = OS-level ambient aggregator** — not a single-purpose chat/coding/PKM app; the 4 friend products (Claude Desktop, Codex, WorkBuddy, CodeBuddy) are single-vertical, CTRL横切聚合. (2) **3-capability-face SSOT** — MCP (protocol), API (provider router, e.g. fal.ai 985 endpoints), Skills (markdown SKILL.md). 三面互补不塌缩, supersedes 2026-06-05 `decision_keycap_collapses_to_mcp_meta_ux_layer` over-simplification. (3) **3 external agents** — hermes (NousResearch, assistant) / opencode (coding) / kairo (notes/PKM, MIT). All lazy-installed to `~/.ctrl/agents/`. Kernel doesn't supervise — launch-on-demand, PWA owns retry. (4) **Irisy = PWA persona**, not brain. ADR-005 amend. (5) **No "vault" word inside CTRL** — call it "Notes". kairo owns the editor; CTRL exposes `~/Documents/CTRL/Notes/` as MCP server to hermes. (6) **fal.ai as flagship API provider** — Codex 接 gpt-image-2 锁单家; CTRL 接 fal.ai 拿 985 模型. Retired: ADR-002 §1 supervisor model (v18 → v19), ADR-002 §8 vault stack lock (Tiptap+CodeMirror+FTS5 → kairo). PR target: this branch.
  - v3 2026-06-09: **§4 Pi-centric → dual-brain architecture amendment (H-2026-06-09-001, PR #84).** RETRACTED by v4 (3-agent aggregator). Kept in changelog for provenance only.
  - v2 2026-06-04: add §8 self-evolution v1 — 6 parallel loops × 6 stages (Detect/Diagnose/Plan/Execute/Verify/Learn) governing how CTRL improves itself across Irisy chat, provider routing, cap curation, notes index, system self-healing, and cross-user MCP/SKILL recommendation. Locks Typed ISA + microkernel validation + audit ledger + policy envelope + vim-test as the 5 cross-loop invariants. Per bao "整个系统都要自我升级成长" + "经常整理 ADR".
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
              + 3 external agents (hermes / opencode / kairo) lazy-installed in ~/.ctrl/agents/
       ↑↓
L2 SDK — @ctrl/{kernel-sdk, stss, memory, mcp-sdk}
       ↑↓
L1 CTRL Kernel — Rust microkernel (thin: install + launch + bridge, NOT supervise)
                 5 primitives + mcp_host (out) + mcp_server :17873 (in)
                 + ST-SS WS :17872 + notes_index (SQLite FTS5, optional — kairo owns primary)
                 + provider sub-system (ADR-002 § provider — fal.ai + Anthropic + OpenAI + Hunyuan + DeepSeek BYOK)
                 + agent_installer / agent_launcher (no supervisor; PWA owns retry)
       ↑↓
L0 Tauri 2 Native Shell — ~500 LOC Rust
                          (hotkey / tray / window / keychain / kernel_supervisor)
       ↑↓ embeds WebView2 / WKWebView
PWA — single web codebase (Tauri WebView desktop + browser mobile)
       ↑↓ connects directly to each agent's native endpoint (HTTP / MCP stdio / webview)
3 external agents — hermes (assistant) · opencode (coding) · kairo (notes)
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

## §4 3-agent aggregator 5-block view (logical, co-exists with §1)

```
              ┌──────────────────────────────────────────────────┐
USER ↔ PWA ↔ │ KERNEL (thin: install · launch · keychain · MCP) │ ↔ { 3 agents } ↔ { provider · MCP · skills }
              └──────────────────────────────────────────────────┘
                                                                ↓
                                          ┌─────────────────────┼─────────────────────┐
                                          ↓                     ↓                     ↓
                                      hermes               opencode                 kairo
                                   (assistant)             (coding)              (notes/PKM)
```

- **ui-ux** — PWA, single React 18 + Vite 5 + TanStack codebase (ADR-003). 5 L1 chips: Irisy (persona shell) / Mcp pool / Notes (kairo) / Coding (opencode) / Assistant (hermes).
- **KERNEL** — Rust microkernel, **极薄** (ADR-002 v19):
  - `agent_installer.rs` — lazy `npm install --prefix ~/.ctrl/agents/<name>/` on first launch; node probe; manifest write.
  - `agent_launcher.rs` — spawn on demand, return native endpoint (HTTP port / stdio pipe) to PWA; **no supervisor / no restart loop** — PWA owns retry.
  - `mcp_server :17873` (ADR-002 § mcp-bus) — exposes Notes folder + clipboard + OCR + provider router to agents as MCP tools.
  - `provider/` — fal.ai + Anthropic + OpenAI + Hunyuan + DeepSeek + Volc (BYOK) adapters; routes `image.generate` / `video.generate` / `text.chat` (ADR-002 § provider).
  - `keychain` — unified credential vault; agents read via env-injected token at launch (no per-agent config file proliferation).
- **hermes** ★ external (NousResearch, MIT) — assistant brain (RAG + long-term memory). MCP stdio. `npm install -g hermes-agent` → `~/.ctrl/agents/hermes/`. PWA `/assistant` consumes.
- **opencode** ★ external (MIT) — coding brain (LSP / formatter / symbol search / plan / subagents / Skills). HTTP API. `npm install -g opencode-ai` → `~/.ctrl/agents/opencode/`. PWA `/coding` consumes.
- **kairo** ★ external (MIT) — notes/PKM (markdown + wiki-link + backlink + native git). Desktop binary. PWA `/notes` embeds via webview pointed at `~/Documents/CTRL/Notes/`.
- **provider** — LLM/image/video API adapters; **fal.ai is flagship** (985 endpoints, FLUX 2 / Seedream / Recraft / Nano Banana Pro / Kling 3.0 / Veo 3.1 / Hunyuan Video). Codex 锁单家 gpt-image-2, CTRL 拿 985 模型聚合.
- **MCP** — tools agents invoke via MCP (ADR-004). CTRL kernel itself is an MCP server (in) AND host (out).
- **Skills** — markdown `SKILL.md` (Claude Code Skills schema). `~/.ctrl/skills/<id>/`. Cross-agent: skills callable from any of the 3 agents.

Two views are not mutually exclusive: §1 = process / binary boundary; §4 = aggregator role per ambient session.

### §4.1 3-capability-face SSOT

CTRL has **three** capability faces,互补不塌缩:

| Face | Protocol | Wire-in | Wire-out | Example |
|---|---|---|---|---|
| **MCP** | Model Context Protocol stdio / Streamable HTTP | `mcp_server.rs :17873` | `mcp_host.rs` | clipboard / OCR / Notes.search / Figma MCP |
| **API** | REST / WebSocket / SDK | `provider/router.rs` | `provider/adapter/*.rs` | fal.ai (985 endpoints) / Anthropic / OpenAI / Hunyuan / DeepSeek |
| **Skills** | markdown `SKILL.md` + script | `~/.ctrl/skills/<id>/` | invoked by any agent | `$imagegen` / `$refactor` / `$summarize` |

**Friend-product gap**: Claude Desktop + Codex + WorkBuddy + CodeBuddy all support MCP + Skills; API face is locked to their single brand (OpenAI / Anthropic / Tencent Yuanbao / Hunyuan). **CTRL's API face is the differentiator** — aggregator (fal.ai 985 image/video/audio models, plus任意 LLM BYOK).

### §4.2 What CTRL is NOT vs friend products

| Friend product | What it is | What CTRL is NOT |
|---|---|---|
| Claude Desktop | Anthropic chat client | CTRL is not single-brand chat |
| Codex CLI / Desktop | OpenAI coding agent | CTRL is not single-brand coding (we聚合 opencode + 任意 BYOK) |
| WorkBuddy (Tencent) | Workplace automation agent | CTRL is not enterprise-IM glue |
| CodeBuddy (Tencent) | AI IDE for Yuanbao/DeepSeek | CTRL is not an IDE |
| Obsidian | Markdown PKM | CTRL doesn't ship its own editor — kairo does |
| OpenRouter | LLM router | CTRL is not just routing — also ambient + workspace + skill substrate |

**CTRL = OS-level ambient aggregator** — 4 friend products are single-vertical; CTRL横切聚合 via `Ctrl` hotkey + ephemeral workspace.

## §5 Filesystem invariants (12 — ship-after immutable)

1. One mcp = one directory `~/.ctrl/mcps/<id>/`. `rm -rf` fully uninstalls.
2. Notes folder = `~/Documents/CTRL/Notes/` (kairo workspace; markdown + frontmatter; Obsidian / vim / VMark compatible). Was "vault" pre-v4 — renamed because bao "我没有 vault 这个概念" (2026-06-09).
3. `~/.ctrl/state/` is derivative (event-log / notes-index / cache). Out of backup scope.
4. Prompts are markdown (vim-editable, git-diffable, agentskills.io standard).
5. Secrets → macOS Keychain. `~/.ctrl/config.toml` non-sensitive only.
6. Manifest = YAML/TOML frontmatter. Zod-validated, plain text.
7. Mobile = IndexedDB queue + LRU evict + soft quota.
8. Backup source = `~/Documents/CTRL/Notes/` + `~/.ctrl/{mcps,agents,skills,config.toml,mesh/identity}`.
9. Skills truth model — `~/.ctrl/skills/<id>/SKILL.md` is SSOT (Claude Code Skills schema). Skills are cross-agent (any of the 3 agents may invoke). Was "`~/.ctrl/mcps/<id>/skills/`" pre-v4 — uplifted to top-level because Skills is now a peer capability face (§4.1).
10. v1.0 mcp runtime = `.ts` / `.js` only. Python / Rust deferred.
11. **External agents = `~/.ctrl/agents/<name>/`** (NEW v4). `rm -rf ~/.ctrl/agents/` fully uninstalls all 3 agents. Each agent has `manifest.json` written by `agent_installer.rs` recording version + install time + endpoint type.
12. **No CTRL-owned vault editor / index**. kairo owns notes editing + wiki-link + backlink + git. CTRL kernel only exposes `~/Documents/CTRL/Notes/` via MCP for hermes/opencode consumption. `notes_index.rs` is OPTIONAL (kept only as MCP-server convenience layer; kairo's own index is primary).

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
- [~] **Dual-brain supervisor (v3) — RETIRED in v4.** `opencode_supervisor.rs` / `hermes_supervisor.rs` / `brain_supervisor.rs` deletion in flight (this branch). Replaced by `agent_installer.rs` + `agent_launcher.rs` (no supervise).
- [~] **Vault stack lock (Tiptap + CodeMirror 6 + mermaid.js + FTS5) — RETIRED in v4.** Replaced by kairo external dependency. `notes_index.rs` (FTS5) kept as optional MCP convenience.
- [ ] **3-agent aggregator** — `agent_installer.rs` + `agent_launcher.rs` + 3 manifest files in `~/.ctrl/agents/{hermes,opencode,kairo}/manifest.json`. PWA 5-chip L1 (Irisy / Mcp pool / Notes / Coding / Assistant) wired to native endpoints. Pending verification this branch.
- [ ] **3-capability-face SSOT** — MCP face (already shipped) + API face (fal.ai adapter pending) + Skills face (`~/.ctrl/skills/<id>/SKILL.md` schema lift pending). Pending verification this branch.
- [ ] **fal.ai BYOK adapter** — `src-tauri/src/kernel/provider/adapter/api/fal_ai.rs` + provider-templates.json entry + `$imagegen` skill defaulting to FLUX 2 Pro. Pending this branch.
- [x] Lean kernel — wasmtime / cranelift / sandbox.rs / composition.rs removed. Verified.
- [x] Kernel-as-MCP-server @ :17873 (ADR-002 § mcp-bus). Verified.
- [x] Provider router shipped v0.1.126 (ADR-002 § provider v1). Verified 2026-05-31.

## Provenance

Original ADR-001 v1.x (2026-05-11 → 2026-05-30) — 4-layer architecture + 5 primitives + 5 sources + 6 校准 narrative. v3 (2026-06-09 morning, PR #84) shipped dual-brain supervisor model, **retracted same day** by v4 after bao framing校准. Full校准 history preserved in git log; this v4 keeps the load-bearing decisions only.
