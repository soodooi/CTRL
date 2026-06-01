---
adr_id: 003
title: Brain — Pi is the sole core agent loop (with upgrade + extension shim)
status: proposed
date: 2026-05-30
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md          # 6th 校准 Pi-centric reframe
  - .olym/decisions/004-kernel-capability-surface.md    # §9.1 Provider sub-system (Pi consumes)
  - .olym/decisions/018-auto-update-strategy.md         # Pi 接替原 hermes 第 5 层升级位置
scope: framework
module: substrate
supersedes:
  - .olym/decisions/003-multi-device-mesh.md            # repurposed; mesh content moved to ADR-004 §9.2
superseded_by: []
---

> **Domain ADR**: per bao 2026-05-30 领域编号 convention (001 架构 / 002 前端 / 003 brain / 004 kernel). This file repurposes the previous ADR-003 slot (mesh) — original mesh content is preserved in ADR-004 §9.2 (Mesh sub-system).

## Context

CTRL has reached a fork: the runtime currently has **two competing brain implementations** running side-by-side:

1. **Pi** (`@mariozechner/pi-coding-agent`) — Node subprocess started by `shell/brain_supervisor.rs`. Has proper agent loop, tool dispatch, session, OAuth subscription support (Claude Pro/Max + ChatGPT Plus + GitHub Copilot built-in). Currently broken at runtime (Pi's own `~/.pi/config` is empty + Pi has no path back into kernel for LLM, so `text.chat` MCP call hangs forever).
2. **PWA frontend ReAct** (`packages/ctrl-web/src/lib/irisy-tools.ts` + `irisy-llm-runner.ts`) — temporary in-browser agent loop that parses `<call>` tags from LLM output, dispatches tools via Tauri `invoke`, feeds results back. The file's own comment admits: *"this is a prompt-based ReAct loop ... once OpenAI function-calling lands, this file's parser is replaced ... and the registry moves to Rust"*.

The brain registry (`kernel/brain_config.rs` + `commands/brain.rs`) treats `pi / claude_code / codex / gemini / volc` as **sibling brains**, which is the wrong abstraction — `claude_code`/`codex`/`gemini`/`volc` are **LLM providers** (see ADR-004 §9.1), not agent loops.

bao directive 2026-05-30 lifted Pi to first-class: **"一切以 Pi 为核心"** (everything centered on Pi). That collapses the brain registry to a singleton.

## Decision

**Pi is the sole brain. The brain layer is a singleton — Pi or nothing.**

### §1 Pi as core (architecture)

Pi sits at the center of the Pi-centric 5-block architecture (ADR-001 6th 校准):

```
ui-ux (PWA) ↔ kernel (Rust + sub-systems) ↔ Pi (core brain) ↔ provider (LLM) + keycap (tool)
```

Pi receives every user turn (via kernel forwarding from PWA), runs its own agent loop (LLM call → tool call → loop until stop), and streams results back. Pi is the **only** code path that decides "what to do next" with an LLM response.

### §2 Pi LLM source = kernel provider sub-system (ADR-004 §9.1)

Pi's LLM call must go through the kernel `provider/` sub-system (NOT Pi's own provider registry).

**Reason**: CTRL must control provider choice (active provider per capability, OAuth subscription routing, trial verify, manifest-driven preset) and Pi must not duplicate that logic.

**Mechanism**: thin TypeScript Pi extension at `packages/ctrl-pi-bridge/` (~30 LOC).

```ts
// packages/ctrl-pi-bridge/index.ts (skeleton — full impl per ADR-004 §9.1 lock #7)
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("ctrl-bridge", {
    api: "ctrl-bridge",
    models: [/* dynamic, fetched from kernel on init */],
    streamSimple: async (model, ctx, opts) => {
      // POST to localhost:<kernel-port>/text-chat, parse SSE chunks,
      // yield as Pi AssistantMessageEventStream events.
    },
  });
}
```

**Why this shape** (Round-2 research, see `.provider-research/FINDING-R2.md`):
- Pi has NO MCP-client surface in `pi-mono/coding-agent/src/` (`grep mcp` = 0 hits), so ADR-013 kernel-as-MCP-server path can't carry Pi's LLM call.
- Pi DOES expose `pi.registerProvider({ streamSimple })` extension API — Round-2 confirmed in `pi-mono/coding-agent/examples/extensions/custom-provider-anthropic/` reference impl.
- A thin shim is cleaner than reimplementing spawn-cli logic in Pi extension TS (DRY: one Rust impl in kernel/provider/, two consumers — Irisy via Tauri invoke, Pi via HTTP reverse-call).

