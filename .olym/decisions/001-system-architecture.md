---
adr_id: 001
title: Adopt 4-layer AI-native Agent OS kernel architecture
status: accepted
date: 2026-05-11
deciders: [bao, zeus]
related:
  - .olym/decisions/002-pwa-pivot.md
  - .olym/decisions/003-multi-device-mesh.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/steering/ctrl-strategy.md
scope: framework
supersedes: []
superseded_by: []
---

## Context

Solo founder building "ambient AI desktop entry" for CN OPC market. CTRL must host 10K+ MCP servers + creator-authored keycaps + hardware adapters without each becoming a custom integration. Existing precedents (Raycast, Coze, 豆包) either lack a creator economy, lack the protocol layer for 10K+ tool ecosystem, or aren't shippable into CN. Need an architectural frame that absorbs the variety at solo-team scale.

## Decision

Adopt a 4-layer kernel architecture with **5 primitives** (Actor / Capability / Channel / Event / Effect). Desktop runs a Rust microkernel (L1) under a thin Tauri 2 shell (L0); userland keycaps run as sandboxed actors (L3) consuming the kernel via L2 SDK. **5 keycap sources** integrate everything: MCP servers / Big-platform OAuth / Local agents / ST-SS shared windows / Built-in. Default LLM = CF Workers AI + Doubao; BYOK for Claude / GPT-4 / local Ollama (Pattern D).

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Raycast clone (curated tool launcher) | No moat — Raycast already won English creator market; doesn't capture creator economy; can't host 10K+ MCP servers |
| A2 | Single-purpose AI chat (豆包-style consumer app) | No protocol layer; can't sell to creators; loses to ByteDance distribution power |
| A3 | Workflow editor (Coze / n8n) | Coze owns that segment; visual graph editing wrong abstraction for OS entry (user thinks "Ctrl + 1 key" not "drag nodes") |
| A4 | Pure WASM sandboxed plugin model (original ADR draft) | Forces every keycap to WASM-compile; cuts off MCP ecosystem; creator barrier too high. Later resolved by 010. |

## Consequences

**Positive**:
- Protocol-shaped scaling (new integrations = +1 source under existing contract, not custom code)
- Creator economy enabled (manifest = declarative API)
- Hardware-ready (ST-SS source class anchors future hardware adapters)
- Architectural ceiling absorbs CTRL's stated ambition without later structural redesign

**Negative / cost**:
- ~6 months upfront kernel work before user-facing value
- Every keycap creator must understand actor model + capability declaration to author
- Solo founder must steward 5 primitives' integrity through every subsequent decision

**Reversal cost**:
- One-way door. This is the spine — every subsequent ADR + every line of `src-tauri/src/kernel/` references the 5 primitives + 5 sources. Reversing would discard ~10K LOC Rust kernel + every manifest contract + every SDK package. Not reversible after v1 ship.

## Acceptance

- [x] 5 primitive Rust modules exist under `src-tauri/src/kernel/{actor,capability,channel,event,effect}.rs`
- [x] 5 keycap source types documented in `.olym/steering/ctrl-strategy.md`
- [x] LLM Pattern D wired (CF Workers AI subscription + BYOK + local Ollama) in `adapters/outbound/llm/`
- [x] Repo topology lock: single deliverable repo (`soodooi/CTRL`) + `ctrl-cloud` separate
- [x] Anti-list documented (CTRL is NOT: Raycast clone / workflow editor / consumer chat / ChatGPT GPTs adapter / shared mamamiya tenant)
- [x] Related: ADR-002 supersedes §3.1 rendering; ADR-003 supersedes §6 #18; ADR-010 resolves WASM-only plugin question (all three accepted as of 2026-05-17)
- [x] *(amendment 2026-05-22)* ADR-013 lands kernel-as-MCP-server: kernel exposes its capability surface on `127.0.0.1:17873` so the same wire serves PWA-mode + hermes-agent + external agents (Claude Code / Cursor). Kernel = AI agent integration hub at the protocol level, not just framing
- [x] *(amendment 2026-05-22)* 5-part body mapping locked: hermes = brain (Python subprocess, lazy install); CTRL provides hands (keycap = MCP server), feet (OS capability via Tauri), eyes (workspace cell stream), mouth (Irisy), workbench (PWA 2-zone — see ADR-002 amendment). Memory: `decision_ctrl_is_hermes_workbench`
- [x] *(amendment 2026-05-22)* Obsidian philosophy locked as cross-cutting constraint (ADR-015): local = truth, cloud = mirror; vim-readable markdown + YAML/JSON frontmatter; no user accounts; no proprietary binary formats;端侧化 OAuth/LLM/RAG/sync. Applies to every new capability — vim test = design gate

