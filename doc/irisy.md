# Irisy — canonical reference

> Ground truth from code. Last reconciled 2026-05-27.
> Brain = pluggable (cc-switch-style registry; Pi is the default and only shipped adapter — ADR-021).
> Owner lane = `.worktrees/irisy` (`feat/irisy`).
>
> Replaces `doc/irisy-walk-through.md` (2026-05-23, hermes-brain framing — superseded by ADR-019 amendment 2026-05-25, further relaxed by ADR-021).

---

## 1. What Irisy is

**Personal assistant** that operates the user's installed keycaps.

- Lives as a PWA route (`/irisy`) and as a side-pane in `/code-space/$envId`.
- Speaks to whichever brain the user picked in `/settings/brain`. The kernel BrainRouter (`irisy_chat_stream`) reads `~/.ctrl/active-brain` each turn and forwards to the brain's MCP server. Pi is the default and the only adapter shipped today; Claude Code / Codex / Gemini CLI are scaffolded in the UI (ADR-021).
- Always-on fallback path: when no brain is reachable, Irisy still streams from the kernel's raw LLM adapter (Volc / Anthropic) via `chat_stream` — the same provider that powers other CTRL keycaps. So chat works on day one even with the brain switch off.
- Reads + writes the user's vault — `.irisy-memory/` (records) and `.irisy-prompts/` (system prompt).
- Can list / install / configure / run / uninstall keycaps on the user's behalf.

Irisy is **not** a generic chatbot. The product promise: "Tell Irisy what you want done; if the right keycap isn't installed yet, Irisy installs it and then drives it for you."

---

## 2. Business surfaces (5)

