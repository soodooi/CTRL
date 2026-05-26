---
id: H-2026-05-25-001
title: Pi as default brain keycap (reframe — brain is keycap, not kernel)
severity: P0
status: in_progress
reporter: zeus
assigned_to: keycap
lane: keycap
touches:
  - packages/ctrl-pi-plugin/**
  - packages/ctrl-keycap-sdk/src/manifest-schema.ts
  - .olym/specs/tool-manifest/spec.md
  - src-tauri/src/kernel/**            # zeus scope — brain router
  - src-tauri/src/commands/irisy.rs    # zeus scope — brain routing wire-up
  - packages/ctrl-web/**               # daedalus scope — Irisy install-Pi toast + provider hint
related:
  - H-2026-05-23-001-irisy-hermes-cli-eval   # SUPERSEDED by this handoff
  - H-2026-05-23-002-irisy-logseq-lazy-integration
project_id: pi-default-brain
category: feature
created: 2026-05-25
updated: 2026-05-25
---

## bao approval

> **bao verbal-go (2026-05-25):** "干"
>
> Context — bao approved this pivot after a 6-point real apology + the
> recommendation to switch from hermes-primary to Pi-default. The
> "干" lands the whole reframe: brain is a keycap, Pi is the default,
> hermes drops to optional.

Verbatim reference kept for cross-session continuity (跨 session 强约束
per CLAUDE.md). Approval scope:

1. **Pi becomes CTRL's default brain** (replaces the prior hermes-primary
   path locked under ADR-019 / H-2026-05-23-001).
2. **Brain is reframed as a keycap target**, not a kernel primitive. The
   real kernel primitive remains the provider abstraction (`text.chat`,
   `text.embed`, `image.generate`, …) — ADR-001 stays correct, ADR-019
   was a layering error.
3. **hermes is not deleted** — it stays in-tree as an optional brain
   keycap for users who want persistent memory + auto-skill-generation.
   It loses its default-brain status only.
4. **agentskills.io (Anthropic 2025-12 SKILL.md format) is the shared
   skill substrate**, not a hermes-private channel. Pi consumes the
   same format; CTRL is neutral about brain choice.

---

## 现象 (the problem being fixed)

H-2026-05-23-001 locked hermes as primary brain under the assumption
that hermes' `agentskills.io` integration was its differentiator. Real
research (this session) revealed:

- **agentskills.io is an open Anthropic standard published 2025-12.**
  Pi appears in the official client list (instructions URL: pi-mono
  /packages/coding-agent/docs/skills.md). Skills marketplaces (Skills.sh
  ~90k skills, SkillsMP ~66k, agentskill.sh ~44k, ClawHub ~13k) are
  consumable by *any* SKILL.md client, not hermes-only.
- **hermes' true differentiators (persistent memory layer + auto-skill-
  generation) actively conflict with CTRL's Obsidian philosophy** (vault
  is the single source of truth; the brain must not write a second
  memory store; the user — not the brain — owns skill creation).
- **Pi is minimal in a way that matches CTRL's 5-primitive kernel ethos:**
  4 builtin tools (read / write / edit / bash), sub-1000-token system
  prompt, ~MIT, ports cleanly to TS + Rust, no opinion about memory.

Treating brain as a kernel primitive (the ADR-019 mistake) meant the
kernel grew an opinion about *which* runtime answered `text.chat`. The
correct layering — confirmed by bao 2026-05-25 — is:

```
kernel  →  exposes capability primitives (text.chat, image.generate, …)
keycap  →  one keycap per capability claims `target: brain` + binds a runtime
runtime →  Pi (default) / hermes (optional) / claude-shim (dev) — peers
```

## 证据

- `decision_keycap_target_dispatch` memory entry (2026-05-22) — bao had
  already framed keycap target as the dispatch axis; brain-as-target is
  the natural extension.
- `decision_ctrl_obsidian_philosophy` memory entry — vault as single
  source of truth; hermes' persistent memory is a second source.
- `agentskills.io` public client list (Anthropic standard, 2025-12) —
  Pi is a first-class client.
- `feedback_no_planning_no_phasing` memory entry — this handoff is
  intentionally one ship, no v1/v1.1 split.

## 建议 (scope split across three lanes)

### keycap lane (hephaestus) — THIS HANDOFF

1. **`packages/ctrl-pi-plugin/`** new package.
   - `pi-detect.ts` — locate `pi` binary (env → PATH → `~/.local/bin` → `npx`).
   - `pi-bridge.ts` — translate `text.chat` → `pi rpc` (preferred, long-running NDJSON) or `pi -q --json` (fallback). Stream tokens.
   - `mcp-server.ts` — minimal streamable-HTTP MCP server on 127.0.0.1:17874 (17872 = ST-SS, 17873 = kernel MCP). One tool: `text.chat`. Bearer-token auth.
   - `bin/ctrl-pi-mcp.ts` — CLI entrypoint, prints ready JSON on stdout for kernel supervisor.
   - `keycap.md` — manifest template with `target: brain`, `capability: text.chat`, `bridge: '@ctrl/pi-plugin'`, `provider_passthrough: true`.
   - `THIRD_PARTY_LICENSES.md` — Pi MIT attribution.
   - `README.md` — install + smoke-test guide.
2. **`packages/ctrl-keycap-sdk/src/manifest-schema.ts`** — add `KeycapTarget` enum + top-level `target` / `capability` / `bridge` / `provider_passthrough` fields.
3. **`.olym/specs/tool-manifest/spec.md`** — add §13 "Target — pluggable role" documenting `target: brain`.
4. **Cleanup** — delete `packages/ctrl-web/pnpm-workspace.yaml` + `pnpm-lock.yaml` (CTRL is npm workspaces; these are prior intrusion). Separate `chore(stack):` commit.

### kernel lane (zeus) — separate dispatch

5. **Kernel brain router** — read `~/.ctrl/active-brain` (or first-installed brain keycap as default), spawn the bridge package, route inbound `text.chat` capability requests to it.
6. **`src-tauri/src/commands/irisy.rs`** — replace the prior hermes-primary call path with `brain_call(capability, args)` that dispatches through the router. No more hard-coded brain runtime.
7. **Active-brain config** — `~/.ctrl/active-brain` is a single-line file
   containing the keycap id (e.g. `pi`). Kernel watches it; reload on change.

### PWA lane (daedalus) — separate dispatch

8. **Irisy install-Pi toast** — when MCP server returns error code
   `-32004` (PiNotFoundError), render a one-tap "Install Pi" toast that
   runs `npx pi --help` to warm the npm cache, then retries.
9. **About → Acknowledgements** — add "Powered by Pi Agent (MIT) —
   github.com/badlogic/pi-mono" line (MIT compliance).

### Out-of-scope this handoff

- ❌ ctrl-hermes-plugin metadata/README change — that lives on `main`,
  not on `keycap-dev`. Will be handled in a follow-up handoff once
  `keycap-dev` rebases (or in `main` directly when this PR lands and
  hephaestus' next session picks it up). bao approved the metadata
  change concept; the file edits are deferred.
- ❌ Removing or breaking ADR-019. Mark superseded once `main` catches
  up; no immediate text-change required to ship this handoff.

## Supersedes

This handoff **supersedes** `H-2026-05-23-001-irisy-hermes-cli-eval`
(which locked hermes-primary brain). That handoff lives on `main`;
when this branch merges, set its `status: superseded` and add:

> Superseded by H-2026-05-25-001 — bao approved Pi as default brain on
> 2026-05-25 (data: agentskills.io is open Anthropic standard, not
> hermes-exclusive; hermes' persistent memory layer conflicts with
> CTRL vault philosophy).

## 验收清单

- [x] `packages/ctrl-pi-plugin/` scaffolded (package.json, tsconfig, src/, bin/, keycap.md, README, THIRD_PARTY_LICENSES).
- [x] `pi-detect.ts` covers env / PATH / `~/.local/bin` / `npx` fallback with structured `PiNotFoundError`.
- [x] `pi-bridge.ts` supports RPC mode + print mode fallback, streams tokens.
- [x] `mcp-server.ts` exposes `text.chat` via JSON-RPC + SSE; Bearer-token auth; `/healthz` reports bridge transport.
- [x] Manifest schema gains `target` / `capability` / `bridge` / `provider_passthrough` fields.
- [x] `.olym/specs/tool-manifest/spec.md` §13 documents `target: brain`.
- [x] Cleanup commit deletes `packages/ctrl-web/pnpm-workspace.yaml` + `pnpm-lock.yaml`.
- [ ] zeus picks up kernel router scope.
- [ ] daedalus picks up Irisy install-Pi toast scope.
- [ ] First end-to-end smoke: `pi` installed via npx → start MCP server → curl tools/call → assistant tokens stream back.

## 讨论 / 备注

Handoff frontmatter `status: in_progress` — keycap lane is mid-ship as
of 2026-05-25 evening. Zeus + daedalus scope still open.

bao directive on documentation depth (CLAUDE.md, today): "灵活开发，
文档后补". This handoff + the package README + spec §13 is the full
written record — no separate ADR, no per-step plan. Future ADR (if any)
to be opened when zeus brain-router design stabilises.
