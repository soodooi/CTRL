---
title: "H-2026-06-09-001 ADR Amendments"
date: 2026-06-09
handoff: H-2026-06-09-001
status: superseded
---

> **SUPERSEDED 2026-06-09** by H-2026-06-09-002 (3-agent aggregator, ADR-001 spine v4 + ADR-002 substrate v19). Historical record only — the dual-brain amendments below were shipped then retracted the same day.

## ADR Amendments for H-2026-06-09-001 Dual-Brain Architecture

### Overview

This document captures ADR amendments required by H-2026-06-09-001 (dual-peer opencode + Hermes architecture).

---

## ADR-001 spine §4 Amendment

**Version**: 2 → 3
**Date**: 2026-06-09
**Handoff**: H-2026-06-09-001

### Current (v2) — Pi-centric 5-block view

```
USER ↔ ui-ux (PWA, Irisy 表达) ↔ KERNEL ↔ Pi ★ (sole brain) ↔ { PROVIDER (LLM) · MCP (tool) }
```

- **ui-ux** — PWA, single React 18 + Vite 5 + TanStack codebase (ADR-003)
- **KERNEL** — Rust microkernel + sub-systems (ADR-002)
- **Pi** ★ — sole agent loop (ADR-002 § brain). Hermes fully removed 2026-05-28.
- **PROVIDER** — LLM adapters Pi calls (ADR-002 § provider)
- **MCP** — tools Pi invokes via MCP (ADR-004)

### New (v3) — Dual-peer opencode + Hermes

```
USER ↔ ui-ux (PWA, dual tabs) ↔ KERNEL
                                  ↙                         ↘
                        opencode (coding brain)       Hermes (assistant brain)
                            ↓                               ↓
                  opencode HTTP API               Hermes MCP (stdio)
                            ↓                               ↓
                    own provider registry        own provider registry
                            ↓                               ↓
                      LLM (BYOK / CF)              LLM (BYOK / RAG)
```

**Changes from v2**:

1. **Pi no longer sole brain** — Pi is REPLACED by dual peer processes (opencode for coding, Hermes for assistant). Pi retained ONLY for legacy Irisy chat (ADR-005).
2. **Two brain types**:
   - **opencode** — coding brain: LSP integration, formatter, symbol search, plan/summary agents, code navigation. Spawns as `opencode serve` (HTTP API, random port).
   - **Hermes** — assistant brain: RAG, embeddings, long-term memory, strong dialog, knowledge retrieval. Spawns as `hermes mcp serve` (MCP stdio).
3. **Independent provider registries** — Each brain manages its own provider credentials. No sharing. `opencode` reads `~/.opencode/config.yaml`, Hermes reads `~/.hermes/config.yaml`. Future: macOS Keychain (credential_vault.rs).
4. **Kernel role** — Supervisor + bridge, NOT central provider router. Kernel spawns each brain via dedicated supervisor (`opencode_supervisor`, `hermes_supervisor`). PWA talks to each brain via dedicated Tauri commands (`opencode_chat_stream`, `hermes_chat_stream`).
5. **Two L1 tabs** — PWA PrimaryRail has 5 chips: Irisy / Mcp pool / Notes / Coding / Assistant. Coding tab → opencode. Assistant tab → Hermes.

**Invariants preserved**:

- 5 primitives unchanged (Actor / Capability / Channel / Event / Effect).
- MCP wire format unchanged.
- Tauri 2 shell role unchanged (spawning + keychain + window).
- Vault stack unchanged (Tiptap + CodeMirror 6 + mermaid.js + FTS5).

**Acceptance**:

- [ ] ADR-001 spine §4 updated to v3
- [ ] ADR-002 substrate §1 updated (see below)
- [ ] Kernel supervisors: `src-tauri/src/shell/opencode_supervisor.rs` + `hermes_supervisor.rs`
- [ ] PWA tabs: `packages/ctrl-web/src/routes/coding.tsx` + `assistant.tsx`
- [ ] Tauri commands: `opencode_chat_stream` + `hermes_chat_stream`
- [ ] End-to-end verification: opencode serve (coding) + Hermes mcp serve (assistant)

**Changelog**:

- v3 2026-06-09: dual-peer opencode + Hermes architecture (H-2026-06-09-001). Pi no longer sole brain; retained ONLY for Irisy chat.

---

## ADR-002 substrate §1 Amendment

**Version**: 11 → 12
**Date**: 2026-06-09
**Handoff**: H-2026-06-09-001

### Current (v11) — Pi is the sole core agent loop

**Pi is the singleton brain.** PWA forwards every user turn → kernel → Pi MCP @ port. Pi runs its own agent loop (LLM → tool → loop). No brain switcher UI; user switches **provider** (§3), not brain.

- **Install**: `~/.ctrl/pi/`, lazy npm install of `@mariozechner/pi-coding-agent@latest`. Fallback: GitHub tarball if no npm.
- **Auto-upgrade**: priority-0. 24h npm registry probe, background `npm install` on new version, applies on next Pi process restart. Major bump (0.x → 1.x) blocks with UI banner.
- **Bridge**: `packages/ctrl-pi-bridge/` ships in app Resources. Pi spawned with `--extension <bridge-path>`. Bridge uses Pi's official `RpcClient` + inlined `AssistantMessageEventStream`; HTTP-fetches `localhost:<port>/text-chat` (kernel provider endpoint, §3).
- **No `pi /login` ever**: bridge auto-configures via env (`CTRL_PROVIDER_PORT` / `CTRL_PROVIDER_TOKEN`).
- **Retired** (do not re-introduce): `brain_config.rs`, `commands/brain.rs`, `BrainListReply`, PWA `irisy-tools.ts` / `irisy-llm-runner.ts` (frontend ReAct), `~/.ctrl/active-brain` file, brain switcher UI.