**CTRL spawns Pi with `--extension <bundled-path>` so the bridge auto-loads.** User never runs `pi /login`, never edits `~/.pi/config`.

### §3 Pi install (location + first-run)

- **Install location**: `~/.ctrl/pi/` (per-user, not system-wide, no root needed). Same root convention as keycaps (`~/.ctrl/keycaps/`).
- **First-run install**: CTRL on startup checks `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/package.json`. If absent → run `npm install --prefix ~/.ctrl/pi @mariozechner/pi-coding-agent@latest` (lazy). If user's machine has no `npm` → download GitHub release tarball + extract.
- **Bundle bridge**: `packages/ctrl-pi-bridge/` ships in CTRL.app `Contents/Resources/pi-bridge/`. CTRL spawn-Pi command points `--extension` to that bundled path.

### §4 Pi auto-upgrade (priority-0)

Pi is the core. It cannot stay stale.

| Lock | Detail |
|---|---|
| **Probe** | Startup probes `npm registry` (or GitHub releases) for latest pi-coding-agent version, with 24 h cache. |
| **Background upgrade** | Newer version available → background `npm install --prefix ~/.ctrl/pi @mariozechner/pi-coding-agent@latest`. User's current chat is not interrupted; upgrade applies on next Pi process restart. |
| **Compatibility pin** | `packages/ctrl-pi-bridge/package.json` declares `peerDependencies: "@mariozechner/pi-coding-agent": "^<current-major>.x"`. If upstream releases a major bump (0.x → 1.x), CTRL **blocks** auto-upgrade and surfaces a UI banner "Pi major update — review pending"; the next CTRL release pins the new major. |
| **Failure rollback** | Upgrade failure (npm error, API drift, extension load fails on new version) → preserve the previous install + log + status-bar notice "Pi upgrade failed, still on v<old>". User can manually retry from Settings. |
| **Visibility** | Settings → Brain pane shows: current Pi version, latest known, last upgrade attempt, manual "upgrade now" button. |

This is `priority-0` because Pi is the core. Other components (provider preset add, vault add) can degrade; Pi staleness cannot.

### §5 Retirements (this ADR removes)

When this ADR ships, the following code is removed (not deprecated — bao 2026-05-28 "加替代必须同步退役旧实现, 禁并行"):

| Removed | Replacement |
|---|---|
| `src-tauri/src/kernel/brain_config.rs` (brain registry: pi / claude_code / codex / gemini / volc) | Sole brain = Pi (singleton, no registry). User-facing switcher in `Settings → Brain` is removed. User switches **provider** (ADR-004 §9.1) not brain. |
| `src-tauri/src/commands/brain.rs` (`brain_list` / `brain_detect` / `brain_set_active`) | Removed. PWA no longer calls these. Active-provider state lives in `kernel/provider/registry.rs`. |
| `packages/ctrl-web/src/lib/irisy-tools.ts` + `irisy-llm-runner.ts` (PWA frontend ReAct agent loop) | Pi agent loop takes over. PWA streams Pi's tool-call events directly (Pi already structures tool calls). |
| `packages/ctrl-web/src/components/Settings/BrainSwitcher.tsx` (or wherever brain switcher UI lives) | Removed. Settings → Brain shows only Pi status + version + upgrade controls. |
| `~/.ctrl/active-brain` file | Removed. Brain has no choice — always Pi. |

### §6 Capability surface for the brain layer

Pi is consumed by:
- **PWA Irisy chat** → forwards every user turn to Pi (via kernel command `irisy_chat_stream` → forward to Pi MCP @17874).
- **Keycaps that need agent reasoning** → invoke Pi via Pi's existing MCP server interface (Pi already exposes its own MCP server when spawned).

