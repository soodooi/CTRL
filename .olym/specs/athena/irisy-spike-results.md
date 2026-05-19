# Irisy spike — end-to-end smoke results

**Date:** 2026-05-16
**Spike location:** `experiments/athena-irisy-spike/`
**Transport:** Zeus's `experiments/claude-cli-shim/` (port 8787, no process pool)
**Model:** `claude-haiku-4-5`
**Persona:** `irisy-soul-draft.md` v0.1 (~80 lines)

## Verdict

✅ **All three acceptance criteria met.** The "CLI 为主" architecture works end-to-end; Irisy persona override lands cleanly through Zeus's shim; D1 leftover metrics captured.

## Per-test outcomes

### 01 — identity (non-stream)

**Prompt:** "你是谁？一句话。"
**Response:** > 我是 Irisy，你在 CTRL 里的个人助手——帮你用工具、解答问题、陪你思考的那个。
**Latency:** 8.99 s end-to-end
**Verdict:** Persona override fully replaces Claude Code default. Says her name, role, context (CTRL), and tone matches SOUL ("帮你... 陪你思考"). Zero Claude/Anthropic leakage.

### 02 — streaming (SSE)

**Prompt:** "从 1 数到 5，每行一个数字。"
**Response:** SSE-correct: assistant-role chunk → content delta `"1\n2\n3\n4\n5"` → stop chunk → `[DONE]`. Real OpenAI-shape SSE stream.
**Latency:** 6.75 s end-to-end
**Verdict:** Streaming path through shim works. (Note: claude collapsed the whole output into one delta since the request was short; would be many deltas on longer outputs — Zeus's earlier independent smoke saw "真字符级 SSE delta".)

### 03 — realistic Irisy job (non-stream)

**Prompt:** "我装了个 OCR 键帽但截图后没反应，怎么排查？"
**Response:**
> 先看下 OCR 键帽有没有装成功 — 在 CTRL 的键帽列表里能找到它吗？如果在列表里，试试点开键帽检查一下配置（比如有没有缺少 API 密钥或权限）；如果都配好了但截图后还是没反应，我可以带你找 **Talos** 来调试键帽代码看看哪里卡住了。
**Latency:** 10.73 s end-to-end
**Verdict:** **Pattern C works on day one.**
- "先看下..." → walks the user one step forward, doesn't dump a plan ✓ matches SOUL
- "键帽" vocab used naturally ✓
- **Calls out Talos by name** for handoff — UX Pattern C lands in v0.1 prompt ✓
- Suggests, doesn't dictate ✓
- Mirrors Chinese ✓

## Metrics summary (the D1 leftovers)

| Metric | Value | Notes |
|---|---|---|
| End-to-end latency, non-stream | 8.99 s / 10.73 s | dominated by claude CLI cold-spawn (~2 s) + generation |
| End-to-end latency, stream | 6.75 s | first-text-deltas arrive within ~3 s but Bun-on-Node + curl timing not captured precisely here; Zeus reported 11 s for a longer test |
| Marginal cost per query | **$0** | Bao's claude OAuth subscription path; no token-bill ledger needed |
| Token counts surfaced in OpenAI response | ❌ none | Zeus's shim doesn't populate `usage` field — gap to flag (see below) |

**Cold-spawn overhead** dominates latency. Pre-warming a claude process pool (or holding one persistent claude session per Irisy session) is the obvious next optimization.

## Gaps surfaced (Athena → Zeus)

| # | Issue | Why it matters | Owner |
|---|---|---|---|
| G1 | Shim response has no `usage.prompt_tokens` / `completion_tokens` | Hermes / Irisy memory layer can't budget without it | Zeus |
| G2 | No process pool — every request cold-spawns claude (~2 s) | Bad for ambient / quick-tap UX | Zeus |
| G3 | Multi-turn flattening to "User:/Assistant:" prefixes — Claude's API native message format ignored | Quality loss on long conversations | Zeus |
| G4 | `temperature` / `max_tokens` ignored | Persona control narrows | Zeus (can ignore for Irisy v1 since persona is in SOUL) |

These aren't blockers for D2/D3, but G1 + G2 should be on Zeus's near-term list.

## What this unblocks

- **D1** — closed. Smoke covers everything that was waiting on an LLM key.
- **D2 (Irisy spec)** — now ready to draft. The v0.1 SOUL proved the persona shape works; D2 expands it to the full coding-companion scope per Bao's 2026-05-16 expansion. **Stack is `PWA → Tauri invoke → Zeus's claude-cli-shim → claude` — Hermes dropped from v1** (see `memory/decision_drop_hermes_for_irisy_v1.md`).
- **D3 (contract with Zeus)** — sharpened. Adapter trait should standardize the shim's OpenAI-shape interface as a thin `LLMTransport` so Hermes / picoclaw / raw SDK can swap in at v1.1; plus the 4 "Irisy page = coding companion" base-layer capabilities (subprocess actor, PTY wrap, ST-SS bidirectional, multi-channel extension).

## Where Hermes data goes

Hermes was uninstalled 2026-05-16 (`pipx uninstall hermes-agent`, `rm -rf ~/.hermes`). The smoke numbers + provider matrix + ACP/MCP/skills inventory in `hermes-smoke-d1-report.md` are retained as reference for the v1.1 Janus decision, when Hermes vs self-rolled vs picoclaw-fork will be compared with real Janus requirements in hand.
