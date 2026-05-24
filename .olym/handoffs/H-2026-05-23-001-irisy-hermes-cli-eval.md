---
id: H-2026-05-23-001
title: Irisy 接入 hermes CLI — 方案评估 + ship
severity: P0
status: open
reporter: bao + zeus (dispatched)
assigned_to: hephaestus
lane: keycap-dev (hephaestus owns Irisy per `decision_irisy_to_hephaestus`)
touches:
  - .olym/specs/irisy/spec.md                 # owner = hephaestus
  - packages/ctrl-hermes-plugin/**            # already shipped (ADR-019)
  - src-tauri/src/commands/irisy.rs           # zeus shipped install_irisy / system_check
  - packages/ctrl-web/src/routes/default.tsx  # daedalus lane; current handleSend wrongly bypasses hermes
  - doc/irisy-local-install.md                # zeus draft, hephaestus updates
related:
  - .olym/decisions/016-irisy-eight-stage-lifecycle.md
  - .olym/decisions/019-ctrl-hermes-plugin-primary.md
  - decision_irisy_to_hephaestus.md (memory, 2026-05-22)
  - decision_irisy_architecture.md (memory)
project_id: ctrl-v1-ship
category: feature
created: 2026-05-23
updated: 2026-05-23
---

## bao directive (verbatim 2026-05-23)

- "你不要一次又一次得跟之前一样做 ctrl 打开关闭窗口的功能 ... 很简单 按一下 要么打开 要么关闭"
- "先把升级这个事搞定 ... 你告诉我升级到最新版就行了 ... 全网调研一下最佳升级的实践"
- "Hermes 不是先连 Minimax 吗？给你 token 了"
- "接入你是不是可以用用户的 cli？这块让 Irisy 负责人来评估下 给个方案"
- "或者前端你让 lane-A 做？你专心做架构 底座等？"
- "先给个升级版本升级一下，你负责后端 开前端和 cap 两个 lane 共同开发"

## Why this is dispatched to hephaestus

Per `decision_irisy_to_hephaestus` (2026-05-22, bao verbal-go): **Irisy ownership transferred from Athena to Hephaestus**. Rationale: "Irisy 跟 keycap 紧密绑定 (创建/调用/推荐), 一脑同管." Athena no longer owns Irisy persona / recommendation / integration design; Daedalus implements UI but Hephaestus designs the integration behavior.

zeus has been incorrectly implementing Irisy code this session (touched `default.tsx handleSend`, wrote `doc/irisy-local-install.md`, was about to wire `hermes auth add minimax`). All three are out of zeus lane. This handoff transfers the work back to its rightful owner.

## Scope of evaluation hephaestus must produce

A single decision document at `.olym/specs/irisy/spec.md` (or a refactor of the existing draft, currently 600+ lines at v0.1 — pending hephaestus's 2026-05-22 spec v0.2 work). The document must answer:

### 1. How does Irisy invoke hermes? Pick ONE primary path.

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| A | Spawn `hermes chat -q "{text}" -Q` as a `SubprocessActor` (ADR-012) per user message | Simple; user's existing hermes config + provider login are reused as-is | Cold-start latency per message (hermes boots fresh each time); no streaming during reasoning |
| B | Run `hermes mcp serve` as a long-running daemon; kernel uses `mcp_host` (existing ADR-013 client) to call Hermes as an MCP server | Stream-friendly; persistent session; tools/list discovery | Daemon lifecycle; user's hermes config still drives it but startup ceremony is ours |
| C | Spawn `hermes -z "{text}"` with `--dev` for line-by-line stdout | Mid-complexity; gets streaming via stdout | Output format brittle across hermes versions |

bao directive: **reuse user's existing CLI**. All three options do; pick by latency / streaming trade-off. zeus recommendation = B (long-running daemon, stream-friendly) but **hephaestus owns final call**.

### 2. Provider configuration — DO NOT auto-configure

bao explicitly rejected zeus auto-running `hermes auth add minimax` (2026-05-23). Irisy must use the provider hermes is already configured for. If hermes has no provider, the cockpit surfaces a clear "Configure your AI provider — run `hermes login <provider>` in terminal" with a copy-pasteable command. **No silent auto-provisioning.**

(zeus did already run `hermes auth add minimax ...` on bao's machine before realizing this was out-of-scope. The credential is in hermes auth list as "minimax #1" — hephaestus decides whether to keep, remove, or leave alone in their evaluation.)

### 3. Minimax workability inside hermes

`hermes auth status minimax` accepts the provider id but hermes' built-in provider registry (`hermes login --provider {nous,openai-codex,xai-oauth}`) does NOT include Minimax. Three sub-questions for hephaestus:

- (a) Does `hermes chat -q ... --provider minimax` actually round-trip to api.minimax.chat? Or does hermes' OpenAI-compat fallback kick in?
- (b) If hermes can't natively route to Minimax, what's the bridge — proxy via `hermes proxy`? Custom hermes provider plugin (`hermes plugins install`)? Tell user to BYOK via a different hermes-recognized provider?
- (c) Document the answer in `.olym/specs/irisy/spec.md`; the cockpit Irisy install pane (Daedalus lane) will surface the recommended provider setup based on this.

### 4. Streaming UX contract

Define the wire format between `irisy_send` Tauri command and PWA. Zeus's prior wire (`chat_stream` event channel with `chat.stream.delta` payloads) was for direct-LLM passthrough, NOT Irisy. Irisy stream events should carry hermes-specific shapes — tool call started, tool call result, assistant text delta, run complete. See ADR-016 §3.4 (lifecycle stages observable from the stream).

### 5. 8-stage lifecycle wire points

Per ADR-016, Irisy is a companion across Discovery / Creation / Config / Invoke / Collab / Debug / Improvement / Retire. Spec must say which stages trigger what hermes invocations and what kernel events they emit. (Today only Invoke is partially wired through `chat_stream`; the others are spec-only.)

## Inputs hephaestus has

- `doc/irisy-local-install.md` — zeus's draft of the 7-ingredient install list. Probably wrong in places; hephaestus rewrites or replaces.
- `packages/ctrl-hermes-plugin/` — Python plugin, 11 tool shims to kernel MCP server (already shipped). hephaestus tests + iterates.
- `doc/hermes-spike/RESULT.md` — zeus's spike that proved spec v0.1 §3.3 / §3.4 wrong (hermes has no `/v1/runs/$id/events` endpoint; integration is via plugin + MCP, not custom SSE).
- Memory `decision_irisy_architecture` (2026-05-22 final): Irisy = hermes-agent runtime + skill knowledge + MCP tool library 三层综合体, NOT a standalone chat shell.
- Memory `decision_keycap_is_mcp_server_only`: keycap = MCP server (tools+resources+prompts); manifest `target: "mcp-tool" | "hermes-skill"` field already in v0.3 schema spec.
- Minimax API key in macOS Keychain as `MINIMAX_API_KEY` (125 chars, suffix `...v5-4kvoE`). bao already provided this 2026-05-16.

## Acceptance for this handoff

- [ ] `.olym/specs/irisy/spec.md` updated to v0.3 with sections 1–5 answered concretely
- [ ] `doc/irisy-local-install.md` updated or superseded with hephaestus's authoritative install flow
- [ ] One follow-up handoff dispatched per:
   - zeus lane: kernel Tauri command(s) needed (`irisy_send` signature, event channel names, subprocess vs MCP transport)
   - daedalus lane: PWA wire details (handleSend new signature, stream event listener, provider-missing prompt UI)
- [ ] If hermes provider routing for Minimax fails, alternative provider path documented; bao confirms which to use
- [ ] zeus + daedalus signed off on hermes-plugin-integration design before any of them ship code touching Irisy chat path

## Non-goals (explicitly OUT of this handoff)

- Don't redesign keycap manifest schema (v0.3 already shipped by zeus)
- Don't touch kernel MCP server (ADR-013 stable)
- Don't touch ctrl-hermes-plugin Python code unless functional bug found
- Don't ship Apple Developer Program signing pipeline (separate lane)
- Don't ship `chat_stream` direct-LLM wire as the Irisy chat path (that's the wrong wire — was a stub from Phase 1D)

## Open question for bao

- **Apple Developer Program** ($99/yr) — this would solve the "every upgrade requires re-grant Accessibility" pain. zeus needs bao's go to enroll + the team enrolment ID to wire into `scripts/release.sh codesign + notarize`. Orthogonal to Irisy but blocks the every-day UX.
