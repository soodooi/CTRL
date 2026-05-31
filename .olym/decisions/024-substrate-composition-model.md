---
adr_id: 024
title: Substrate composition model — keycap = manifest binding 6 axes (incl. cap-asset; persona folded in); multi-modal brain; dispatch unification
status: proposed
date: 2026-05-30
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/004-kernel-capability-surface.md       # this ADR amends + accepts
  - .olym/decisions/005-no-claude-in-production-runtime.md
  - .olym/decisions/010-keycap-execution-model.md          # this ADR amends (schema convergence)
  - .olym/decisions/011-update-channel-and-delivery.md
  - doc/keycap-integration-research/00-inventory-and-abstractions.md
  - doc/keycap-integration-research/06-jiazuo-result.md
  - doc/brainstorm-workbench-flexibility-2026-05-26.md
  - doc/keycap-ideas-record.md
scope: framework
module: substrate
---

## Context

The substrate model has coherent pieces but **no single load-bearing law**. Six artifacts each hold a fragment:

| Artifact | Date | Holds |
|---|---|---|
| ADR-010 (accepted) | 2026-05-17 | Keycap **execution** law — MCP outward, Actor inward, 7 patterns A-G |
| ADR-004 (proposed) | 2026-05-22 | Kernel **capability surface** draft — 10 ns / 28 methods / frequency ≥3 rule. **Awaiting accept for 8 days.** |
| Spike 06 RESULT | 2026-05-19 | 100-row keycap × capability consumption evidence; bucket projection (`image.*`, `audio.*`, `process.*`, `oauth.*`, `stss.*` listed v1.1 candidates) |
| 00-inventory | 2026-05-22 | 71 keycap inventory; **4 schema drifts located** (spec v0.1 / sdk.ts / pwa zod / 16 builtin actual); 5 frontend + 5 substrate dispatch asks |
| brainstorm-workbench | 2026-05-26 | 10 G gap + 4-lane reorg + 终端定位 framework |
| keycap-ideas-record | 2026-05-16/22 | 46 community / research intent with pattern tags |

Symptoms accumulating in May 28-30 session, all rooted in the same fragmentation:

1. **Bao said "我一直不理解你说的 kernel"** — six docs use the word inconsistently (ADR-001's 5 primitives vs ADR-004's 10 namespaces vs lean-substrate memory's "runtime / loader"). No single anchoring statement.
2. **Irisy explains internal layers in chat** ("Volc 是 LLM, Claude 是 brain") because `kernel_status` returns `kernel_llm.adapter: string` (singular default) while active brain selection is a separate field — the API forces Irisy to dump both, the user perceives a contradiction.
3. **Bao said "做海报得有 image 大模型; 我们是双重 brain"** — poster keycap requires `image.generate`, which spike 06 §Q2.11 listed as v1.1 candidate. Without promoting it, the 1st multi-modal keycap is blocked.
4. **"每条 keycap 一条管线"** (00-inventory §3) — `classify_seed()` hardcoded 4 match arms; rest fall through Stub. PWA `KeycapCard` lacks dispatch. Schema drifts across 4 files. Every new keycap = hand-stitching in 4 places.

ADR-024 = the synthesis. **Single law. Single SSOT. Single user-facing vocabulary.**

## Decision

### 1. Substrate composition law (single load-bearing statement)

A **Keycap manifest** is a complete declaration across **6 substrate axes** (§2). At install time the runtime atomically provisions all declared resources — bundled files + vault folder — so the keycap is day-1 functional with no first-run wizard (bao 2026-05-30: "前期 keycap 都要全部创建该 keycap 的 assets ... 也要有 vault"). At execution time the runtime resolves manifest → activates substrate bindings.

The runtime (formerly "kernel" in some docs) is the loader; **the user-facing concepts are 底座 (capability namespaces + provider registry) · 键帽 (manifest binding) · Irisy (the conversational layer)**.

**Irisy is the user-perceived AI total** — single identity name that the user sees everywhere. Its physical implementation = the currently-active keycap's persona instance. Switching keycaps = Irisy quietly swaps her persona; the UI never exposes "you are talking to assist keycap". `builtin/assist` and `builtin/create` are keycaps with the same manifest shape as user keycaps (collapses ContextProfile and Keycap into a single abstraction). This reconciles memory `decision_irisy_is_pwa_native_not_keycap` (Irisy = first-class PWA page, true) with the implementation truth (Irisy's voice = active keycap's persona, also true) — different layers of the same fact.

**Builtin / user keycap = zero architectural difference, only a metadata flag**:
- `manifest.builtin = true` → shipped in `packages/ctrl-keycaps/builtin/<id>/` (source) → bundled into `<bundle>.app/Contents/Resources/keycaps/builtin/<id>/` at build → seeded into `~/.ctrl/keycaps/<id>/` on every launch. App self-repairs deleted builtins.
- `manifest.builtin = false` → user-installed under `~/.ctrl/keycaps/<id>/`, uninstall is permitted.

**Relationship to memory `decision_ctrl_lean_substrate_scheduler_executor_tools` (bao 2026-05-28 "底座 ≠ 重型 kernel")**: ECC review H2 (2026-05-30) flagged tension. ADR-024 is **not** "more kernel framework" — it is the *composition contract* (what a keycap declares + how the loader resolves it) that the lean substrate must serve. The lean substrate stays = `scheduler` (brain-side) + `executor` (subprocess + mcp_host + sandbox) + `self-describing tools` (skill / MCP / CLI). ADR-024 only stabilizes the **manifest schema** these talk through. If implementation of ADR-024 ever requires "more kernel" (a custom runtime, a new in-process VM, a metadata service, etc.), that's a signal the ADR over-reached and should retreat. The 6 axes are *declarations*, not new kernel responsibilities.

### 2. The 6 substrate axes

Each keycap manifest declares (all optional except `pattern`). Axes 1-5 are **runtime bindings** (what the keycap needs to execute); axis 6 — `cap_asset` — is **install-time provisioning** (what filesystem state the keycap brings into existence at install + carries as immutable resources). Persona is **not a separate axis** — it lives inside `cap_asset.files` as a per-keycap markdown (sign-off: bao 2026-05-30 "你还不如助理也是一个 keycap 逻辑更加清晰", reasoning: shared persona library = npm-style indirection that fights vim-test; each keycap self-contained).

| # | Axis | Source | What it does |
|---|---|---|---|
| meta | `pattern` | one of `A` / `B` / `C` / `D` / `E` / `F` / `G` (ADR-010) | Routes execution: G→StepEngine, D→MCPServerActor, B/C→SubprocessActor, E→OAuthCapability, F→ST-SS bridge, A→HTTP+Step |
| 1 | `capabilities` | subset of the 8 kernel namespaces (ADR-004) | Declares which kernel calls are allowed; kernel gates at call site. **Two distinct concerns**: (a) **what kernel calls** the keycap may issue (e.g. `clipboard.read`, `network.http`); (b) **what filesystem regions** it may touch via `file.read_allowlist` / `file.write_allowlist` — this is separate from `cap_asset.vault.path`. Example: `builtin/assist` has `file.read_allowlist = ["${vault_root}/*"]` so Irisy can read the whole vault; its `cap_asset.vault.path = "keycaps/assist/"` is only where assist *writes* its own state. Read scope and write scope are independent. |
| 2 | `brain_capabilities` | typed multi-provider requirements (see §3) | Declares which LLM modalities this keycap needs; runtime resolves to active provider per-capability |
| 3 | `mcp_servers` | for Pattern D | List of 3rd-party MCP server bindings (spawn args + tool allowlist) |
| 4 | `skills` | list of SKILL.md references resolved via the **3-tier lookup chain** (see §3.5) | Recipes the brain reads as context. CTRL skill format = Claude Code SKILL.md compatible superset; keycap can reference ECC plugin skills, vault user skills, or its own bundled skills uniformly |
| 5 | `ui_surface` | one of 9 enum (00-inventory §5 A1) | `none / notification / modal / clipboard / html-output / chat-stream / picker / form / canvas` — PWA WorkspaceUiDispatch registry routes |
| **6** | **`cap_asset`** | **install-time provisioning bundle** | **Two sub-fields.** `cap_asset.files` = static bundled files (**icon, persona.md, templates, seed prompts, sample data**) copied to `~/.ctrl/keycaps/<id>/assets/` at install (immutable; `manifest.builtin=true` keycaps re-copy from `packages/ctrl-keycaps/builtin/<id>/` (dev) or `<bundle>/Contents/Resources/keycaps/builtin/<id>/` (installed)). `cap_asset.vault` = user-facing folder reservation under `~/Documents/CTRL/keycaps/<id>/` with seed sub-folders + seed README/settings files (user-editable, plain-text per ADR-015, mesh-synced per ADR-003). **User override path**: `vault/keycaps/<id>/persona.md` (if exists) overrides `assets/persona.md` — one lookup, no global persona library. |

**Install-time provisioning rule** (binding for all 前期 keycaps): when a keycap is installed, the runtime MUST atomically:
1. Copy all `cap_asset.files` into `~/.ctrl/keycaps/<id>/assets/` (preserves declared directory structure).
2. Create the vault folder at `${vault_root}/keycaps/<id>/` (= `cap_asset.vault.path`), create all `cap_asset.vault.seed` sub-folders, write all seed files (frontmatter + content per manifest).

If either step fails → install fails (atomic, no partial state). The keycap is "day-1 ready" with no first-run wizard required (bao 2026-05-30: "前期 keycap 都要全部创建"). Mesh sync (ADR-003) follows `${vault_root}/keycaps/<id>/`; nothing in `assets/` (immutable, replicated from manifest) is synced.

**Example: poster keycap manifest (showing all 6 axes + pattern meta)**:

```toml
[keycap]
id = "poster"
label = "Poster"
pattern = "G"

# Axis 1 — kernel capabilities
[capabilities]
file = { write_allowlist = ["${cap_asset.vault.path}/outputs"] }

# Axis 2 — brain capabilities (multi-modal: text + image)
[brain_capabilities."text.chat"]
provider_pin = "any"
[brain_capabilities."image.generate"]
provider_pin = "doubao-seedream"   # poster-specific image quality lock
[brain_capabilities."image.edit"]
provider_pin = "any"

# Axis 3 — MCP servers (none for Pattern G)
# (omitted)

# Axis 4 — skills (resolved via 3-tier lookup, §3.5; ECC-compatible format)
skills = ["poster-template", "composition-rules"]

# Axis 5 — UI surface
ui_surface = "canvas"

# Axis 6 — cap-asset (install-time provisioning; persona lives inside files)
[cap_asset.files]
# Static bundled files; copied immutably to ~/.ctrl/keycaps/poster/assets/
items = [
  { src = "icon.svg",                  dest = "icon.svg" },
  { src = "persona.md",                dest = "persona.md" },          # ← Irisy's voice for THIS keycap
  { src = "templates/minimal.svg",     dest = "templates/minimal.svg" },
  { src = "templates/editorial.svg",   dest = "templates/editorial.svg" },
]

[cap_asset.vault]
# User-facing folder under ~/Documents/CTRL/keycaps/poster/; mesh-synced
path = "keycaps/poster/"
seed = [
  { dest = "README.md",        content_inline = "# Poster keycap\n\nGenerated posters land in `outputs/`.\nDrop reference images into `inputs/`.\n" },
  { dest = "outputs/.gitkeep" },
  { dest = "inputs/.gitkeep" },
]
```

Runtime path resolution at execution time:
- `${cap_asset.files.path}` → `~/.ctrl/keycaps/poster/assets/`
- `${cap_asset.vault.path}` → `~/Documents/CTRL/keycaps/poster/`

### 3. Multi-modal brain (typed capability registry)

Replace the singular `kernel_llm.adapter` field with a **per-capability typed registry**:

| Capability | v1 status | v1 consumers in top-15 keycap |
|---|---|---|
| `text.chat` | v1 ✓ | 14 / 15 keycaps |
| `text.embed` | v1.1 → keycap-local for 智识 v1 | 智识 RAG (kept keycap-local for v1) |
| `text.transform` | v1 ✓ (10 ops enum) | base64 / urlencode / json / case / etc. |
| `text.template` | v1 ✓ (merged into transform) | markdown-quote / heading / codeblock |
| **`image.generate`** | **promote v1.1 → v1** | **Poster keycap (1st consumer); enables multi-modal substrate** |
| **`image.edit`** | **promote v1.1 → v1** | Poster refinement |
| **`image.understand`** | **promote v1.1 → v1** | OCR (replaces keycap-local `image.ocr` in spike 06); PDF visual pages |
| **`audio.stt`** | **promote v1.1 → v1** | 会议 (transcription); accessibility |
| `audio.tts` | v1.1 (defer until 2nd consumer) | accessibility roadmap only |

**Four promotions** (image.generate / image.edit / image.understand / audio.stt) move from spike 06's v1.1 candidate list into the v1 kernel surface. ECC review H1 (2026-05-30) correctly flagged that three of these (image.generate, image.edit, audio.stt) have only ONE v1 consumer apiece, violating ADR-004's load-bearing "frequency ≥3 = kernel" rule. **ADR-024 explicitly amends ADR-004** to add a third exception alongside the existing two (`mcp.*` infrastructure + `platform.notify`):

> **Category exception**: when a *category* of brain capabilities (text/image/audio/embedding/...) is needed for v1 keycaps, all members of that category enter the kernel surface together — even if individual members have only 1 consumer. Rationale: a "what AI can do" surface that ships text without image / audio is incoherent to the user ("做海报得有 image 大模型 — 我们是双重 brain", bao 2026-05-30). The frequency rule still governs non-brain kernel namespaces (clipboard, file, network, etc.).

Multi-modal brain capabilities are a category exception. The frequency rule is preserved for everything else. ADR-004 must add a Changelog entry recording this amendment when its own status flips to accepted.

**Provider Capability Registry**: each provider manifest (`~/.ctrl/providers/<id>/manifest.toml` + builtin) declares which capabilities it serves:

```toml
# Example: provider/volc/manifest.toml
[provider]
id = "volc"
label = "Volc Engine (Doubao)"
[capabilities]
"text.chat" = { models = ["doubao-1-5-pro-256k"] }
"text.embed" = { models = ["doubao-embedding"] }
"image.generate" = { models = ["doubao-seedream-v2"] }
"image.edit" = { models = ["doubao-seedream-edit"] }
"audio.tts" = { models = ["doubao-tts"] }

# Example: provider/anthropic-cli/manifest.toml
[provider]
id = "claude-cli"
label = "Claude Code (subscription)"
command = "claude"
[capabilities]
"text.chat" = { models = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"] }
"image.understand" = { models = ["claude-vision-*"] }
```

Runtime builds a reverse index `capability → [providers]`. Manifest may declare `brain_capabilities.text.chat = { provider_pin = "claude-cli" }` to lock; absent → fallback chain per ADR-011 (Volc → BYOK → Ollama).

**`kernel_status` API change** (replace singular `kernel_llm.adapter: string`):

```json
{
  "active_providers": {
    "text.chat": "claude-cli",
    "text.embed": null,
    "image.generate": "volc",
    "image.understand": "anthropic",
    "audio.stt": null,
    "audio.tts": null
  },
  "mcp_servers_installed": 2,
  "vault_files": 3
}
```

Eliminates the "Volc 是 LLM" / "Claude 是 brain" perceived contradiction — they are different capabilities, both can be active simultaneously, both surfaced as one structured table for Irisy to read (and to render as InfraBar chips, not as chat prose).

### 3.5 Skills — 3-tier lookup chain (ECC compatible superset)

CTRL skill format = **Claude Code SKILL.md compatible superset** (same frontmatter shape; CTRL may add optional extensions but Claude Code can ignore them). A keycap manifest references skills by id (`skills = ["poster-template", "composition-rules"]`); the runtime resolves each id through a 3-tier chain (first hit wins, no merge):

| Tier | Path | Source | When to use |
|---|---|---|---|
| 1 | `vault/skills/<id>.md` | user-authored / fork | user writes their own skill or forks one to customize |
| 2 | `~/.claude/skills/<id>.md` | ECC plugin + Claude Code shared | any skill that ships via ECC `everything-claude-code` plugin (60 agents + 249 skills) or user installed via Claude Code skill ecosystem — **shared across all Claude Code-aware tools** |
| 3 | `~/.ctrl/keycaps/<id>/assets/skills/<skill-id>.md` | keycap's own `cap_asset.files` bundle | keycap brings a custom skill no one else has; immutable, ships with the manifest |

**Why no merge**: skills are markdown recipes, not config — overriding behavior by combining two recipes silently produces unpredictable output. First-hit-wins gives users clear control (drop a `vault/skills/<id>.md` to swap one out).

**ECC plugin = first-class substrate source**, not a parallel ecosystem: ECC's 249 skills are usable by every CTRL keycap without any wrapper. Conversely, skills authored for CTRL can be shared via the same `~/.claude/skills/` directory and benefit Claude Code sessions too. One skill format, one runtime contract, two ecosystems of consumers.

### 4. Schema convergence (kills "每条 keycap 一条管线")

Per 00-inventory §4.1: **`packages/ctrl-keycap-sdk/src/manifest-schema.ts` = SSOT** (commit the untracked file). Other 3 representations become derivatives:

- `.olym/specs/tool-manifest/spec.md` = prose-only documentation pointing at the SDK
- `packages/ctrl-web/src/lib/irisy-keycap-zod.ts` = `export { ... } from '@ctrl/keycap-sdk'`
- Rust `src-tauri/src/kernel/keycap_manifest.rs` = serde structs mirroring TS schema, field names + enum values literal-aligned, golden file test enforces drift

16 G builtin manifests migrate to new schema in one PR (00-inventory §4.3): add `pattern: "G"` + structured `capabilities` object (replaces `permissions: string[]`) + `ui_surface` enum.

### 5. Dispatch unification

Per 00-inventory §6 (substrate asks B1-B3) and §5 (frontend asks A1-A3):

**Kernel side (B1-B3)**:
- Delete `kernel.rs::classify_seed` 4 hardcoded match arms
- All keycaps dispatch via `manifest.pattern`:
  - G → `StepEngine` (executes `actions[].steps[]` per manifest)
  - A → `StepEngine` + `network.http` step type (new)
  - D → `MCPServerActor` (already partially stubbed)
  - B / C / E / F → keycap-local in v1 (per ADR-004 v1.1 candidate rule), promote to kernel when 2nd consumer ships

**PWA side (A1-A3)**:
- Build `WorkspaceUiDispatch` registry with 9 fixed renderers (00-inventory §5 A1)
- `manifest.ui_surface` enum value routes to renderer; no per-keycap React component
- Universal `invokeKeycap()` entry point (A2); universal `routeOutput()` sink (A3)

### 6. Naming alignment

User-facing language (chat, UI text, docs) standardizes on:

| Concept | Term | Replaces |
|---|---|---|
| The thing that runs underneath | **底座 / runtime** | "kernel" (ambiguous between ADR-001's 5 primitives and ADR-004's 8 namespaces) |
| The 8 namespaces + provider registry | **底座 capability** | "kernel API" |
| A keycap | **键帽** | (unchanged) |
| Irisy's persona / behavior in this keycap | **键帽里的 Irisy** | (clarifies persona is per-keycap) |

ADR-001's 5 primitives (Actor / Capability / Event / Channel / Effect) **remain valid as internal runtime building blocks** — they are how the runtime is *built*, not how users describe it. CLAUDE.md updated to draw this line explicitly.

### 7. Irisy persona rule (binding)

Irisy's prompt (`vault/.irisy-prompts/irisy-system.md` etc.) MUST:
- Never name internal provider strings (Volc / Anthropic / Pi / Ollama / DALL-E / Doubao …) in user-facing replies
- When user asks "what can you do" → reference the visible InfraBar / keycaps, not raw kernel state
- Tool calls and tool results NEVER stream to chat (already partially fixed; ADR-024 makes it binding policy)
- Hide internal layer breakdown unless user explicitly asks "what's running underneath"

### 8. User Flow — workspace 怎么用 (bao sign-off pending)

**This section locks the operator-facing surface for the workspace area.** It is normative, not exploratory. Sign-off here precedes any implementation; deviations require an ADR amendment.

**8.1 The 2 states the user lives in**

The main window has exactly **2 visual states**. No 3rd intermediate. No companion-→-expanded animation halfway.

| State | Width | Visible content (left → right) | When |
|---|---|---|---|
| **COMPANION** (default) | **430 px** | `[L1 48] [Irisy chat 382]` | Default first launch + after `▾` collapse + after Ctrl-hide-then-show |
| **EXPANDED** | **1800 px** (or clamp to monitor width) | `[L1 48] [workspace area 1370] [Irisy chat 382]` | After user clicks `▾` once on L1 |

The window's **right edge stays anchored** (top-right of primary monitor). Expansion grows the window's **left edge leftward** so Irisy doesn't shift visually. bao 2026-05-30: "左边展开新的窗口" — "新窗口" = 主窗自身向左扩, 不是独立 Tauri 窗口.

**8.2 The 1 operator the user has**

`▾` button at the top of L1 is the **sole** operator for the workspace area. It is both the open and the close trigger.

| Action | What happens |
|---|---|
| Click `▾` in COMPANION | Window animates to EXPANDED (430 → 1800, leftward). Workspace area renders. `▾` icon flips to `▴`. |
| Click `▴` in EXPANDED | Window animates back to COMPANION (1800 → 430). Workspace area unmounts. `▴` flips to `▾`. |

**No other close affordance**. Users do NOT look for an X in the workspace area. The L1 `▾`/`▴` is the only way in and out. This is unambiguous to teach: "click the chevron to expand; click again to collapse." The mistake of 0.1.95 (independent Tauri window with no visible close handle, bao "关都不知道怎么关") is forbidden by this rule.

**8.3 What the workspace area shows (v1 minimum)**

When EXPANDED, the workspace area (1370 px wide between L1 and Irisy) renders:

- **Header strip** (~40 px): label "Keycaps" + installed count (e.g. "2 installed").
- **Body**: installed-keycap grid as 4-column cards (icon + name), centered, max-width 1280 px. Empty state when 0 keycaps: "Use Create on the left to talk Irisy through making your first keycap."

**Future v1.1+ additions** (out of scope for this section): tabs along the header for Pool / Workbench / per-keycap output. These DO NOT add new operators — they all stay inside the EXPANDED state, triggered by ▾.

**8.4 L1 button list (sign-off required — bao to pick 3 + ▾ + Settings)**

L1 contains, top to bottom:

```
[▾ / ▴]                    ← workspace toggle (always top, never goes away)
                           ← <bao to fill: which 3 buttons go here>
                           
                           ← (spacer)
[⚙ Settings]               ← always bottom
```

**User-facing labels only** (ECC review H6, 2026-05-30): §7 of this ADR forbids surfacing internal layer names. Buttons are labeled by user *intent*, never by the underlying keycap id. Candidates:

| User label (intent) | Underlying behavior |
|---|---|
| **◉ Chat** | Loads `builtin-assist` keycap → Irisy default chat persona. Label is "Chat", not "Assist" (Assist is the keycap id, internal). |
| **✚ New** | Loads `builtin-create` keycap → Irisy keycap-designer persona. Label is "New" (= "make a new keycap"), not "Create". |
| **< / > Code** | Opens `/coding` workspace. |
| **▢ Vault** | Opens `/vault` browser. |
| **▤ Tools** | Browse and install keycaps from the local + community pool. Label is "Tools" (user-facing), not "Pool" (jargon). Could move into workspace area instead — see §8.6. |

bao explicitly questioned "你三个按钮什么意思" on 2026-05-30. **My default proposal (pending bao override)**: `[Chat] [New] [Vault]` — Chat (default conversation) + New (make a keycap) + Vault (data home). Tools moves into the workspace area as a tab. Code stays as a future addition or moves into workspace.

**8.5 Edge case — monitor narrower than 1800**

If the user's primary monitor is < 1800 px wide (e.g. 13" MacBook = 1440 native):
- EXPANDED target width clamps to `min(1800, monitor_width - 40)` — leave 40 px breathing room on the left edge.
- Window's right edge stays where COMPANION had it (top-right of monitor).
- Workspace area shrinks accordingly; the keycap grid reflows (auto-fit 2-col / 3-col / 4-col).

**8.6 Decision still open in §"实施时决"**

- **Width transition style**: instant set_size or animated grow? Default = animated 220 ms ease-out, matching companion-input window glue's motion. If macOS animation API too brittle, fall back to instant.
- **Pool location**: stays as L1 button (per current PrimaryRail) OR moves into workspace area as a tab. My preference: **tab** (workspace area is where keycap management lives; L1 stays minimal). Pending bao.
- **First-launch hint**: show a one-time tooltip pointing at `▾` so users discover the workspace area exists. Default: yes, dismissable.

**8.7 What this section forbids**

- ❌ Independent Tauri windows for the workspace area (rejected 2026-05-30 after 0.1.95 user feedback "关都不知道怎么关").
- ❌ Drawer / overlay that covers Irisy chat (Irisy must stay visible and useable in EXPANDED).
- ❌ Multiple workspace areas open at once.
- ❌ Workspace area opening automatically without user action (bao's "自动触发" earlier was ambiguous; this section locks `▾` as the ONLY trigger until a later ADR amendment adds explicit auto-open triggers per-keycap).
- ❌ Closing the workspace area by any control inside it (Esc, hide button, click outside). Only L1 `▴` collapses.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Keep 6 separate docs, no synthesis | Bao explicitly said "我一直不理解你说的 kernel"; symptoms (Irisy verbose / poster blocked / schema drift) all trace to the lack of one anchoring statement |
| A2 | Accept ADR-004 standalone first, then write ADR-024 on top | ADR-004 alone doesn't address multi-modal brain promotion, schema unification, OR the user-facing naming problem; sequencing into 2 ADRs adds 2 sign-off cycles for 1 coherent decision |
| A3 | Promote ALL spike 06 v1.1 candidates to v1 (process / oauth / stss + image + audio) | YAGNI. process / oauth / stss have NO active v1 consumer in top-15 (Memos uses HTTP in Pattern A, not OAuth in v1; Motrix / BetterDisplay are v1.1). Image+audio have 4 v1 consumers (poster / OCR / PDF visual / 会议) — clears the "actually used in v1" bar |
| A4 | Make brain singular (only text.chat formal; image.* / audio.* keycap-local until v1.1) | Inconsistent with bao 2026-05-30 "做海报得有 image 大模型; 我们是双重 brain". Forces poster keycap to bypass the substrate model — exactly the "每条 keycap 一条管线" problem this ADR is killing |
| A5 | Keep `kernel_status.kernel_llm.adapter: string` (singular), add separate `image_adapter` and `audio_adapter` fields | Inflates the surface, doesn't generalize. Per-capability table is the natural shape for the multi-provider × multi-capability matrix |
| A6 | Rename "kernel" globally including internal Rust modules | Internal Rust naming has tooling cost and ADR-001 lineage. User-facing language is the actual confusion source; Rust modules stay |

## Consequences

**Positive**:
- **One law to anchor** — bao's "我不理解 kernel" eliminated. Six docs collapse to one ADR with consistent vocabulary.
- **Irisy state queries become structured** — `active_providers` table replaces ambiguous singular adapter. Irisy never has to "explain" two layers.
- **Schema unification kills 4-way drift** — one SDK file, three derivatives. New keycap = manifest only.
- **Poster keycap shipable** — image.generate / image.edit promoted. 1st multi-modal consumer validates the registry.
- **会议 keycap shipable** — audio.stt promoted. Transcription path opens.
- **OCR rationalizes** — `image.ocr` keycap-local in spike 06 absorbs into kernel `image.understand`; one less duplicated keycap-local impl.
- **14 of v1 top-15 share substrate via 6 axes** — reuse by default. Adding the 16th, 17th, …, Nth keycap = manifest + cap_asset bundle, not Rust.
- **Multi-provider per capability** — text.chat = Claude (subscription) AND image.generate = Volc Seedream can coexist; user perceives one product, not three.

**Negative / cost**:
- **`image.ocr` keycap-local in spike 06 → kernel `image.understand`** — small migration (1 keycap currently planned, not shipped). Cost: low.
- **4 schema files → 1 SSOT** — requires 1 PR + 16 builtin manifest migration + golden file test setup. Cost: medium, but pays back permanently.
- **Provider Capability Registry is new code** — `kernel/providers/` module + manifest reader + reverse index. ~3 Rust files + provider manifest format. Cost: medium.
- **User-facing "kernel" → "底座 / runtime"** — UI copy + CLAUDE.md + docs scan. Cost: low. Apollo touches Settings page copy per memory `apollo_copy_facts_from_zeus_2026-05-17`.
- **CLAUDE.md update** — must draw the line: internal "kernel = 5 primitives" stays in Rust; user-facing language = "底座 + 键帽 + Irisy 3 层".

**Reversal cost**: **medium**. The `manifest-schema.ts` SSOT is referenced by `@ctrl/keycap-sdk` consumers (PWA + kernel). Renaming a field = grep+replace + SDK republish. Dropping a `brain_capability` requires deprecation cycle. Adding a new capability is cheap.

## Acceptance

- [ ] ADR-004 moved from `proposed` → `accepted`. Changelog notes the image+audio expansion (or, equivalently, ADR-004 is superseded by ADR-024 §3 — to be decided in §"待 bao 拍板").
- [ ] `packages/ctrl-keycap-sdk/src/manifest-schema.ts` committed as SSOT. `.olym/specs/tool-manifest/spec.md` rewritten as prose. PWA zod re-exports. Rust serde mirrors written + golden file test.
- [ ] 16 G builtin manifests migrated to new schema in one PR (per 00-inventory §4.3). All pass `parseManifest()`. Capability frequency from spike 06 §Q1.1 used as the per-keycap fill table.
- [ ] `kernel/providers/` module: `Provider` struct + manifest reader (`~/.ctrl/providers/<id>/manifest.toml` + builtin `share/providers/`) + `capability → [providers]` reverse index.
- [ ] `kernel_status` returns `active_providers: { [capability]: provider | null }`; old `kernel_llm.adapter` field deprecated with one release of overlap then removed.
- [ ] `kernel.rs::classify_seed` deleted. All keycaps dispatch via `manifest.pattern`. `StepEngine` handles G+A (including new `http-request` step per 00-inventory §6 B3). `MCPServerActor` handles D.
- [ ] PWA `WorkspaceUiDispatch` registry with 9 fixed renderers (per 00-inventory §5 A1). `KeycapCard` and routes use the registry.
- [ ] Irisy persona prompt (`vault/.irisy-prompts/irisy-system.md` + variant prompts) updated: never name internal providers; tool plumbing hidden. `PROMPT_VERSION` bumped.
- [ ] Poster keycap manifest written + shipped as 1st multi-modal consumer. Validates the full 6-axis binding end to end (including `cap_asset` install-time provisioning + vault folder creation).
- [ ] 会议 keycap manifest scaffolded (audio.stt registered).
- [ ] CLAUDE.md "Architecture overview" section updated: introduce "底座 = 8 capability namespaces + provider registry + MCP host". Note 5 primitives = internal Rust runtime building blocks, not user-facing vocabulary.
- [ ] memory `decision_ctrl_lean_substrate_scheduler_executor_tools` (2026-05-28) cross-linked. Memory `decision_pi_is_sole_brain_hermes_is_keycap` amended: "sole brain" applies to `text.chat` capability; image.* / audio.* are independent capabilities with their own provider chains.

## 实施时决 (deferred per bao 2026-05-30 "边做边决策, 先做助理、create、第一个键帽")

The following 6 originally-listed open questions are **deferred to implementation phases**. Each has a working default chosen below; defaults stand unless implementation evidence forces a change. ADR-024 is not blocked on these answers.

| # | Question | Default decided now | Decision moment |
|---|---|---|---|
| 1 | ADR-004 fate (amend vs supersede) | **amend ADR-004 → accepted**; ADR-024 adds image/audio expansion + brain_capability_registry + schema convergence. Two ADRs, clear lineage. | Phase 0 PR (ship ADR-024 + ADR-004 amend together) |
| 2 | Provider Capability Registry storage | **Both `~/.ctrl/providers/<id>/manifest.toml` (user-editable) + `share/providers/<id>/manifest.toml` (shipped)** — user must be able to add self-hosted Ollama / custom endpoint without code change | Phase 2 (when Provider Capability Registry impl ships) |
| 3 | provider_pin scope (per-keycap vs profile inheritance) | **per-keycap only in v1**; profile inheritance is a v1.1 feature when real user evidence shows "I want all my coding keycaps using Claude" pattern | Phase 1 第一个具体键帽 ship 后观察 |
| 4 | OCR migration (keycap-local `image.ocr` → kernel `image.understand`) | **Yes, replace** — `image.understand` is a strict superset of `image.ocr`; saves one keycap-local impl | When OCR keycap is built (Phase 1+) |
| 5 | Schema migration release strategy (atomic 0.2.0 vs phased 0.1.93/.94/.95) | **Atomic 0.2.0 PR** — phased ships intermediate broken states; bao memory `feedback_no_planning_no_phasing` also rejects phasing | Phase 2 ship moment |
| 6 | `cap_asset.vault` retroactive scope for 16 G builtin | **Optional based on `ui_surface`** — `cap_asset.vault` mandatory iff `ui_surface ∈ { canvas, html-output, form, chat-stream }` (keycaps producing persistent user outputs). text-transform builtins (markdown-quote / base64 / urlencode etc.) with `ui_surface = clipboard \| notification \| none` may omit `cap_asset.vault` | Phase 2 (16 builtin migration PR) |

**Two questions identified late but absorbed into §1 / §3.5**:
- **A1 "Irisy 是什么"** → §1 amended: "Irisy = user-perceived AI total; physical impl = active keycap's persona instance; reconciles `decision_irisy_is_pwa_native_not_keycap` (PWA-page) with the implementation (active keycap persona) as different layers of same fact".
- **B4 ECC skills vs CTRL skills** → §3.5 added: "CTRL skill = Claude Code SKILL.md compatible superset; 3-tier lookup chain (`vault/skills/` > `~/.claude/skills/` > keycap-bundled); ECC plugin 249 skills usable by any CTRL keycap without wrapper".

**4 questions explicitly deferred to "discover during implementation"** (per bao 边做边决策):
- A2 InfraBar UX details (prototype Phase 1)
- A3 Cross-keycap composition (deferred until v1.1 user demand; current = Irisy chat orchestrates manually)
- B1 Keycap-uninstall vault folder fate (default: retain, add `README.md` "this keycap is no longer installed")
- B3 `provider_pin = "any"` schema cleanup (default: `null` = fallback chain; explicit id = lock; deprecate "any" string sentinel during Phase 2)

## Changelog

| Date | Change |
|---|---|
| 2026-05-30 | Initial draft. Status `proposed`. Synthesizes 6 docs (ADR-004, ADR-010, spike 06, 00-inventory, brainstorm-workbench, ideas-record) + bao 2026-05-30 "双重 brain + 海报" + "我一直不理解你说的 kernel" framing. **6 substrate axes initially**. Awaiting bao accept on 5 open questions. |
| 2026-05-30 (same day) | Added 7th axis **`cap_asset`** (bao 2026-05-30 "那就规范定义叫 cap-asset"; preceded by "前期 keycap 都要全部创建该 keycap 的 assets ... 也要有 vault"). `cap_asset.files` = bundled-in static files; `cap_asset.vault` = user-facing vault folder reservation with seed structure. Install-time provisioning rule added to §1 (atomic, day-1 ready, no first-run wizard). Open question 6 added: cap_asset retroactive scope for 16 G builtin. |
| 2026-05-30 (same day) | **Axes 7 → 6**: persona folded into `cap_asset.files` (bao 2026-05-30 "三层 persona 你怎么管理? 你还不如助理也是一个 keycap 逻辑更加清晰"). Shared persona library deleted from design. `builtin/assist` and `builtin/create` are keycaps with identical shape to user keycaps, only `manifest.builtin=true` flag distinguishes; no `scope="root"` or `can_install_keycaps` special fields. Capability `file.read_allowlist` decides what the keycap *reads* (assist gets `${vault_root}/*`); `cap_asset.vault.path` decides only what it *writes* (assist gets `keycaps/assist/`). |
| 2026-05-30 (same day) | **A1 + B4 amended into normative sections**; "待 bao 拍板" reframed as "实施时决" with defaults chosen for all 6 originally-open questions (bao 2026-05-30 "边做边决策, 先做助理、create、第一个键帽, 这样逐步就清晰起来了; 先大体框架搭建好"). ADR-024 is no longer blocked on open questions; defaults stand unless implementation evidence forces a change. |
| 2026-05-30 (same day, evening) | **§8 User Flow added** (workspace operator flow). Triggered by 0.1.95 ship of an independent Tauri workspace window that bao rejected as un-closable ("关都不知道怎么关"). §8 locks: (a) workspace area = main window's leftward expansion (430 ↔ 1800), NOT a separate window; (b) L1 `▾`/`▴` is the sole open/close operator; (c) Irisy chat stays visible in EXPANDED; (d) 1800 clamps to monitor width on small screens. **L1 button list (§8.4) requires bao sign-off on which 3 buttons sit between `▾` and Settings before any implementation.** No code lands until §8 is signed off. |
| 2026-05-30 (same day, ECC reviewer pass) | **Amends from 5-agent ECC review**. §1 added paragraph reconciling tension with memory `decision_ctrl_lean_substrate_scheduler_executor_tools` (ADR-024 is composition contract, NOT more kernel framework). §3 amended ADR-004's frequency≥3 rule to add a "category exception" so the 4 multi-modal brain capabilities (image.generate / image.edit / image.understand / audio.stt) can ship in v1 with 1 consumer each (bao 钦定 image.* for poster keycap). §8.4 button candidates relabeled from internal keycap ids (Assist / Create / Pool) to user-facing intents (Chat / New / Tools) — §7 forbids surfacing layer names. ADR-024 still proposed; sign-off conditions unchanged. |