## Amendment 2026-05-22 — hermes-as-brain framing + protocol consolidation

This session 钉死 CTRL 的最终定位:

**CTRL = hermes 长出来的手脚 + 工作台**, NOT a hermes wrapper / NOT a chat shell:

- **Brain**: hermes-agent (NousResearch, MIT, lazy `pip install hermes-agent`). CTRL ships none of hermes' reasoning code; CTRL provides the body.
- **Hands**: keycap = MCP server (ADR-010 amendment locks `target: "mcp-tool"` default + `"hermes-skill"` exception). Tools surface through ADR-013 kernel MCP wire.
- **Feet**: OS capability (clipboard / window / hotkey / file system) via Tauri commands; kernel MCP server exposes the subset agents are allowed to drive.
- **Eyes**: Workspace cell stream (ST-SS bridge @ 17872 + future workspace observability) — hermes sees what user is doing in real-time.
- **Mouth**: Irisy persona — PWA-native first-class page (auxiliary, drawer/bubble) + 8-stage lifecycle companion (ADR-016).
- **Workbench**: PWA 2-zone (Keyboard 12-grid + Workspace multi-tab + Irisy drawer) — ADR-002 amendment locks layout.

Protocol layer consolidates:

- **MCP** = outward to AI agents (hermes / Claude Code / Cursor / 外部) — both keycap → kernel and kernel → external (mcp_host as client + mcp_server as server, ADR-013)
- **ST-SS** = workspace cell stream (CBOR/WebSocket, 17872) — kernel ↔ PWA, kernel ↔ hardware adapters
- **Tauri invoke** = in-process PWA → kernel commands (desktop path)
- **WebRTC + Olm** = cross-device (mesh, ADR-003)

Anti-list expanded (CTRL is NOT):

- chat app — `/` route is workspace tab model, not Irisy chat page (ADR-002 amendment)
- a knowledge intermediary — data is the user's, stored as vim-readable markdown (ADR-015 Obsidian philosophy)
- VPS / multi-tenant SaaS — `ctrl-cloud` is augmentation (billing / market / relay only), not dependency
- a hermes fork — CTRL does NOT modify hermes source code; integrate via `hermes mcp add` + `hermes chat -q` + Hermes skill convention only (MIT compliance)

Strategic positioning (ADR-014 locks formally):

- **CTRL = global English first** (not 中文 OPC). UX/UI/marketing/keycap priority by global creator+agent ecosystem; Chinese is i18n adaptation. Priority order: hermes ecosystem skills / global MCP marketplace / agentskills.io > 飞书 / Notion / Coze CN connectors.

## Changelog

| Date | Change |
|---|---|
| 2026-05-11 | Initial accept (bao) — frame lock for CTRL v1 scope |
| 2026-05-13 | ADR-002 supersedes UI/rendering portion (§3.1) |
| 2026-05-14 | ADR-003 supersedes cross-device sync portion (§6 #18) |
| 2026-05-17 | ADR-010 resolves WASM-vs-MCP plugin model question; spine remains |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format (Context/Decision/Alternatives/Consequences/Acceptance/Changelog) |
| 2026-05-18 | Clarification (no policy change): line 23 "Default LLM = CF Workers AI + Doubao" 实际含义 = 默认订阅 = CF Workers AI (Qwen/Llama bundled); "Doubao" 字眼指 Volc-provided model, 通过 BYOK 或后续 kernel capability 接入, 非 CF 订阅默认含. ADR-005 (proposed) 进一步限定 BYOK Claude 仅 user action, 不是默认路径. ADR-001 Decision 段保持 immutable. |
| 2026-05-22 | Amend: hermes-as-brain framing (5-part body mapping); ADR-013 kernel-as-MCP-server lands as protocol consolidation; ADR-015 Obsidian philosophy as cross-cutting constraint; ADR-014 global-English-first positioning. Decision body remains immutable; amendments capture the new framing without restructuring the spine. |
