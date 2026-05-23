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
supersedes: []
superseded_by: []
---

## Context

ADR-001 §3.1 defined keycap = WASM sandboxed actor. But Anthropic MCP exploded Day-1 with 10K+ servers, and real third-party integrations (Quicker / Raycast plugins / Feishu OAuth / Coze / CLI wrappers / local daemons / ST-SS publishers) are not written as WASM. Two competing models coexisted ambiguously in the repo. Hephaestus mapped 7 keycap patterns × integration matrix in `doc/keycap-integration-research/00-adr-010-inputs-from-hephaestus.md`; bao accepted option B on 2026-05-17.

## Decision

Keycap's outward protocol = **MCP** (Anthropic Model Context Protocol). Inward runtime = **Actor** (one of ADR-001's 5 primitives). **MCPServerActor** is a well-known Actor subclass wrapping an MCP server for kernel orchestration — no 6th primitive added. ADR-001 §4's 5 keycap sources (MCP / OAuth / Local agent / ST-SS / Builtin) stay valid as conceptual sources but **all express as MCP servers by default** (`target: "mcp-tool"`, ≥90% of keycaps), with implementation differences absorbed in MCPServerActor subclasses (SubprocessActor for Pattern B/C/D, OAuthCapability for Pattern E). v1 sandbox = OS-level (macOS sandbox-exec / Linux landlock+seccomp / Win AppContainer) with capability gates declared in manifest; missing capability → syscall block.

**Exception (amendment 2026-05-22)**: a minority of keycaps (knowledge-dense / complex reasoning) declare `target: "hermes-skill"` and ship as Hermes Agent skills (SKILL.md + assets to `~/.hermes/skills/<id>/`) instead of as MCP servers. Manifest schema v0.3 introduces the `target` field; details below in `## Amendment 2026-05-22`.

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
- [ ] 16 v0.1 starters rewritten as single `ctrl-builtin` MCP server (stdio JSON-RPC to kernel)
- [ ] `packages/ctrl-tool-integration` two schemas converged to MCP-only
- [ ] 7 patterns each have ≥ 1 reference implementation
- [ ] OS sandbox profile shipped: macOS sandbox-exec → Windows AppContainer → Linux landlock+seccomp
- [ ] Manifest schema v0.2 promoted from `doc/keycap-integration-research/05-manifest-schema-v0.2.md` to `.olym/specs/tool-manifest/spec.md`

## Amendment 2026-05-22 — `target` field + hermes-skill exception

bao 2026-05-22 钉死 (memory `decision_irisy_architecture` + `decision_keycap_is_mcp_server_only`):

**Keycap manifest gains `target: "mcp-tool" | "hermes-skill"`** declaring how the keycap is loaded:

| `target` | Loader | When |
|---|---|---|
| `"mcp-tool"` (default, ≥90%) | kernel installs as MCP server (rmcp `mcp_host` connects) | Discrete callable tools (write a tweet / OCR clipboard / open vault entry / etc.) |
| `"hermes-skill"` | Generator writes `SKILL.md` + assets to `~/.hermes/skills/<id>/`; Hermes Agent picks up on next session | Knowledge-dense workflows where Hermes' skill convention (SKILL.md prompt + linked assets) beats raw MCP tool calls (e.g. style-guide-aware writing, multi-step research playbooks) |

Why this exception (vs ADR-010 original "all express uniformly as MCP servers"):

- MCP 3 primitives (tools + resources + prompts) cover most cases, BUT Hermes' SKILL.md convention bundles `instructions + assets + tool list` in a way that the agent loads pre-prompt; MCP's `prompts` primitive is per-call, not pre-loaded
- Knowledge-dense keycaps (research playbooks, style-guide writers) benefit from skills' pre-loaded context; the agent doesn't need to be re-instructed each invocation
- Forcing all keycaps to be MCP servers loses Hermes' skill ecosystem (agentskills.io 已有 hundreds)
- Reverse direction also holds — independent hermes-skill installs (not from a CTRL keycap) coexist; CTRL doesn't own the skill namespace

Rules:
1. `target` is author-declared in manifest; users don't pick at install time
2. `target: "hermes-skill"` keycaps still register a manifest entry in CTRL (for discovery / 3-tier adjustment / auto-update / 8-stage lifecycle); the SKILL.md is the **runtime artifact**, the manifest is the **packaging metadata**
3. ADR-013 kernel MCP server still exposes `mcp.list_servers` / `mcp.proxy_call_tool` — Hermes calls keycap tools via the kernel's MCP wire regardless of `target` (mcp-tool keycaps directly; hermes-skill keycaps surface their tools through Hermes' own MCP forwarder when needed)
4. `target` ≠ runtime; both targets still consume kernel capabilities (vault / kv / llm) through the same MCP wire

Auto-update implications (see new ADR for full spec):
- `target=mcp-tool` Config tier: clean overwrite from upstream
- `target=mcp-tool` Patch tier: 3-way merge with Irisy assist when conflict
- `target=hermes-skill` Fork tier: SKILL.md forks too; Irisy prompts cherry-pick upstream changes
- `target=mcp-tool` Config tier: SKILL.md absent, no skill sync required

Manifest schema v0.3 details land in `.olym/specs/tool-manifest/spec.md` follow-up; this ADR locks the field name, the exception case, and the loader split.

## Changelog

| Date | Change |
|---|---|
| 2026-05-17 | Initial accept (bao "走 B") — based on Hephaestus 7-pattern research |
| 2026-05-17 | §5.4 sandbox.profile derivation table added (moved to `.olym/specs/tool-manifest/spec.md` in 0.3.1 rewrite) |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format; sub-decisions on OAuth / SubprocessActor / sandbox derivation moved into spec |
| 2026-05-22 | Amend: `target: "mcp-tool" \| "hermes-skill"` manifest field; "all uniformly MCP" relaxed to "MCP by default, hermes-skill exception for knowledge-dense keycaps"; reference ADR-013 kernel MCP wire + new ADR-018 auto-update tiers |
