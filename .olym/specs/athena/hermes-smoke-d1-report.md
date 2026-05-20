# D1 — Hermes 本地落地验证（partial report）

> **⚠️ SUPERSEDED 2026-05-16** — Hermes dropped from Irisy v1 stack (see `memory/decision_drop_hermes_for_irisy_v1.md`). This report is retained as **reference data** for the eventual v1.1 Janus / gateway integration decision, when Hermes vs. self-rolled vs. picoclaw-fork will be re-evaluated. The numbers here (78 MB venv, 1.7 s cold start, 66 MB peak RSS, provider matrix, ACP/MCP/skills surface inventory) all remain valid as captured.

**Date:** 2026-05-16  
**Owner:** Athena  
**Status:** ⚠️ partial when written; now superseded — kept for future reference

---

## What was installed

```
pipx install --python python3.12 hermes-agent
# → hermes-agent 0.13.0 (release 2026.5.7)
# → installs hermes / hermes-acp / hermes-agent
```

No `install.sh` was used. `install.sh` would have bundled uv + Python 3.11 + Node.js + ripgrep + ffmpeg + git-bash — overkill for this smoke; saved for if/when a full appliance install is ever needed.

---

## Quantified (no LLM call required)

| Metric | Value | Method |
|---|---|---|
| pipx venv size | **78 MB** | `du -sh ~/.local/pipx/venvs/hermes-agent` |
| `~/.hermes` config dir (fresh) | 12 KB | `du -sh ~/.hermes` |
| `hermes --version` cold start | **220 ms** (warm cache) / 370 ms (first run) | `time hermes --version` ×3 |
| `hermes status` cold start | **1.71 s** | `time hermes status` |
| `hermes -z` fail-path latency (no provider) | 780 ms | error before any HTTP call |
| `hermes -z` peak RSS (fail path) | **66 MB** | `/usr/bin/time -l hermes -z ping` |
| Compare: `claude --version` cold start | 90 ms | reference |
| Compare: `claude --version` peak RSS | 193 MB | reference |

**Observation:** Hermes is ~3× lighter on RAM than Claude CLI (Python vs bundled Node), but ~5× slower on cold start (Python interpreter + import-everything). For a copilot that's hit on every keycap press, cold start matters. We need to either keep Hermes hot (daemon mode) or accept a ~1.7 s warm-up on first interaction per session.

---

## Provider matrix (discovered)

Hermes 0.13 ships native support for:
- **Nous Portal** (OAuth, Nous-hosted inference)
- OpenAI Codex (OAuth import)
- Google Gemini (OAuth)
- **MiniMax** (OAuth) ← matches Bao's chosen LLM
- OpenRouter, Anthropic, OpenAI (API key)
- Plus extras: Exa, Parallel, Firecrawl, Tavily, Browserbase, FAL …

Auth model: pooled credentials via `hermes auth add <provider> --type api-key --api-key …` (non-interactive) or OAuth flow.

Gateway support relevant for CTRL keycap "5 sources" map: Telegram, Discord, Slack, WhatsApp, Signal, **QQBot, Yuanbao (腾讯元宝)** — Hermes already covers a big slice of the Chinese OPC platforms we'd want.

---

## Architecture surprises (not in repo docs)

The 8 doc files in `doc/` were written from older Hermes assumptions. Real 0.13 surface adds things worth knowing for D2/D3:

1. `hermes acp` — runs Hermes as an **ACP (Agent Client Protocol) server**. This means CTRL can talk to Hermes over a standard protocol instead of subprocess piping. Big simplification for Zeus's L1 adapter.
2. `hermes mcp` — runs Hermes as **both** an MCP host AND an MCP server. So CTRL keycaps that are MCP-shaped get a native path.
3. `hermes kanban` — multi-profile collab board (tasks, links, comments). Could be the substrate for Athena-team future personas.
4. `hermes plugins` + `hermes skills` + `hermes curator` — built-in plugin / skill / background-maintenance system. Hephaestus's keycap manifest may want to align with one of these surfaces rather than reinventing.
5. `hermes memory` — pluggable external memory provider. Solves cross-session memory without rolling our own SQLite+vector schema.
6. SOUL.md (`~/.hermes/SOUL.md`) = the system prompt file. **This is exactly the surface I'll override for Irisy.** Default content is generic, ~80 words.

---

## Blocked on

To finish D1's remaining two metrics (first-token latency, single-query cost) I need an LLM credential. Three roughly equal options:

| Option | Cost to Bao | Ergonomics | Notes |
|---|---|---|---|
| (a) MiniMax new key | covered by existing MiniMax balance | direct API-key paste | matches the chosen production LLM; key never touches git if I write directly to `~/.hermes/.env` |
| (b) Nous Portal OAuth | likely free evaluation tier | one browser pop-up | Hermes-native, would test the "out of the box" path |
| (c) OpenRouter free models | $0 | API-key paste | tests a path we wouldn't ship; less informative |

Recommendation: **(a) MiniMax** — gives apples-to-apples numbers for the model Bao actually plans to ship on.

---

## Next steps (once unblocked)

1. Run `hermes -z` 5× with MiniMax-M2.7-highspeed: capture `[t+ first-text]`, total ms, tokens, $ cost.
2. Run same 5× under `hermes acp` daemon mode (subsequent calls hot): measure delta to confirm daemon path eliminates cold-start tax.
3. Override SOUL.md with first-draft Irisy persona, repeat to see latency impact of longer system prompt.
4. Sketch D3 adapter trait around `hermes acp` rather than subprocess piping.
