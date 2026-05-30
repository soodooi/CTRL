# CTRL — Product Requirements Document (SSOT)

> Single source of truth for CTRL's business + functional requirements.
> Anything not in this doc — or in the linked ADRs / brand tokens —
> is NOT a requirement. Anything that contradicts this doc loses.
>
> **Owner**: bao · **Last updated**: 2026-05-30 · **Status**: working draft;
> sections marked 🟡 are pending sign-off.

---

## 0. Reading guide

Conflict resolution priority (top wins):

1. **目标推进 / business intent** (this doc §1, §3)
2. **Hard rules** (`CLAUDE.md` §Rules)
3. **Design philosophy** (`CLAUDE.md` §Design Philosophy + `brand/brand-tokens.md`)
4. **ADRs** (`.olym/decisions/`)
5. **Implementation details / commits**

Each requirement here lists the authoritative source in `(brackets)`. Memory keys reference `~/.claude/projects/-Users-mac-Documents-coding-CTRL/memory/`.

---

## 1. Vision

CTRL = **AI-native ambient companion**. v1 ships as **a desktop companion that lives at the edge of your screen, summons whatever AI / tool / keycap you need on demand, and integrates with the apps you already have**.

It is **NOT** a "chat app". It is **NOT** a workflow editor. It is **NOT** a "full-screen takeover". It is a **right-panel deep expert** (Cursor / Microsoft Copilot lineage) hybridized with a **Cluely-style movable overlay** that does not interrupt your real work.

> "Press Ctrl. Get any AI tool." — without leaving your current window.

(source: `CLAUDE.md` §What is CTRL, `decision_ctrl_is_ai_workshop_not_chat`, session 2026-05-30 vision update)

---

## 2. Users

Global, English-first power users who work across many apps every day and pay for AI tools.

- Independent developers, indie founders, design / writing / consulting freelancers, prosumers.
- Heavy desktop users (6+ hr/day in browser, editor, notes, design tools).
- Already paying for ChatGPT Plus / Cursor / Notion / Anthropic API class subscriptions.
- macOS 13+ primary, Windows 10 1809+ supported.
- iOS 16.4+ / Android Chrome — PWA only, secondary.

Anti-persona: passive consumers, mobile-first users, anyone who never builds / writes / codes.

(source: `decision_ctrl_is_global_english_first`, attic PRODUCT.md, `CLAUDE.md` §Stack)

---

## 3. Positioning

| | CTRL is | CTRL is NOT |
|---|---|---|
| Form | **Edge companion**, alwaysOnTop, movable | App you open and live in |
| Trigger | **Lone-Ctrl tap** toggles show/hide | Click an icon |
| Default state | Narrow strip on the right edge, your work stays untouched | Full-screen takeover |
| When idle | Almost invisible (hot keycaps + idle Irisy) | Big chat history |
| Brain | **Pi** (single brain, locally configurable) | Multi-model switcher in UI |
| Storage | **Local-first markdown vault** (vim-compatible) | Cloud-only |
| Style | OP-1 / Linear / Raycast / Frank Chimero | Material / SaaS purple / Slack-cluttered |

(source: session 2026-05-30 vision, `decision_pi_is_sole_brain_hermes_is_keycap`, `brand/brand-tokens.md`)

---

## 4. Brand voice + anti-references

- **Industrial precision · understated · doesn't sell "AI"** like the Anthropic / Linear / Cursor lineage.
- AI is the pipe, not the marquee. (`decision_ctrl_obsidian_philosophy`)
- High-density typography, no fluff, no "supercharge your workflow" marketing slop.
- All product copy English. Chinese only in this doc / strategic markdown.

Anti-references (hard NO):