| # | Surface | Route / entry | Transport | Persona |
|---|---|---|---|---|
| 1 | **Personal Assistant** | `/irisy` (default mode) | `irisy_chat_stream` (Pi) **or** `chat_stream` (raw LLM + frontend ReAct) | `~/<vault>/.irisy-prompts/irisy-system.md` |
| 2 | **Keycap Creator** | `/irisy?intent=create-keycap` | `chat_stream` (defaultTransport) | `personas/irisy/keycap-creator.ts` |
| 3 | **Code Companion** | `/code-space/$envId` side-pane | `chat_stream` (defaultTransport) | `personas/irisy/code-companion.ts` |
| 4 | **Memory Keeper** | (cross-cutting, all surfaces) | n/a (vault file IO) | n/a |
| 5 | **(extension of #1)** Keycap installer | `/irisy` chat → install flow | same as #1 | same as #1 |

### 1 · Personal Assistant *(renamed from "General Chat" — bao 2026-05-26)*

Main daily-driver surface. Implementation: `components/irisy/IrisyChat.tsx` (997 LOC).

- System prompt loaded from `~/<vault>/.irisy-prompts/irisy-system.md` (auto-bootstrapped on first mount).
- Dual transport, toggled by a "Use Pi" switch in the chat header:
  - **Pi ON** → `irisy_chat_stream` → BrainRouter → Pi MCP. Pi runs its own agent loop + its own MCP tool surface. PWA stays single-turn-streaming.
  - **Pi OFF** → `chat_stream` (raw kernel LLM) + a **frontend ReAct loop** that parses `<call name="...">` tags from LLM output, executes them locally through Tauri, and feeds results back as `<call-result>` user turns. Reason: the Volc adapter doesn't yet pass OpenAI tool-call frames through to the PWA, so tool-use has to be done in markup.
- On mount: `invoke('irisy_init')` — returns kernel-llm / mcp-bridge / Pi status snapshot.

### 2 · Keycap Creator

Specialised mode for authoring new keycaps via conversation. Implementation: `routes/irisy.tsx` (CreatorShell branch) + `components/irisy/CreatorShell.tsx` + previews.

Flow: chat → ManifestPreview + CodePreview → InstallBar → `install_keycap`. LLM emits `<keycap-ready/>` to trigger an auto follow-up turn `<emit-manifest/>`. Zustand store: `irisy-keycap-store.ts`. Validation: `irisy-keycap-zod.ts`.

### 3 · Code Companion

Sits next to the xterm viewer in Code Space. Implementation: `components/code-space/CompanionPane.tsx`.

Reads terminal scrollback via host-provided `getRecentStdout()`, streams suggestions, detects fenced ```bash / ```sh code blocks and surfaces a "Send to terminal" button per block (wires to `cs_stdin`).

### 4 · Memory Keeper *(cross-cutting)*

`lib/irisy-memory.ts` — writes to vault `.irisy-memory/`:
- `index.md` — table of contents
- `user_profile.md` — long-lived facts about the user
- `<type>_<topic-kebab>.md` — typed records (`fact_*`, `pref_*`, `event_*`, …)

`loadCoreMemory()` runs at chat mount and injects index + profile into the system prompt. Models update via the `update_memory` tool. **Plain-text philosophy: vim works.**

### 5 · Keycap Installer *(new, bao 2026-05-26)*

**Not a separate surface — an extension of Personal Assistant.**

Promise: user says "记一笔今早咖啡 28 块"; Irisy finds the right bookkeeping keycap (search), installs it (with user consent — see Open Question 1), then operates it.

Worked example:

```
User: 帮我记一笔今早咖啡 28 块
Irisy:
  <call name="list_keycaps">                       # check what's already installed
  <call name="search_pool" query="bookkeeping">    # NEW tool, needs backend
  → 3 candidates; ask user to pick
  <call name="install_keycap_from_pool" id="…">    # NEW tool
  <call name="run_keycap" id="…" tool="add_expense" args={amount:28, category:"咖啡", …}>
  → "记好了"
```

---

## 3. Tool surface

### Existing (13, in `lib/irisy-tools.ts`, frontend ReAct loop only)

| Domain | Tools |
|---|---|
| Vault | `vault_search`, `vault_read`, `vault_list` |
| Keycap (already-installed) | `list_keycaps`, `run_keycap`, `read_keycap_manifest`, `set_keycap_config`, `uninstall_keycap` |
| Brain | `list_brains`, `set_active_brain` *(ADR-021)* |
| System | `kernel_status` |
| Workspace | `open_workspace_tab` |
| Self | `update_memory` |

### To add (3, for #5 Keycap Installer)

| Tool | Backend command | Status |
|---|---|---|
| `search_pool` | (does not exist yet) | ❌ backend gap — kernel needs a `pool_search` command |
| `install_keycap_from_pool` | (does not exist yet — Pool → `install_keycap` plumbing) | ❌ backend gap |
| `install_keycap_from_mcp` | `install_keycap_from_mcp` (already exists, used by Creator path) | ⚠️ exposed via Tauri, not via Irisy tool registry |

### Tool surface duality (drift to resolve)

When **Pi ON**, the 12 frontend tools are dead code — Pi uses its own MCP tool set served by the kernel MCP server (per ADR-013). When **Pi OFF**, only the 12 frontend tools work; the kernel MCP server is unused for chat. The two tool surfaces are not 1:1 today.

---

## 4. Open follow-ups (ADR-021 — accepted 2026-05-27)

### F1 · Install confirm UX

Per-install confirm modal — keycap installs pull remote code (MCP servers, `server.ts`), so consent must be explicit. Optional "trust this source for the rest of this session" check is a follow-up polish. Tracked: ADR-021 §5.

### F2 · Pool backend

`/pool` route still reads placeholder data. The Pool registry backend
(`pool_search` Tauri command + `~/.ctrl/pool/index.json` or
`ctrl-cloud` endpoint) is the next gap before `search_pool` /
`install_keycap_from_pool` Irisy tools can land. Tracked: ADR-021 §5.

### F3 · Pi MCP server auto-spawn

Selecting Pi as the active brain in `/settings/brain` does **not** yet
start `ctrl-pi-mcp.ts`. v1 expectation: user starts it manually
(`npm start` in `packages/ctrl-pi-plugin/`). Auto-spawn from
`KernelSupervisor::start` requires binary-discovery work (locating
`node --experimental-strip-types <path>` inside the bundled .app).
Tracked: ADR-021 §"Open follow-ups" #1.

### F4 · Multi-session chat history

`localStorage.irisy:chat:v1` holds one rolling conversation. The
homepage rail shows it as "Current". Persisted multi-session history
in the kernel event store is the next iteration. Tracked: ADR-021
§"Open follow-ups" #3.

---

## 5. Drift inventory (clean-up queue, post-ADR-021)

| # | Drift | Where | Status |
|---|---|---|---|
| 1 | `kernel/mod.rs` "P2.1 skeleton" comment + `#![allow(dead_code)]` | `src-tauri/src/kernel/mod.rs` | ✅ comment trimmed (2026-05-27); allow retained for intentionally-unused public exports |
| 2 | hermes residue: `irisy_chat_hermes`, `irisy_upgrade_hermes`, `IrisyStatus.hermes`, `read_hermes_status` tool, hermes upgrade button in IrisyChat header | multiple | partial: `/settings/hermes` now redirects to `/settings/brain`; remaining items demoted, deletion follows once in-flight hermes branches land or are cancelled |
| 3 | `ctrl-claude-shim` package | `packages/ctrl-claude-shim/` | open — inspect & decide (ADR-005 / `feedback_no_claude_in_production` likely says delete) |
| 4 | Code Companion + Keycap Creator both use `defaultTransport()` (raw LLM via `chat_stream`), not the brain registry | `CompanionPane.tsx`, `routes/irisy.tsx` creator path | intentional for now — these surfaces don't need brain-side agent loops. Personal Assistant uses the brain registry. Revisit if a brain-aware Creator / Companion experience emerges. |
| 5 | Frontend ReAct loop + brain agent loop both alive | `irisy-tools.ts` vs brain MCP | intentional dual: frontend ReAct works without a brain installed (Volc fallback); brain agent loop is the upgrade path. Collapse to brain-only when every shipped brain has its own agent loop. |

Drift #4 implies a question this ADR resolves: **does every surface share one brain?** No — Personal Assistant uses the brain registry; Creator + Code Companion use the raw LLM with frontend ReAct because their flows are task-shaped, not agent-shaped.

---

## 6. ADR-021 — accepted 2026-05-27

Locked decisions (see `.olym/decisions/021-irisy-brain-switcher-and-surfaces.md` for full text):

1. 5 business surfaces — Personal Assistant + Keycap Creator + Code Companion + Memory Keeper + Keycap Installer (⊂ Personal Assistant).
2. Brain is pluggable. Registry at `kernel::brain_config`; user overrides at `~/.ctrl/brains.toml`; active selection at `~/.ctrl/active-brain`. Pi is the default and only adapter shipped today.
3. Settings UI at `/settings/brain` (cc-switch / VMark / opencode style) with "Detect on $PATH" button. Replaces `/settings/hermes`.
4. Three new Tauri commands: `brain_list`, `brain_detect`, `brain_set_active`. All return the same `BrainListReply` shape.
5. Frontend ReAct loop stays — works without a brain installed. Brain agent loop is the upgrade.
6. Homepage chat works: `/` hands off via `?text=` to `/irisy`; "New chat" uses `?fresh=1` to clear the persisted conversation.

Out of scope: keycap manifest schema (Hephaestus / ADR-010), kernel internals (Zeus), mesh comm (ADR-003), marketing copy (Apollo).

---

## 7. Files at a glance

```
packages/ctrl-web/src/
├── routes/
│   ├── irisy.tsx                       # surfaces 1 + 2 (mode-switched)
│   └── code-space.tsx                  # surface 3 host
├── components/
│   ├── irisy/
│   │   ├── IrisyChat.tsx               # surface 1 (997 LOC)
│   │   ├── CreatorShell.tsx            # surface 2 layout
│   │   ├── ChatPane.tsx · ManifestPreview.tsx · CodePreview.tsx · InstallBar.tsx · DiscardConfirm.tsx · PatiencePip.tsx
│   └── code-space/
│       └── CompanionPane.tsx           # surface 3 (257 LOC)
├── lib/
│   ├── llm-transport.ts                # ChatStreamTransport (chat_stream + irisy_chat_stream)
│   ├── irisy-tools.ts                  # frontend ReAct tool registry (12; +3 to add)
│   ├── irisy-prompts.ts                # .irisy-prompts/ bootstrap + loader
│   ├── irisy-memory.ts                 # surface 4
│   ├── irisy-llm-runner.ts             # creator-mode turn driver
│   ├── irisy-keycap-store.ts           # Zustand for creator
│   ├── irisy-keycap-slots.ts · irisy-keycap-zod.ts
└── personas/irisy/
    ├── code-companion.ts               # surface 3 system prompt
    └── keycap-creator.ts               # surface 2 system prompt + few-shots

src-tauri/src/commands/
├── irisy_chat.rs                       # irisy_chat_stream (BrainRouter → Pi MCP)
├── irisy.rs                            # irisy_init, irisy_chat_hermes [drift], irisy_upgrade_hermes [drift]
├── chat.rs                             # chat_stream (raw LLM)
├── code_space.rs                       # cs_spawn / cs_stdin / cs_signal / cs_resize / cs_kill / cs_list
├── kernel.rs                           # list_keycaps / install_keycap / install_keycap_from_mcp / run_keycap / mcp_call
└── vault.rs · memory.rs · …
```
