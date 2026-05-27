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

- [ ] `.olym/specs/kernel/capability-surface.md` lands with full Zod schemas per `06-jiazuo-result.md` §Q2 (28 methods, input + output, error model).
- [ ] `packages/ctrl-kernel-sdk/` re-exports the 28 method signatures as TS types (one file per namespace, `index.ts` barrel).
- [ ] `src-tauri/src/kernel/capability.rs` registers exactly these namespaces; CI lint rejects unregistered method names at compile time.
- [ ] 16 starter builtin manifests pass `capability-lint` (each declares only methods on the surface; no ad-hoc names).
- [ ] CLAUDE.md "Stack" table gains a row pointing to the spec.
- [ ] `.olym/decisions/INDEX.md` reflects 004 active + the lane-B → lane-C trigger-text fix (one-line, no amendment cycle).

## Changelog

| Date | Change |
|---|---|
| 2026-05-22 | Initial draft from `06-jiazuo-result.md` TL;DR; status proposed (awaiting bao accept). |
