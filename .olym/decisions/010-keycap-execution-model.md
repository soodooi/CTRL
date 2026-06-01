---
adr_id: 010
title: Keycap execution model — MCP outward, Actor inward
status: accepted
date: 2026-05-17
deciders: [bao, zeus, hephaestus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/specs/tool-manifest/spec.md
  - .olym/specs/kernel/spec.md
  - doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md
scope: framework
module: cap
supersedes: []
superseded_by: []
---

## Context

ADR-001 §3.1 defined keycap = WASM sandboxed actor. But Anthropic MCP exploded Day-1 with 10K+ servers, and real third-party integrations (Quicker / Raycast plugins / Feishu OAuth / Coze / CLI wrappers / local daemons / ST-SS publishers) are not written as WASM. Two competing models coexisted ambiguously in the repo. Hephaestus mapped 7 keycap patterns × integration matrix in `doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md`; bao accepted option B on 2026-05-17.

## Decision

Keycap's outward protocol = **MCP** (Anthropic Model Context Protocol). Inward runtime = **Actor** (one of ADR-001's 5 primitives). **MCPServerActor** is a well-known Actor subclass wrapping an MCP server for kernel orchestration — no 6th primitive added. ADR-001 §4's 5 keycap sources (MCP / OAuth / Local agent / ST-SS / Builtin) stay valid as conceptual sources but **all express uniformly as MCP servers**, with implementation differences absorbed in MCPServerActor subclasses (SubprocessActor for Pattern B/C/D, OAuthCapability for Pattern E). v1 sandbox = OS-level (macOS sandbox-exec / Linux landlock+seccomp / Win AppContainer) with capability gates declared in manifest; missing capability → syscall block.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | WASM-only (original ADR-001 strict reading) | Cuts off 10K+ MCP ecosystem; creator barrier too high; out of step with Anthropic direction |
| A2 | Dual protocol (MCP for third-party + custom v0.1 schema for builtin) | 2 schemas to maintain long-term; Irisy / Claude must integrate case-by-case; violates single-protocol principle |
| A3 | Custom CTRL-only protocol (reinvent MCP-like) | Wheel reinvention + loses ecosystem |
| A4 | MCPServerActor as new 6th primitive | Inflates kernel surface unnecessarily; subclass sufficient |

## Consequences

**Positive**:
- Day-1 compatibility with Anthropic MCP ecosystem (10K+ servers)
- Irisy / Claude / any MCP host invokes keycaps with no integration code
- Creators write MCP once, runs everywhere (Claude Code / CTRL / any MCP host)
- 7 patterns unify at protocol layer
- ADR-001 spine preserved (Actor primitive still load-bearing)

**Negative / cost**:
- Existing 16 v0.1 starter manifests must wrap as a single "CTRL Builtin MCP Server"
- `packages/ctrl-tool-integration` two schemas converge to MCP (legacy zod schema demoted to builtin internal)
- WASM demoted from default to optional high-security actor impl
- Third-party MCP server sandboxing requires OS-level enforcement (sandbox-exec / landlock+seccomp / AppContainer) — non-trivial deployment

**Reversal cost**:
- Expensive — ~3 weeks. Need to rewrite MCPServerActor → alternative dispatcher, re-author all keycap manifests in alternative protocol, lose third-party MCP ecosystem. MCP is OASIS-candidate + LinuxFoundation/AAIF standardization track — risk of needing reversal is low.

## Acceptance

- [x] `MCPServerActor` as `Actor` subclass in `src-tauri/src/actors/mcp_server_actor.rs`
- [x] `SubprocessActor` in `src-tauri/src/actors/subprocess_actor.rs`
- [x] `OAuthCapability(provider, scopes)` placeholder in `kernel::capability` known table
- [x] Keycap execution model (MCP outward / Actor inward) recorded; v1 keycap rewrite scope tracked under ADR-024 substrate composition (which bao deferred to "实施时决"). v1 ships current `ctrl-keycaps/builtin` shape — rewrite happens when bao calls execution. Closed 2026-05-31 (bao "全量开发" sweep).
- [x] Per CLAUDE.md 灵活开发 + memory `feedback_no_planning_no_phasing`: `.olym/specs/tool-manifest/spec.md` promotion deferred (spec 暂搁). Manifest shape lives in code + ADR; no standalone spec required in v1. Closed.

## Future work (depends on ADR-024 substrate composition activation)

- 16 v0.1 starters rewritten as single `ctrl-builtin` MCP server (stdio JSON-RPC to kernel)
- `packages/ctrl-tool-integration` two schemas converged to MCP-only
- 7 patterns each have ≥ 1 reference implementation
- OS sandbox profile shipped: macOS sandbox-exec → Windows AppContainer → Linux landlock+seccomp

## Changelog

| Date | Change |
|---|---|
| 2026-05-17 | Initial accept (bao "走 B") — based on Hephaestus 7-pattern research |
| 2026-05-17 | §5.4 sandbox.profile derivation table added (moved to `.olym/specs/tool-manifest/spec.md` in 0.3.1 rewrite) |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format; sub-decisions on OAuth / SubprocessActor / sandbox derivation moved into spec |
