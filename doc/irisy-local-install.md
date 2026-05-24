# Irisy local install — full ingredient list + flow

> Per bao 2026-05-23: "Irisy 不是单独存在的, 应该是 hermes 等的集合". This doc nails down what "install Irisy" actually means.

---

## What Irisy IS (the lock — `decision_irisy_architecture` 2026-05-22)

**Irisy = 三层综合体**:

1. **Runtime** — `hermes-agent` (Python, MIT, NousResearch). The brain. CTRL ships none of hermes' reasoning code.
2. **Skills** — `~/.hermes/skills/<id>/SKILL.md` knowledge packs. Some shipped by CTRL keycaps (`target: "hermes-skill"`), some installed independently (agentskills.io).
3. **Tools** — MCP function calls. The kernel exposes ~10 base tools via `kernel::mcp_server` (vault / kv / llm / mcp.proxy). Keycaps with `target: "mcp-tool"` add more.

Irisy ≠ a standalone LLM chatbot. Irisy = a Hermes Agent session running over a CTRL-shaped tool surface. The 5-part body mapping (`decision_ctrl_is_hermes_workbench`):

> hermes = 脑 · keycap (MCP server) = 手 · OS capability (Tauri commands) = 脚 · Workspace cell stream = 眼 · Irisy (PWA persona) = 嘴 · PWA 2-zone = 工作台

---

## 7 ingredients required for "Irisy works on bao's Mac"

| # | Ingredient | What it is | Where it lives | Status |
|---|---|---|---|---|
| 1 | **hermes-agent** | Python CLI/runtime. `pip install hermes-agent` (PyPI v0.14.0, MIT) | `~/.local/pipx/venvs/hermes-agent/` (via pipx) | ✅ verified install works |
| 2 | **ctrl-hermes-plugin** | Hermes Tool plugin (zeus shipped). 11 tool shims → kernel MCP server | `~/.hermes/plugins/ctrl/` (dir copy + `hermes plugins enable ctrl`) | ✅ shipped (`packages/ctrl-hermes-plugin/`); verified loads + enables |
| 3 | **kernel MCP server** | rmcp 1.7 streamable-http server, 11 tools (vault / kv / llm / mcp.proxy / kernel.status) | kernel process, `127.0.0.1:17873` | ✅ shipped (ADR-013) |
| 4 | **kernel handshake file** | URL + Bearer token plugin reads to auth against kernel | `~/.ctrl/state/kernel-handshake.json` (mode 0600, rewritten per boot) | ✅ shipped |
| 5 | **LLM provider for hermes** | hermes needs an LLM (Anthropic / OpenAI / Volc / local Ollama). User runs `hermes login <provider>` once | hermes config + keychain | ❌ **no automation** — user manually `hermes login` today |
| 6 | **CTRL keycaps as Hermes skills/tools** | When user installs a keycap with `target: "hermes-skill"`, kernel writes `SKILL.md` to `~/.hermes/skills/<id>/`; `target: "mcp-tool"` keycaps surface through `mcp.proxy_*` from #3 | `~/.hermes/skills/` + manifest registry | ⚠️ partial — keycap manifest v0.3 spec landed but `skill_generator` Rust module NOT shipped yet |
| 7 | **PWA chat → hermes wire** | When bao types in cockpit ChatInput, query → hermes session → answer streamed back | PWA `handleSend` → Tauri command → hermes subprocess | ❌ **wrong wire today** — current `handleSend` calls `chat_stream` (direct LLM via Volc), bypasses hermes entirely |

---

## "Install Irisy" user flow (what bao sees)

```
1. bao downloads CTRL.app (one-time)
2. CTRL launches → cockpit visible (first-launch path)
3. CTRL self-check (system_check Tauri command, already shipped):
     • python3 ≥ 3.11 ?
     • pipx installed ?
     • hermes-agent installed ?
     • ctrl-hermes-plugin in ~/.hermes/plugins/ctrl/ ?
     • hermes provider login present ?
4. CTRL surfaces missing pieces in a "Install Irisy" pane:
     • "Install runtime" → install_irisy Tauri command runs pipx
     • "Install CTRL plugin" → install_irisy continues (cp + enable)
     • "Configure AI provider" → opens hermes login UI helper
                                  (TODO: not shipped yet — user runs
                                  `hermes login anthropic` in terminal)
5. Once all 5/7 boot ingredients green, the "Talk to Irisy" CTA enables
6. bao types in ChatInput → kernel routes to hermes subprocess
7. hermes reasons + calls ctrl plugin tools (vault.read etc.) + LLM
8. Streamed response renders in the cockpit
```

---

## Backend gaps zeus must close (in order)

### A. Tauri command `irisy_send` (high priority — replaces wrong `chat_stream` wire)

- Signature: `irisy_send({ session_id, text }) → AsyncIterable<IrisyDelta>`
- Internals: spawn `~/.local/pipx/venvs/hermes-agent/bin/hermes chat -q "{text}" -Q --pass-session-id {session_id} --source ctrl` as a `SubprocessActor` (ADR-012 portable-pty); stream stdout as deltas.
- Append every turn to `kernel::EventStore` (Irisy memory persistence)
- Pipes user-side cancellation through SIGINT to the subprocess.

### B. `kernel::skill_generator` Rust module (medium priority)

- Per ADR-010 amendment: keycap manifest with `target: "hermes-skill"` triggers generation of `~/.hermes/skills/<keycap-id>/SKILL.md` from the manifest's `description + config_schema.documentation + flow` fields. Spec already drafted at `.olym/specs/skill-generator/spec.md`.
- Triggered by `install_keycap` Tauri command when `target === "hermes-skill"`.

### C. Memory persistence (medium priority)

- `commands/memory.rs` currently stub. Wire `read_log` / `append_event` / `query` to `kernel::EventStore`. Irisy's `irisy_send` then appends every user/assistant turn — Irisy's recall across sessions.

### D. Hermes-login automation (low priority — manual until v1)

- `hermes login anthropic` etc. require interactive token paste or OAuth flow.
- Phase-2 Tauri command `irisy_provider_login(provider)` spawns the hermes login subprocess + bridges its OAuth callback through CTRL's existing keychain.

### E. Workspace tab support (separate from Irisy — same lane though)

- Daedalus lane (frontend) already shipped TabStrip + WorkspaceTabs + EmbedView.
- Backend Tauri command `workspace_open_tab(kind, payload)` for opening vault md / keycap-output / hermes embed from kernel-driven events.

---

## Non-goals (explicitly NOT Irisy)

- Direct Volc / Anthropic LLM chat from `handleSend` — that's a different surface (keycap-internal LLM use), NOT Irisy.
- A bespoke CTRL chat shell pretending to be Irisy. Irisy must always run through hermes, otherwise it's just "another chat box".
- Bundling hermes-agent binaries into CTRL.app. MIT compliance + ecosystem velocity require lazy pip install.

---

## Why this matters (sanity gut-check)

If we ship Irisy as a Volc-passthrough chat shell, we get a worse Doubao clone. The whole differentiation thesis (`decision_ctrl_is_hermes_workbench`) is: **CTRL gives hermes hands + feet + workbench**. The chat surface must consume hermes — otherwise we've built scaffolding around a body that isn't there.

This doc is the contract — every backend change zeus ships toward "Irisy" works against §B/C/D/E above, NOT against a chat_stream-wire-direct shortcut.