- ChatGPT 灰 + 紫 gradient SaaS templates
- Material Design (too Google)
- Anthropic 橙 (taken)
- ChatGPT 灰 (too neutral, no identity)
- iCloud / SwiftUI default blue (no differentiation)
- iOS 26 Liquid Glass default palette
- Hero metric SaaS templates
- Emoji-as-icon Slack/Notion path (CTRL uses Lottie / SVG-from-manifest)
- AI tech-blue `#57a6ff` (replaced by brand cobalt `--ctrl-blue`)

(source: `attic/PRODUCT.md`, `brand/brand-tokens.md` §1-2, impeccable audit 2026-05-29)

---

## 5. Layout model 🟡

CTRL has **3 window states** (pending sign-off; replaces the earlier 5-col model):

```
       Ctrl key (lone-Ctrl tap)
HIDDEN ◀────────────────────▶ COMPANION (494 × 100vh, right edge)
                                │
                                │ User clicks an L1 route / L2 / KeycapNav;
                                │ Irisy programmatically requires more room
                                ▼
                              EXPANDED (window grows leftward,
                                       1800 × 642 default, resizable)
                                │
                                │ User closes the last left-side panel
                                ▼ auto → COMPANION
```

### 5.1 HIDDEN

- Window not visible, tray icon present.
- Lone-Ctrl tap → COMPANION.
- Per `.olym/decisions/001-system-architecture.md` lone-Ctrl is the only chord.

### 5.2 COMPANION (default first-launch state)

- **494 px wide × 100vh tall**, pinned right edge of the primary screen.
- `alwaysOnTop ✓ · visibleOnAllWorkspaces ✓ · decorations: false`.
- Internal stack (top → bottom):
  - StatusBar (32 px, drag region, status zone)
  - Hot keycaps single row (6 keycaps; fades out on first text-input keystroke)
  - Irisy chat (message stream, idle = welcome / persona)
  - Text input box (separated from chat; switchable context: `assist` ▾ / `create` / future)
  - L1 nav (right edge, 64 px, icon-only) — per `feedback_right_rail_is_fixed`

(source: session 2026-05-30 "Irisy 可以伴随" + Cluely / Raycast research)

### 5.3 EXPANDED (on-demand wide state)

- Window grows leftward; companion strip stays anchored right.
- Width `clamp(960, 70vw, 1800) px`, height resizable.
- Left side renders:
  - Route content (Pool / Vault / Workbench / Coding / Settings / Workspace)
  - L2 panel (collapsible)
  - KeycapOutputPane (secondary dialog row, 240 px bottom)
- Per Raycast technique: WKWebView pre-renders at expanded size in companion mode to avoid flicker.

### 5.4 Auto-shrink

When user closes the last left panel (no route content, no L2, no output pane) → window animates back to COMPANION.

🟡 Pending sign-off: companion default 494; expand max 1800; auto-shrink behavior.

---

## 6. Core functional surfaces (preserved features)

Every surface below is a confirmed feature; this doc records its current home and behavior. **None are dropped without bao's explicit approval.**

### 6.1 StatusBar

- Top, full width, 32 px.
- Left → right: `[KRN ●] [ENGINE: <brain>] [MCP: N] [VAULT: N]` · spacer · `[clock] [×]`.
- Drag region for the frameless window.
- KRN LED click on degraded → /settings.
- ENGINE pill click → /settings/brain.
- × hides window (fallback when Ctrl hotkey desyncs after AX permission change).

(source: `commands/system.rs` `kernel_status`, session 2026-05-30 status zone)

### 6.2 L1 nav (primary navigation)

- 64 px icon-only column, right edge in COMPANION, same position in EXPANDED.
- Fixed items, order preserved (`feedback_right_rail_is_fixed`):
  - Home (`/`)
  - Coding (`/coding`)
  - Workbench (`/workbench`)
  - Vault (`/vault`)
  - Pool (`/pool`)
  - Settings (`/settings/ctrl`)
- L2 expand/close toggle pinned at the top of L1.
- Click an item → if EXPANDED already, swap route in left content; if COMPANION, animate to EXPANDED with that route.