### New (v12) — Dual-peer brains (opencode + Hermes) + Pi for Irisy only

**Three agent processes, NOT one.**

1. **opencode** (coding brain) — subprocess spawned via `OpencodeSupervisor`. HTTP API (random port). Own provider registry (`~/.opencode/config.yaml`). PWA `/coding` tab → `opencode_chat_stream`.
2. **Hermes** (assistant brain) — subprocess spawned via `HermesSupervisor`. MCP stdio. Own provider registry (`~/.hermes/config.yaml`). PWA `/assistant` tab → `hermes_chat_stream`.
3. **Pi** (Irisy brain only, retained) — subprocess spawned via `PiSupervisor`. MCP @ port 17873. Uses kernel provider registry (`~/.ctrl/state/active-providers.json`). PWA Irisy chat uses Pi.

**Key changes from v11**:

1. **No "sole brain" concept** — CTRL now has 3 peer agent processes, each with own lifecycle. Pi is ONE of them (for Irisy), NOT the sole core.
2. **Provider routing no longer central** — Each brain manages its own provider:
   - **opencode** — reads `~/.opencode/config.yaml` (Anthropic / OpenAI / custom). Manual config (no CTRL Settings UI yet).
   - **Hermes** — reads `~/.hermes/config.yaml` (Anthropic Claude / OpenAI GPT / Ollama). Manual config (no CTRL Settings UI yet).
   - **Pi** — uses kernel provider registry (`~/.ctrl/state/active-providers.json`), role-aware routing (§3.5), managed via CTRL Settings UI (`/settings/providers`).
3. **Two new supervisors** — `OpencodeSupervisor` + `HermesSupervisor` in `src-tauri/src/shell/`. Each spawns its brain process, monitors lifecycle, respawns on crash with backoff.
4. **Two new Tauri commands** — `opencode_chat_stream` + `hermes_chat_stream`. Wire format mirrors `irisy_chat_stream` (request_id + delta events).
5. **Pi role narrowed** — Pi is NOW used ONLY for Irisy chat (ADR-005). Coding + Assistant moved to opencode + Hermes.
6. **Credential security** — opencode + Hermes use plaintext config files (future: migrate to macOS Keychain via `credential_vault.rs`). Pi already uses kernel keychain integration.

**Preserved from v11**:

- Pi's ctrl-pi-bridge extension API (4 surfaces: registerProvider / registerTool / on('before_agent_start') / on('tool_call') / on('resources_discover')).
- Pi's auto-upgrade mechanism (priority-0).
- Pi's runtimeTruthBlock (v9: pre-write real provider to `~/.pi/agent/models.json` before spawn).
- Provider router §3.5 for Pi ONLY (not shared with opencode / Hermes).

**Acceptance**:

- [ ] ADR-002 substrate §1 updated to v12
- [ ] `OpencodeSupervisor` + `HermesSupervisor` implemented
- [ ] `opencode_chat_stream` + `hermes_chat_stream` implemented
- [ ] PWA `/coding` + `/assistant` tabs implemented
- [ ] End-to-end verification

**Changelog**:

- v12 2026-06-09: dual-peer brains (opencode + Hermes) + Pi for Irisy only (H-2026-06-09-001). No longer "sole brain"; provider routing decentralized.
- v11 2026-06-07: Coding L1 — on-demand native Pi TUI (ADR-002 §3.11).
- v10 2026-06-07: Provider template catalogue — 20 entries (ADR-002 §3.10).
- v9 2026-06-06: Pi single alias RETRACTED (Pi spawns with real provider directly).

---

## Implementation Summary

### Kernel changes

1. `src-tauri/src/shell/opencode_supervisor.rs` — spawns `opencode serve`, parses HTTP port from stdout, respawns with backoff.
2. `src-tauri/src/shell/hermes_supervisor.rs` — spawns `hermes mcp serve`, verifies MCP handshake from stderr, respawns with backoff.
3. `src-tauri/src/commands/opencode_chat.rs` — HTTP client to opencode, SSE parsing, emit `opencode-chat-delta` events.
4. `src-tauri/src/commands/hermes_chat.rs` — MCP stdio client to Hermes, emit `hermes-chat-delta` events.
5. `src-tauri/src/shell/lifecycle.rs` — starts both supervisors on app launch, shuts down on app exit.

### PWA changes

1. `packages/ctrl-web/src/routes/coding.tsx` — Coding tab (opencode chat UI).
2. `packages/ctrl-web/src/routes/assistant.tsx` — Assistant tab (Hermes chat UI).
3. `packages/ctrl-web/src/App.tsx` — register `/coding` + `/assistant` routes.
4. `packages/ctrl-web/src/components/PrimaryRail.tsx` — add Coding + Assistant L1 chips.

### Future work (v1.1+)

1. Credential migration: opencode + Herms → macOS Keychain (`credential_vault.rs`).
2. Provider config UI: Settings page for opencode + Hermes (currently manual config file edit).
3. Brain fallback: opencode → Pi (if opencode not installed); Hermes → Pi (if Hermes not installed).

---

## References

- H-2026-06-09-001 handoff: `.olym/handoffs/H-2026-06-09-001.md`
- ADR-001 spine: `.olym/decisions/001-spine.md`
- ADR-002 substrate: `.olym/decisions/002-substrate.md`
- opencode: `https://github.com/opencode-ai/opencode`
- Hermes: `https://github.com/hermes-ai/hermes` (hypothetical for handoff; real repo TBD)