Pi consumes:
- **Kernel `provider/` sub-system** (ADR-004 §9.1) for LLM calls — via the thin bridge extension.
- **Kernel `mcp_server.rs`** for vault / kv / http capabilities (Pi as MCP client).
- **Kernel `mcp_host.rs`** indirectly: when Pi calls a keycap as a tool, the keycap is spawned via kernel mcp_host.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Keep PWA frontend ReAct + retire Pi | PWA agent loop is a temporary string-parser hack, no proper tool-call schema, no session, no OAuth subscription support. Reinventing what Pi already provides. |
| A2 | Multi-brain registry (Pi + custom Rust brain + future LangChain brain) | YAGNI. We have one brain in the codebase (Pi). Future multi-brain abstraction can be reopened when a second concrete brain is demanded. |
| A3 | Pi as a keycap (sibling to builtin-assist / builtin-create) | Considered (memory `decision_pi_is_sole_brain_hermes_is_keycap` mentioned framing). Rejected: Pi is not a tool — Pi *uses* tools. Keycap pattern means "tool the brain calls" (ADR-010); Pi is the brain itself. Promoting it to first-class architecture block (ADR-001 6th 校准) is the cleaner model. |
| A4 | Pi LLM via kernel-as-MCP-server (ADR-013) — Pi calls `text.chat` as MCP tool | Round-2 research: Pi has zero MCP-client code in `pi-mono/coding-agent/src/`. Pi's only LLM-call seam is `pi.registerProvider({ streamSimple })`. The thin extension wrapping that seam is the only realistic path. |

## Consequences

**Positive**:
- Singleton brain eliminates a whole class of "which brain is active?" UX bugs.
- Pi's existing agent loop + session management + OAuth subscription handling all leveraged — no reinvention.
- User never sees "Pi" name (memory `decision_one_persona_irisy`). User sees Irisy; Pi is the engine.
- Frees the PWA from owning agent-loop logic — PWA goes back to pure rendering.

**Negative / cost**:
- We're now bound to upstream Pi's extension API stability. Mitigated by `peerDependencies` pin + bridge re-test on every Pi version bump.
- Pi process lifecycle (spawn / health / restart) is a new ops responsibility. Already partially in `shell/brain_supervisor.rs` — needs hardening per §4 upgrade lock.
- Removing PWA frontend ReAct (§5) is a non-trivial cutover: PWA must stream Pi's tool-call events natively. Cutover plan: ship Pi bridge + kernel `/text-chat` endpoint + PWA Pi-stream renderer atomically; if any leg breaks, rollback whole.

**Reversal cost**: **medium**. The bridge + kernel `/text-chat` endpoint are isolated; if Pi proves unsuitable later, swap the bridge for a different brain implementation while keeping the contract. The hard cost is the retired PWA frontend ReAct — if we have to bring it back, it's a re-write.

## Acceptance

- [x] `packages/ctrl-pi-bridge/` ships with `pi.registerProvider({ streamSimple })` that HTTP-fetches `localhost:<port>/text-chat`. (Closed 2026-05-31 v0.1.123 — wrapper now uses Pi's official `RpcClient` per §2 skeleton; bridge emits `AssistantMessageEventStream` events.)
- [x] `kernel/provider/http_endpoint.rs` (new) exposes `/text-chat` SSE endpoint that wraps `ProviderRegistry::active(text.chat).chat_stream`. (Closed — port 17878 listening, verified in ctrl.log boot trace.)
- [x] `shell/brain_supervisor.rs` spawns Pi with `--extension <bundled-bridge-path>`; no user-facing `pi /login` ever required. (Closed — supervisor injects `CTRL_PI_BRIDGE_EXTENSION` env; wrapper forwards as `--extension` arg.)
- [x] `~/.ctrl/pi/` lazy-install on first run; auto-upgrade in background per §4; settings UI shows Pi version + manual upgrade button. (Closed 2026-05-31 v0.1.124 — auto-upgrade `env: node not found` bug fixed by PATH inject in `pi_install.rs`; `/settings/brain` now reads `pi_status` + `pi_upgrade_now`.)
- [x] Retirements in §5 land in a single atomic PR (no parallel old + new). (Closed 2026-05-31 v0.1.124 — `~/.ctrl/active-brain` removed; `SettingsBrainPage` rewritten to use `pi_status` only; `BrainListReply / BrainView` types deleted.)
- [x] `irisy_chat_stream` Tauri command routes every turn to Pi (no `active-brain` branch); error surfaces specific cause (Pi not started / Pi crashed / provider 0 token in 5 s) instead of infinite spinner. (Closed 2026-05-31 v0.1.124 — `brain_supervisor::trial_verify_pi()` polls `/healthz` post-spawn, sets specific `last_error`; `irisy_chat_stream` already reads `last_error` for fail-fast surface.)

## Changelog

| Date | Change |
|---|---|
| 2026-05-30 | Initial draft. Repurposes ADR-003 slot from mesh (moved to ADR-004 §9.2). bao directive: "一切以 Pi 为核心" + 领域 ADR convention. |