### 6.3 L2 panel

- Width: `0 px closed` / `240 px open`.
- Opens between L1 and the left content in EXPANDED mode.
- Per-L1-item descriptor registry (`useL2` hook).
- Default content per route is empty hint; routes register what to show.

### 6.4 Keycap area

Three surfaces, same underlying data:

| Surface | Where | Form | Notes |
|---|---|---|---|
| Hot keycaps row | COMPANION top | Single row, 6 cells | Auto-fades when user types in the text input |
| Full keycap grid | `/pool` route (EXPANDED) | 4×4 grid + scenario + page dots | Today the `Keyboard` component |
| Keycap output | KeycapOutputPane in dialog row | Live cell stream during a run | Already wired (`keycap-output-store`) |

Drag-and-drop a keycap onto the main area → opens that keycap's workspace instance (already wired in `app.tsx`).

(source: `project_keyboard_vs_pool`, `decision_keycap_workbench_composition_model`, current `Keyboard.tsx`)

### 6.5 Irisy chat

- Mobile-chat density (font 15 px, line-height 1.5, bubble radius 16 px, gap 10 px, padding 9 × 13 px).
- Right-side bubble = user (cobalt accent, paper text).
- Left-side bubble = assistant (bg-l2, ink text); rewraps markdown.
- Welcome state when empty.
- "Clear" affordance in a thin header when there is history.
- Lottie blink for Irisy mascot (`feedback_irisy_blink_lottie_baked`) — when the mascot is shown.

(source: `IrisyChat.tsx`, session 2026-05-30 mobile-grade redesign)

### 6.6 Text input box (separated from chat) 🟡

- Standalone box at the bottom of the Irisy column (own border, own background).
- Behavior:
  - `<textarea>` auto-grows from 38 px to 160 px (then scrolls).
  - Enter = send. Shift-Enter = newline. IME composition guard for CJK.
  - 16 px font (iOS Safari auto-zoom floor).
  - Send button = 28 × 28 circular icon, absolute inside the input wrap (Telegram / Doubao / Kimi convention).
- **Switchable context** (▾ left of the input):
  - `assist` (default Irisy.assist persona)
  - `create` (Irisy.create — keycap creation mode)
  - Future: per-keycap context

🟡 Pending sign-off: exact set of switch targets beyond `assist` / `create`.

(source: session 2026-05-30 "对话框跟文本框分开", Cluely input/output separation pattern)

### 6.7 KeycapNav (副 L1) 🟡

- 64 px icon column.
- Visible only in EXPANDED mode (hidden in COMPANION per "minimal default").
- Default contents:
  - Browse pool (→ `/pool`)
  - Create keycap (→ `/irisy?intent=create-keycap`)
- Reserved for future keycap-management actions.

🟡 Pending sign-off: keep in v1, or fold its items into L1?

### 6.8 Secondary dialog row (KeycapOutputPane)

- Visible only in EXPANDED mode.
- 240 px tall, spans the Irisy + KeycapNav width on the right.
- Default content: live keycap-run output (`useKeycapOutputStore`).

### 6.9 Version pill

- Bottom-left of the main display area.
- Shows `v<APP_VERSION>` and a green dot when an update is available.
- Click = check + install + safe-relaunch in one shot.
- Survives across routes (mounted at shell level).

(source: `VersionPill.tsx`, 0.1.66 restructure)

### 6.10 Hide button (×)

- Top-right of StatusBar.
- Calls `hide_window` Tauri command.
- Fallback when lone-Ctrl hotkey state desyncs.

---

## 7. Routes (all preserved)

| Path | Content | Mode shown |
|---|---|---|
| `/` | Empty paper / cockpit welcome | COMPANION + EXPANDED |
| `/pool` | Full keycap grid + Pool browser | EXPANDED |
| `/vault` | Vault file browser + viewer | EXPANDED |
| `/workbench` | React Flow keycap composition canvas | EXPANDED |
| `/coding` | Coding companion (code-space stack) | EXPANDED |
| `/code-space` + `/code-space/$envId` | Remote envs list + detail | EXPANDED |
| `/workspace` | Multi-instance workspace shell | EXPANDED |
| `/settings/ctrl` `/settings/brain` `/settings/logs` | Settings tabs | EXPANDED |
| `/irisy?intent=create-keycap` | Creator shell (chat + manifest + code + install bar) | EXPANDED |
| `/irisy` (no intent) | Renders KeycapOutputPane when a run is active, else hint | EXPANDED |
| `/icon-lab` | dev-only icon engine bake-off | dev only |

(source: `app.tsx` route registry; all kept)

---

## 8. Irisy modes 🟡

> Replaces / refines `decision_one_persona_irisy` per session 2026-05-30.

Irisy has **two product modes**, both Irisy (same brand, same mascot), but distinct context the input box switches between:

| Mode | Purpose | Backing |
|---|---|---|
| `Irisy.assist` (default) | Personal assistant, free-form chat | Active brain (Pi / claude_code / volc) |
| `Irisy.create` | Keycap creator | `/irisy?intent=create-keycap` route + `irisy-keycap-store` |

Persona = visual + behavioral wrapper. v1 = one Irisy mascot, two prompt templates. **Not** a multi-character picker.

🟡 Pending sign-off: does v1 also include `Irisy.coding` (terminal companion per `decision_irisy_as_coding_companion`) as a third switcher target, or stays under `assist`?

(source: `decision_primary_companion_name_irisy`, session 2026-05-30 modes)

---

## 9. Keycap model

### 9.1 Protocol = MCP

All keycaps use MCP as the inter-process protocol (per `decision_keycap_protocol_is_mcp`).

### 9.2 Adjustment tiers

Three tiers per `decision_keycap_3_tier_adjustment`:

- **Config** — user fills `config_schema` fields, upstream syncs cleanly.
- **Patch** — override layer; can still cherry-pick upstream.
- **Fork** — fully independent.

90% of users live in Config + Patch.

### 9.3 Composition

Per `decision_keycap_workbench_composition_model`:

- Workbench = node-editor (React Flow) for composing keycaps modularly.
- I/O default = JSON + JSON Schema (aligns with MCP).
- Single-keycap 3 operations: Pool → Keyboard / click → Workspace / drag into new workspace = compose.

### 9.4 Base substrate vs functional keycaps

Per `decision_keycap_base_vs_functional_layer`:

- **Base** = LLM adapters, Vault, brain switcher, shell — not keycaps.
- **Functional** = OCR, translate, snip, etc. — keycaps that stand on base.
- Base ships ready before functional keycap dev starts.

---

## 10. Brain

- **Pi is the sole brain** (`decision_pi_is_sole_brain_hermes_is_keycap`, hermes deleted PR #62).
- Active brain configured via `~/.ctrl/active-brain` file (today defaults to `claude_code` per the running config; can be `pi` / `volc` / `gemini` / `codex`).
- Surfaced in the StatusBar `ENGINE:` pill and in `kernel_status` API.
- Irisy long-term memory lives in `vault/irisy/SOUL.md` + `.irisy-memory/` per the same ADR.

---

## 11. LLM providers

Per `decision_ai_providers_are_kernel_capabilities`:

- Kernel exposes typed capabilities: `text.chat`, `image.generate`, `audio.tts`, …
- Keycaps consume these capabilities, **never bind to a specific provider**.
- v1 launch provider = Volc (1 BYOK unlocks 9 capabilities).
- Pattern D (`CLAUDE.md`):
  - Default = subscription quota (Volc / Qwen / Llama via CF Workers AI)
  - BYOK advanced = Anthropic Claude / OpenAI GPT-4
  - Privacy tier = local Ollama

CTRL sells tools + platform, **not** models.

---

## 12. Vault

Per `decision_vmark_not_substrate_use_open_stack`:

- **Tiptap** — markdown WYSIWYG + source toggle
- **CodeMirror 6** — code / JSON / YAML / TOML / HTML
- **mermaid.js** — diagrams
- **iframe + CSP** — HTML sandbox
- **SQLite FTS5** — index, backlinks, tag scanner (kernel `vault_index.rs`)

Layout: user-chosen (flat / by-day / by-entity); CTRL ships defaults but does not hardcode.

vim test (`decision_ctrl_obsidian_philosophy`): every new capability must pass — open the vault in vim and the value is still there.

---

## 13. Mesh / sync

ADR-003:

- **vodozemac** (Olm 1:1)
- **webrtc-rs v0.17.x**
- **Automerge v0.7.x** (CRDT)
- **mdns-sd v1.71+** (local discovery)
- **ctrl-relay** CF Worker (outbound WSS only; **zero listening ports** for cross-device on user machines)

P2P first, ctrl-relay is augmentation. CTRL functions fully without ctrl-cloud.

---

## 14. External app integration 🟡

Per session 2026-05-30: **prefer user's own apps; do not re-render content CTRL doesn't own**.

| Content / intent | CTRL behavior |
|---|---|
| Open a URL | macOS LaunchServices → user's default browser |
| Open a markdown file | LaunchServices → user's Markdown / Notes app |
| Open a CAD / Blender file | LaunchServices → user's CAD / Blender |
| Open a vault image | Optional: CTRL-native ImageViewer in left panel |
| Run a keycap | CTRL-native execution + KeycapOutputPane |

Hooks reserved in v1 (not implemented yet):

- Text input `@app` mention → user's installed apps list
- Left-panel viewer wrappers for content types CTRL renders natively

🟡 v1 ships hooks + Browser / Notes integration only. CAD / Blender / accounting / etc. = v1.x.

---

## 15. Updater

- Endpoint: `https://github.com/soodooi/CTRL-releases/releases/latest/download/latest.json` (`tauri.conf.json` plugins.updater).
- Pubkey: minisign Ed25519 (`tauri.conf.json` plugins.updater.pubkey).
- **macOS safe-relaunch** (0.1.69) — Rust command `safe_relaunch_after_update` runs Chrome / Cursor / Linear pattern: detached `sh` helper waits for current PID to die, then `open`s the new bundle via LaunchServices. Avoids the Tauri 2 `relaunch()` race with single-instance plugin.
- **Poll interval** 60 s in active dev (`UPDATE_POLL_MS` in `app-meta.ts`).
- Click the bottom-left version pill = check + download + safe-relaunch in one shot.
- AX permission preserved across upgrades when the auto-updater path is followed (`feedback_always_use_upgrade_path`).

---

## 16. Brand tokens

Source of truth: `brand/brand-tokens.md` v0.2 + `packages/ctrl-web/src/styles/tokens.css` v0.5.

- **Color**: OKLCH; cobalt blue `--ctrl-blue oklch(0.50 0.20 252)` brand; warm amber + jade + platinum + graphite keycap palette; polar-white `--paper`. Never `#000`/`#fff` raw.
- **Theme**: light is default (`decision_ctrl_light_theme_default`); dark via `[data-theme='dark']` opt-in, no `prefers-color-scheme` auto-switch.
- **Typography**: Inter + JetBrains Mono variable, self-hosted woff2 subset.
- **Spacing**: 4 px base scale tokens.
- **Radius**: `--radius-lg: 12 px` is the canonical keycap corner (locked).
- **Shadows**: 4-tier shadow scale tuned for light surfaces.
- **Motion**: ease-out-quart for chrome (instant / fast 150 / normal 220 / slow 380 ms). Decoration tier reserved for Irisy mascot only.

Anti-pattern: hex literals outside `tokens.css`. (impeccable audit 0.1.66 wiped 140 sites; keep it at zero.)

---

## 17. Anti-references / out-of-scope

From `CLAUDE.md` §What CTRL is NOT, locked:

| Don't | Why |
|---|---|
| Workflow editor | Coze / n8n already exists |
| Build our own hardware | Solo + wrong capital |
| 100+ long-tail platform adapters | ST-SS lets creators integrate; we don't write them all |
| Quicker 8000-keycap clone | Can't win |
| ChatGPT GPTs integration | API isn't open |
| Share mamamiya user data | Independent D1 |
| Multi-tenant SaaS | That's pandagooo, not CTRL |

Plus this session (2026-05-30):

| Don't | Why |
|---|---|
| AI-companion-as-pet (Loona / HoloWaifu / UnityChan) | We are professional tooling, not desktop pets |
| Center-stage chat-takeover (ChatGPT desktop, Pi.ai) | We accompany work, we don't replace it |
| Bottom-right corner widget | 4 % click rate; rots in the corner |

---

## 18. Non-functional requirements

| # | Rule | Source |
|---|---|---|
| NFR-1 | All product code (TS / Rust / CSS / JSX strings) is English; Chinese only in `.md` docs and chat with bao | `feedback_code_strings_english`, `CLAUDE.md` §Rules |
| NFR-2 | No mock data on production paths; routes hit real backends | `feedback_no_mock_data_in_production` |
| NFR-3 | One SSOT per concept; adding a replacement retires the old in the same PR | `feedback_no_redundancy_one_ssot` |
| NFR-4 | No hardcoded secrets; Keychain / env only | `CLAUDE.md` §Rules + memory `reference_cf_api_token` |
| NFR-5 | Cargo.lock + package-lock.json checked in | `CLAUDE.md` §Rules |
| NFR-6 | Never `--no-verify` on git hooks | `CLAUDE.md` §Rules |
| NFR-7 | No cross-D1 JOIN | `CLAUDE.md` §Rules |
| NFR-8 | All `@ctrl/*` packages `private: true` + `license: UNLICENSED`; never publish to public npm | `CLAUDE.md` §Rules |
| NFR-9 | Tauri auto-updater path is the canonical upgrade; manual `cp -R` breaks AX permissions | `feedback_always_use_upgrade_path` |
| NFR-10 | Pre-existing kernel capabilities reused before adding new ones | `feedback_reuse_existing_capability_first` |
| NFR-11 | No planning / phasing language to bao ("v1 / v1.1 / 简版 / 完整版") | `feedback_no_planning_no_phasing` |
| NFR-12 | No splitting one ship goal into ≥3 fine-grained sub-tasks | `feedback_dont_split_tasks_finely` |
| NFR-13 | Lane discipline: stay in lane, no role switching | `feedback_stay_in_lane_dont_switch_roles` |
| NFR-14 | Light-theme default; dark opt-in via `[data-theme='dark']` | `decision_ctrl_light_theme_default` |
| NFR-15 | 80 % test coverage minimum on new code (per ECC) | `~/.claude/rules/ecc/common/testing.md` |
| NFR-16 | Window dimensions documented here, not invented in code | this doc §5 |

---

## 19. Live tech stack (mirrors `CLAUDE.md`)

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2 (~500 LOC Rust) |
| Kernel (L1) | Rust 1.77+, Tokio, ST-SS WS @ 127.0.0.1:17872 token-auth |
| Sandbox | OS-level subprocess isolation (sandbox-exec / landlock / AppContainer) + Tauri 2 capability + isolation pattern + CSP |
| UI | React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa |
| Vault viewers | Tiptap + CodeMirror 6 + mermaid.js |
| Vault index | SQLite FTS5 + backlink + tag scanner |
| Brain | Pi (`@pi/coding-agent`, MIT, lazy npm install) |
| Web ↔ Rust | Tauri 2 `invoke()` (desktop) + WS + token (mobile) |
| Stream | ST-SS (CBOR Cell / Op) |
| Package mgr | npm workspaces |
| State persistence | SQLite (event-sourced) + Automerge CRDT |
| Mesh | vodozemac + webrtc-rs + Automerge + mdns-sd + ctrl-relay CF Worker |
| LLM default | CF Workers AI |
| LLM BYOK | Anthropic / OpenAI |
| MCP | rmcp Rust SDK |
| Backend (cloud) | CF Workers + D1 (ctrl-auth / billing / market / relay / push) |
| Payments | Stripe |
| Min macOS | 13.0 |
| Min Windows | 10 1809 |
| Mobile | Pure browser PWA (no React Native, no Capacitor) |
| Node | 20.x LTS · Rust 1.77+ stable |
| Binary size | kernel ≤ 18 MB, installer ≤ 25 MB default |
| PWA bundle | ≤ 500 KB gzip, critical-path shell ≤ 200 KB |
| Local ports | 0 listening for cross-device; 127.0.0.1:17872 token-auth for intra-device PWA mobile mode |

---

## 20. Decision log (cross-references)

ADRs and memories that supply requirements above; this list is non-exhaustive but covers the ones cited.

**ADRs**:

- `.olym/decisions/001-system-architecture.md` — 5 kernel primitives + window roles
- `.olym/decisions/002-pwa-pivot.md` — Tauri 2 + PWA UI layer
- `.olym/decisions/003-mesh.md` — cross-device transport

**Locked memories**:

- `feedback_always_use_upgrade_path`
- `feedback_minimal_docs_brainstorm_in_dialog`
- `feedback_stay_in_lane_dont_switch_roles`
- `feedback_no_unilateral_downgrade`
- `feedback_no_overdesign`
- `feedback_right_rail_is_fixed`
- `feedback_irisy_blink_lottie_baked`
- `feedback_no_mock_data_in_production`
- `feedback_dont_split_tasks_finely`
- `feedback_no_planning_no_phasing`
- `feedback_reuse_existing_capability_first`
- `feedback_no_redundancy_one_ssot`
- `feedback_build_system_not_business`
- `feedback_verify_runtime_not_design`
- `feedback_code_strings_english`
- `feedback_no_claude_in_production`

**Decisions**:

- `decision_ctrl_is_global_english_first`
- `decision_ctrl_is_ai_workshop_not_chat`
- `decision_ctrl_obsidian_philosophy`
- `decision_ctrl_lean_substrate_scheduler_executor_tools`
- `decision_pi_is_sole_brain_hermes_is_keycap`
- `decision_keycap_protocol_is_mcp`
- `decision_keycap_3_tier_adjustment`
- `decision_keycap_base_vs_functional_layer`
- `decision_keycap_workbench_composition_model`
- `decision_one_persona_irisy` (superseded in part by §8 here)
- `decision_irisy_keycap_lifecycle`
- `decision_irisy_as_coding_companion`
- `decision_irisy_is_pwa_native_not_keycap`
- `decision_irisy_to_hephaestus` (historical; current owner per session)
- `decision_pwa_two_panel_layout` (superseded by §5 COMPANION / EXPANDED)
- `decision_pc_mirrors_mobile_layout`
- `decision_ctrl_native_ux_over_vmark_delegation`
- `decision_ctrl_light_theme_default`
- `decision_ai_providers_are_kernel_capabilities`
- `decision_vmark_not_substrate_use_open_stack`
- `decision_remote_co_view_is_irisy`
- `decision_first_run_asset_prompt_ok`

---

## 21. Change log of this doc

| Date | Author | Change |
|---|---|---|
| 2026-05-30 | claude (with bao) | Initial consolidation — derived from CLAUDE.md, memories, attic PRODUCT.md, brand tokens, and session 2026-05-30 vision update (Irisy companion + COMPANION/EXPANDED states + text-input separation + external-app preference). §5, §6.6, §6.7, §8, §14 marked 🟡 pending bao sign-off. |
