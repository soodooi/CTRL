---
adr_id: 003
module: frontend
title: CTRL frontend — single PWA + 5-chip L1 nav (3-agent aggregator) + Keyboard drag-install + 4-col shell
version: 7
status: accepted
last_updated: 2026-06-13
deciders: [bao, zeus, daedalus]
sections:
  - { id: pwa,           source: orig-002 }
  - { id: nav-l1,        source: H-2026-06-09-002 校准 (replaces nav-keyboard single-Irisy v2) }
  - { id: vault-stack,   source: orig-020 — RETIRED in v5 (kairo replaces) }
  - { id: shell-4col,    source: new-2026-06-01 }
  - { id: agent-routes,  source: H-2026-06-09-002 校准 }
changelog:
  - v1 2026-05-31: module reorg — merged orig-002 (PWA pivot + Irisy-as-sole-entry + Keyboard drag-install) + orig-020 (VMark stack adoption: Tiptap + CodeMirror 6 + mermaid + smart table + vault browser).
  - v2 2026-05-31: § nav-keyboard — Settings enters L1 (bao "L1 上的 setting 页面, 点击打开就是 setting 页面, 其中一个页面就是 providers"). Replaces v1 "Settings via StatusBar cog". L1 buttons under `▾`: [Chat] [New] [Vault] [Coding] [Settings]. Each opens its route in workspace EXPANDED area; no floating cog.
  - v3 2026-06-01: NEW § shell-4col — 4-column shell `[L1 | L2 | Tab | Irisy]` lock-in. bao multi-message校准 in workspace tab refactor (2026-06-01 session, ~$720 cost). Mcp surface (separate Tauri child window) retired in concept; ship still has bugs (see § shell-4col known-bugs list). v0.1.127 → v0.1.132 released during this session.
  - v4 2026-06-01: § shell-4col §7.1 column-order amendment — bao "顺序是工作区（内有tab），L2，L1，Irisy". Column model reordered LEFT→RIGHT to `[Tab | L2 | L1 | Irisy]`. L1 is now anchored immediately left of Irisy (not far-left). Rationale: Irisy + L1 stay visually pinned at the monitor's right; Workspace grows leftward when expanded, with L2 sandwiched between Workspace and L1. Compact mode still renders only L1 (48) + Irisy (430) = 478 px because Workspace and L2 collapse to 0. Anti-pattern §7.8 entry added: do NOT render L1 at column index 1.
  - v5 2026-06-09: **§ nav-keyboard → § nav-l1 — 5-chip 3-agent aggregator L1 (H-2026-06-09-002).** bao 2026-06-09 校准: 3 agents (hermes / opencode / kairo) are external; CTRL is the aggregator壳. L1 chips reorganized as 5 first-class routes mapping directly to capability surfaces: **Irisy** (PWA persona shell, default chat) / **Mcp pool** (MCP face discovery) / **Notes** (kairo webview) / **Coding** (opencode HTTP API + xterm) / **Assistant** (hermes MCP stdio). § vault-stack RETIRED — kairo owns markdown editor + wiki-link + backlink + git; CTRL doesn't ship its own editor. § agent-routes NEW: lock per-route agent endpoint contracts (kairo webview path / opencode HTTP port discovery / hermes MCP stdio handshake). Settings + Pool stay as before. § shell-4col 4-column shell preserved — agent routes render inside `[Tab]` column. Pre-v5 components retired in PWA: `IrisyChat forceMode="coding"` wrapper, `NotesApp` 3-pane (NotesTree/NotesEditor/NotesBacklinks), `MarkdownViewer` Tiptap shell, `BacklinksPanel`. PWA picks up sycophancy filter (relocated from `packages/ctrl-pi-bridge/data/persona-patterns.md` → `packages/ctrl-web/src/lib/persona-filter/patterns.md`).
  - v6 2026-06-11: **§8 NEW — morphing-conversation rebuild.** bao 2026-06-11 校准: CTRL is not a shell, it's an advanced UX paradigm at the app layer (UX + 通讯 + agent optimization); domain breadth via MCP/CLI/Skills, not built verticals. Synthesized from a 6-track product benchmark (launcher/routing/cockpit + marketing/office/finance verticals). Locks: one ambient morphing conversation (input-first floating surface), intent routing with visible pill + ambiguity-adaptive response (Lovable 3-way), morph-to-output-type via the 12-viewer registry, agent-workspace pane + tool stream, 3-layer drill-down, point-edit + checkpoint + accept/reject gate, capability-agnostic routing to the open MCP/CLI/Skill set, ambient scheduled tasks. §7 4-col shell + § nav-l1 5-chip SUPERSEDED for the home surface (chips survive as morph-layer shortcuts). 6-slice build sequence in §8.4. Invariants preserved: Ctrl summon · floating popup · Irisy(hermes) · coding(opencode) · kairo(notes).
  - v7 2026-06-13: **§7 shell-4col REINSTATED — bao reverts the v6 §8 morphing home surface back to the locked 4-column shell.** bao 2026-06-13: "我一直要的是这个布局… Irisy常驻", pointing back to §7 v4 `[Tab | L2 | L1 | Irisy]`. The v6 morphing-conversation home was a detour; the SHIPPED home is the §7 4-col shell. Implementation (v0.1.255→v0.1.259, PWA `AmbientHome`/`AmbientWorkbench`): L1 rail moved from the workbench far-left INTO AmbientHome's middle column, glued to Irisy's left (honours §7.8 anti-pattern: L1 never far-left); Irisy pane ALWAYS pinned far-right, widened 430→**480px**, divider-draggable 320–820; work area (Tab) leftmost, L2 collapsed by default; window total width 1280→**1480**. CTRL logo top-left of window; "Irisy" label inside the right Irisy pane. Markdown reply styling + per-reply Copy / Copy-conversation added. **Open item**: route pages (Settings/Coding) render with AmbientHome hidden → they currently lose the in-layout L1 and navigate back via the route topbar back bar; decide whether to restore a route-level L1. §8 morphing-conversation retained as a future direction, no longer the shipped home surface. **LESSON (process)**: read ADR-003 §7 BEFORE touching layout — skipping it cost a long detour of ad-hoc layout edits (Irisy left/right/centered) that merely re-derived the already-locked §7 spec.
related:
  - .olym/decisions/001-spine.md
  - .olym/decisions/002-substrate.md
  - .olym/decisions/005-irisy.md
---

## §1 Single PWA codebase

UI layer = single `packages/ctrl-web` (React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa). Same bundle runs in Tauri 2 WebView on desktop AND any browser on mobile. Bridge: Tauri 2 `invoke()` on desktop (intra-process), WebSocket + token on mobile (127.0.0.1:17872, intra-device).

L0 native shell (`src-tauri/src/shell/`) stays ≤ ~500 LOC Rust — hotkey / tray / window / keychain / kernel_supervisor only. All UI / settings / mcp workspace live inside PWA — no native UI windows beyond shell-summoned WebView.

## §2 L1 navigation — single Irisy entry

User-facing single entry: **Irisy** (Pi's expression). User does NOT switch between assistant/creator/coding modes — Pi internally dispatches based on conversation context + active mcps' skills.

L1 nav lives on the left rail (48 px, ADR-001 §4 ui-ux), top to bottom:

```
[▾ / ▴]        ← workspace toggle (always top, never goes away)
[Chat]         ← builtin-assist persona (Irisy default chat)
[New]          ← builtin-create persona (make a mcp)
[Vault]        ← /vault browser
[Coding]       ← Code Space (ADR-005 § remote-view surface)
   (spacer)
[Settings]     ← always bottom
```

Each L1 button (NOT just `▾`) opens the workspace area in EXPANDED state and renders the corresponding route as the workspace content. Settings is no exception — clicking L1 Settings opens `/settings` in the workspace area; `/settings/providers` / `/settings/brain` / etc. are sub-pages inside the Settings page. There is NO floating cog in StatusBar / corner — the workspace IS the design target for these pages (bao 2026-05-31: "L1 上的 setting 页面, 点击打开就是 setting 页面, 其中一个页面就是 providers").

User-facing intents only; never expose mcp ids like "Assist" / "Create" / "Pool" / "Provider" — internal codenames stay internal (ADR-005 § persona v1).

Workspace layout — 2 visual states only:
- **COMPANION** (default, 430 px): `[L1 48] [Irisy chat 382]`
- **EXPANDED** (1800 px, clamp to monitor): `[L1 48] [workspace area 1370] [Irisy chat 382]`

Window right edge anchored top-right of primary monitor. Expansion grows leftward (Irisy stays visually). L1 `▾`/`▴` chevron toggles the workspace area; clicking any other L1 button while in COMPANION expands automatically. Independent Tauri windows for workspace are forbidden (0.1.95 user feedback "关都不知道怎么关").

## §3 Keyboard = drag-install dock

The Keyboard (always-on left grid) is the **drag-target for mcp installation**. Replaces Pool's install-button flow.

| Drag source → Keyboard | Effect |
|---|---|
| Pool mcp card | Installs to `~/.ctrl/mcps/<id>/`, runs ADR-002 § composition cap_asset provisioning, mcp appears on grid |
| External `.zip` / `mcp.json` | Same after manifest validation |
| GitHub URL | Fetch manifest, validate, install (ADR-007 § skill-discovery path) |
| Mcp → trash zone | Uninstall (`rm -rf ~/.ctrl/mcps/<id>/`) |
| Mcp → reorder | Persists Keyboard layout state |

Drop-zone highlights on valid drag; reject + toast on invalid manifest. Post-install: Irisy detects new active skills in next turn. No restart, no "enable" toggle.

Pool stays as **browse surface** (preview only); install path always Keyboard drop.

## §4 Vault viewer stack (CTRL-native, NOT VMark dep)

VMark is a **compatibility commitment, not a substrate** (memory `decision_vmark_not_substrate_use_open_stack`). CTRL uses the same open-source primitives VMark uses, imported directly:

| Content-type | Viewer | Lib |
|---|---|---|
| `text/markdown` | `MarkdownViewer` | Tiptap + StarterKit (WYSIWYG + Source toggle) |
| `application/json` | `JsonViewer` | CodeMirror 6 + lang-json |
| `text/yaml` | `YamlViewer` | CodeMirror 6 + lang-yaml |
| `text/toml` | `TomlViewer` | CodeMirror 6 + legacy-modes/toml |
| `text/html` | `HtmlViewer` | iframe `sandbox=""` + CodeMirror source mode |
| `image/svg+xml` | `SvgViewer` | inline render + CodeMirror source |
| `text/mermaid` | `MermaidViewer` | mermaid.js |
| `text/x-ctrl-smart-table` | `SmartTableViewer` | Tanstack Table |
| `application/pdf` | `PdfViewer` | browser `<embed>` + companion `.md` link |
| `image/*` | `ImageViewer` | `<img>` + zoom toggle |
| `text/*` (generic) | `CodeViewer` | CodeMirror 6 no lang |

All viewers `lazy()` — critical-path stays under 200 KB mobile cap. Triple-axis viewer resource model: `source ∈ {vault, mcp, system}` × `editable: bool` × `companion?: string`.

## §5 Vault browser `/vault`

Three-pane VMark-style entry into `~/Documents/CTRL/`:

```
[ Tree + search 220px ] [ Preview via ViewerHost ] [ Backlinks 220px ]
```

- Tree groups paths by top-level folder
- Search hits `vault_search` FTS5 (≥2 chars debounced)
- Click selects (preview); double-click opens in active workspace as `vault-md` tab; Cmd-click opens new instance
- Save delegates to `vault_write` (preserves frontmatter)
- Backlinks scans client-side for `[[stem]]` + `[label](path.md)` — kernel index follow-up

`VaultBrowser` reused inside Pool mcp detail panel ("edit prompt.md").

## §7 Shell 4-col layout (v3 2026-06-01; v4 column order 2026-06-01) — `[Tab | L2 | L1 | Irisy]`

> **STATUS (v7, 2026-06-13): ACTIVE — this is the shipped home surface.** Reinstated after the v6 §8 morphing detour; implemented in PWA `AmbientHome` (v0.1.255→v0.1.259). Irisy pane widened 430→480px (draggable), window total width 1280→1480, L1 rail relocated into AmbientHome's middle column. See changelog v7.

**Why this section exists**: bao 2026-06-01 multi-message refactor (`你怎么这么蠢？无非就是最简单的tab和导航` + `L2和tab，是两个东西` + `mcp这个是pool` + 5 release iterations v0.1.127 → v0.1.132). The previous 2-col `[L1 | Irisy]` shell could not host the workspace tab paradigm; an ad-hoc Tauri child window (`WorkspaceSurface` + `toggle_workspace_window`) was filling that role and conflicting with the inline cockpit. This section locks the canonical 4-column shell.

### §7.1 Column model (v4 ordering — bao 2026-06-01 `顺序是工作区（内有tab），L2，L1，Irisy`)

LEFT → RIGHT:

| Column | Width | Role |
|---|---|---|
| **Tab** (leftmost) | 0 (no workspace) / 1fr (any workspace instance open) | Workspace tab content — `<WorkspaceShell />` from `components/workspace/`. Renders `InstanceSwitcher` (pill row) + `TabBar` (horizontal tabs) + active tab body. Grows leftward when expanded. |
| **L2** | 0 (compact) / 200px (when active L1 has sub-nav) | Secondary nav for the active L1 item — VS Code-style sidebar. Reserved column; sub-nav components land per L1 item as needed. **L2 and Tab are two separate things** (bao explicit). |
| **L1** | 48px fixed | Primary nav rail. Vertical icon-only chips: ▾ (window expand toggle, top), Irisy, Mcp pool, Coding, Settings (bottom). Anchored immediately left of Irisy. Always visible. |
| **Irisy** (rightmost) | 430px fixed | Always-on right pane. `<IrisyChat />` + `<InfraBar />` (kernel/MCP/vault chips at bottom). Anchored to monitor right edge. |

CSS file: `packages/ctrl-web/src/app.module.css`. Driven by `--l1-width / --l2-width / --tab-width / --irisy-pane-width` CSS vars + `data-workspace-open / data-l2-open` attributes on `.shell`. Status bar spans all 4 columns at top via `grid-template-areas`. v3 had columns in `[L1 L2 Tab Irisy]` order; v4 reorders to `[Tab L2 L1 Irisy]` per bao spec — L1 stays glued to Irisy's left, Tab grows leftward.

### §7.2 Window-size states

- **Compact**: window ≈ 478px. Only L1 (48) + Irisy (430) render. No workspace open. Sufficient for "ask Irisy a question, dismiss" loop.
- **Expanded**: window ≈ 1100px+. All 4 columns visible. Toggled via the `▾` chevron at the top of L1 (calls Tauri `toggle_workspace_window` which slides the main window's left edge 430 ↔ 1600). User-driven; L1 chip clicks do NOT auto-expand or auto-compact the window (bao 2026-06-01 `L1切换为什么要关掉工作区？`).

### §7.3 L1 click semantics

| L1 chip | Behaviour |
|---|---|
| ▾ (top) | Tauri `toggle_workspace_window` — manual window expand/compact only. |
| Irisy | `navigate('/')` — Irisy is always rendered in the .irisy column; clicking refocuses route only. |
| Mcp pool | `openSystemTab({id:'pool', path:'/pool', title:'Mcp pool'})` — opens a route tab in the singleton "system" workspace instance. Window is NOT auto-expanded. |
| Coding | `openSystemTab({id:'coding', path:'/coding', title:'Coding'})`. |
| Settings (bottom) | `openSystemTab({id:'settings', path:'/settings/ctrl', title:'Settings'})`. |

System instance: `workspace-store.ts::openSystemTab(tab)` — singleton id `ws-system`, layout `tabs`, idempotent on `tab.id`. Non-mcp L1 chips share this instance.

### §7.4 Mcp page = Pool route (NOT a separate Tauri window)

bao 2026-06-01: `mcp这个是pool，用于管理mcps`. The legacy `WorkspaceSurface` (separate Tauri child window opened by `toggle_workspace_window` with `?surface=workspace`) is **retired in concept**. The mcp grid view is the `/pool` route, opened as a Tab in the main window via the L1 "Mcp pool" chip.

`main.tsx` no longer branches on `?surface=workspace` — it always renders `<App />`. The Rust `toggle_workspace_window` command was repurposed to drive main-window left-edge resize (per the system.rs comment); future work should rename it to `toggle_main_window_expanded` and retire `?surface=workspace` query handling end-to-end.

### §7.5 Persistence + rehydration

`workspace-store.ts` uses zustand `persist` middleware (key `ctrl-workspace-store`, version 2). A stale shape from earlier sessions immediately flipped `data-workspace-open=true` on boot which collapsed the StatusBar grid row at compact 430px window width ("can't see version" symptom). Resolved at v0.1.132 via `version: 2` + `migrate` that returns an empty store for any pre-v2 payload. Any future change to `WorkspaceInstance` MUST bump this version.

### §7.6 IME input

`IrisyChat.tsx` textarea uses `onCompositionStart` / `onCompositionEnd` + `isComposingRef` to skip `setInput` while the IME is composing (Chinese / Japanese / Korean). The final string commits on `compositionend`. Without this React's controlled `value` round-trip closes the IME popup mid-keystroke.

### §7.7 Known bugs (ship-blockers for v1)

These were surfaced during the 2026-06-01 refactor session and are NOT yet resolved as of v0.1.132. A follow-up session must address them before the shell is considered stable:

1. **Duplicate cockpit window** (v0.1.132 screenshot) — `toggle_workspace_window` Rust command still opens a Tauri child window with `?surface=workspace` URL. With v3 `main.tsx` removing the WorkspaceSurface branch, that URL falls through to `<App />`, producing a second full cockpit. Fix: either retire the child-window code path in Rust entirely, or have `main.tsx` render `null` for `?surface=workspace`.
2. **Stale localStorage** — even with v2 migration in place, users on v0.1.131 with active sessions may have cached zustand state pre-rehydration. Future schema changes should bump again and tolerate orphaned keys.
3. **Comprehensive frontend review pending** — the `ecc:react-reviewer` agent stopped at $720 session cost. A fresh-session full audit of all ~25 frontend files is required before further refactor.

### §7.8 Anti-patterns (do NOT do)

- Do NOT call `toggle_workspace_window` from L1 click handlers — it is a toggle, will collapse an already-expanded window (bao 2026-06-01 `L1切换为什么要关掉工作区？`).
- Do NOT render `<WorkspaceShell />` outside the `.tab` grid area — the hidden `<Outlet />` was double-mounting it via `/` route until v0.1.130 (`routes/default.tsx` now returns `<></>`).
- Do NOT add new route components inside `<Outlet />` that mount heavy stateful chat / poll loops — they will run hidden and race against the shell-level mount (bao 2026-06-01 BUG 1: `/irisy` route mounted second `IrisyChat`).
- Do NOT widen the Irisy column past 430px or shrink it under 380px — chat readability is calibrated to that range.
- Do NOT render L1 at column index 1 (leftmost). L1 sits at column index 3, immediately left of Irisy (v4, bao 2026-06-01 `顺序是工作区（内有tab），L2，L1，Irisy`). Workspace tab area grows leftward from L1.
- Do NOT spawn a Tauri child window for the workspace (pre-v3 path). The workspace tab area renders inside main window's `.tab` grid cell; `toggle_workspace_window` resizes main's left edge 478 ↔ 1600 only.

## §6 Smart table — markdown + frontmatter schema (vim test passes)

On-disk file = plain markdown with YAML frontmatter `schema:` block + pipe table body:

```markdown
---
title: Reading list
schema:
  - { key: title,  label: Title, type: text }
  - { key: rating, label: ★,     type: number, min: 0, max: 5 }
  - { key: done,   label: Done,  type: checkbox }
  - { key: tags,   label: Tags,  type: tags }
---

| Title    | ★ | Done | Tags  |
|----------|---|------|-------|
| Anathem  | 5 |      | scifi |
```

vim opens as markdown table. Obsidian/VMark render as plain markdown table. CTRL `SmartTableViewer` = editable Tanstack Table with per-column cell editors (text/number/date/checkbox/tags/select/url). Edit → re-serialize → `vault_write` preserves schema block + frontmatter.

Schema language minimal (key/label/type/options?/min?/max?). Anything more complex stays markdown/yaml viewer.

## §8 Morphing-conversation rebuild (v6 — 2026-06-11)

> **STATUS (v7, 2026-06-13): NOT the shipped home surface.** bao reverted the home layout to §7's 4-col shell. The morphing-conversation ideas here are retained as a future direction, but the shipped home is §7 `[Tab | L2 | L1 | Irisy]`. Do NOT implement §8 as the home surface without a new bao decision. See changelog v7.

bao 2026-06-11: CTRL is NOT a shell wrapping 3 OSS agents — that's commodity. The product is an **advanced UX interaction paradigm at the application layer**, core = UX + communication (通讯) + agent optimization. The 3 OSS engines (hermes/opencode/kairo) are swappable; domain breadth (marketing/office/finance/anything) comes from the open ecosystem of **MCP servers + CLI + Skills** (3-capability-face, ADR-002), NOT from CTRL building verticals. This section locks the rebuild, synthesized from a 6-track product benchmark (Raycast/Spotlight/Alfred/ChatGPT/Cursor/Warp/Zed; ChatGPT-Canvas/Claude-Artifacts/Perplexity/Replit/Lovable/v0; Manus/Devin/Flowith/public.com/TradingView/Bloomberg; Gamma/Jasper/Descript/HeyGen; M365-Copilot/Gemini/Coda/Rows/Granola). Invariants (fixed): Ctrl-key summon · floating popup form · Irisy 助理 (hermes) · Irisy coding (opencode) · kairo notes · everything else rebuildable.

### §8.1 Concept — one ambient morphing conversation

Ctrl summons a floating, input-first, ephemeral surface. The user talks to **one** Irisy. CTRL classifies intent and ROUTES it — to a core agent OR any installed MCP/CLI/Skill — shown transparently. The surface MORPHS to the output type (chat inline; coding/notes/data/html open a side panel via the content-type viewer registry). The conversation is the spine/transcript; artifacts leave reopenable chips. The frontend is **capability-agnostic**: it routes + renders + lets the user install missing capabilities, and hardcodes no vertical.

### §8.2 Locked decisions (each backed by ≥2 benchmarked products)

**A. Shell (summon + surface)**
- Input-first, always-focused, vertically anchored; empty state = bare input bar; surface height animates to content; auto-collapse on blur. *(Raycast Compact, Spotlight)*
- Esc = back one level / dismiss at root; Enter = primary action; modifier-Enter = secondary; every action shows its shortcut. *(Raycast Action Panel)*

**B. One conversation → intelligent routing (the core)**
- One universal input, intent-routed, NOT a tab per capability. `@` grounds on vault files (cap ~20 refs); `/` invokes actions/skills/mcp. *(Warp universal input, Word `/file`, Raycast)*
- **Routing pill shown before work starts** — `→ Coding` / `→ Notes` / `→ <mcp>` / `Answering`. Hidden routing is the #1 anti-pattern. *(Perplexity modes, Zed tool indicators)*
- **Ambiguity-adaptive response** (the answer to "how does Irisy decide"): intent clear → do it directly; visually/strategically open → show 2-5 variant cards side-by-side; key decision missing → ask ONE tight structured question set. Never a mandatory wizard. *(Lovable 3-way fork)*
- Capabilities = open set: 3 core agents + any installed MCP/CLI/Skill. Missing capability → Irisy discovers + suggests install (Mcp pool / Discover). *(ADR-002 3-capability-face)*

**C. Morph to output type (the "functional windows")**
- **Render the answer AS the native artifact**, not a chat bubble describing it (a chart object, a table, an editable doc, an HTML view). *(Excel charts/pivots, Rows cells)*
- One neutral content model → many render targets; flip target without regenerating; output-type switch on the artifact. *(Gamma cards, Canva Magic Switch)*
- Conversation drives the artifact; artifact stays primary in a side panel beside the chat. The 12 existing viewers (Markdown/Code/Html/Json/Yaml/Toml/Svg/Image/Pdf/Mermaid/SmartTable/Fallback) are the morph targets. *(Claude Artifacts, ChatGPT Canvas, TradingView)*

**D. Transparency + agent workspace (the "通讯" core)**
- **Agent-workspace side pane ("X's Computer")**: live step/activity stream of what the engine is doing, with mid-task take-over/interrupt. *(Manus, Devin, ChatGPT virtual computer)*
- Capability/tool selection shown, not hidden; tool calls render inline as they fire. *(Zed)*
- **3-layer drill-down**: processed result → raw model output → sources/prompt/context injected. Every figure/summary keeps a provenance link to the raw vault item. *(Anthropic visible thinking, Perplexity citations, Outlook summary)*

**E. Edit + safety (the "trust")**
- Inline-targeted edit + scoped regenerate (smallest unit), never destructive full-regenerate. *(Gamma per-card, Excel per-cell)*
- Point-don't-describe: select element on the artifact → edit inline / property panel / NL-with-selection-attached / annotate-sketch. *(Lovable, v0)*
- Stage-then-apply (pending edits) + version history; checkpoint-restore on every file/vault mutation → maps to vault git. *(v0 pending-edits, Zed checkpoints)*
- Accept/reject/iterate gate (Keep it / Regenerate / Discard); consequential actions (money/destructive) → "intent → reviewable workflow → approve → execute". Never silent overwrite. *(Word, public.com, ChatGPT permission gates)*
- Fixed quick-action chips for the common 80% (Rephrase/Shorten/Summarize/Action-items); free-text for the rest. *(Gemini Docs, Granola)*

**F. Ambient / OS-level (the ambition)**
- Recurring/scheduled tasks from the conversation ("every Mon 9:00 refresh these metrics"); async heavy jobs you can leave and return to. *(ChatGPT tasks, public.com, HeyGen jobs)*
- Capture sparse → enhance async, local-first, no bot joins; AI-as-pipe over clipboard/screen/audio. *(Granola)*
- Persistent brand/voice/style + saved context as **markdown+frontmatter in the vault** (vim test). *(Jasper Brand Voice, Lovable design brief)*
- AI-as-column: one instruction applied per-row across structured vault data. *(Coda, Rows, Notion)*

### §8.3 Anti-patterns (hard bans — all converged across tracks)
Feature potpourri / tab-soup / disconnected point-solutions (Genspark cautionary, Copy.ai thesis, Warp critique) · hidden/silent routing · sidebar-only AI that describes instead of producing the artifact · black-box agent with no visible plan/tools/takeover · destructive full-regenerate or silent overwrite · mandatory wizards / over-questioning trivial asks · un-cited numbers / hidden data sources · acting on consequential intent without a review gate · mandatory cloud/account/embeddings before first value · over-dense simultaneous dashboards.

### §8.4 Build sequence (slices, each version-bumped + verified)
1. **Ambient conversation shell** — input-first anchored surface + routing pill + ambiguity-adaptive scaffold. Reuses IrisyChat transport.
2. **Morph layer** — conversation → side-panel artifact via the existing ViewerHost registry; output-type switch; artifact chips in-thread.
3. **Agent-workspace pane + tool stream** — live activity + take-over, wired to opencode `/event` + MCP tool calls.
4. **Edit + safety** — inline/point edit, pending-apply, checkpoint (vault git), accept/reject gate.
5. **Capability routing to open set** — MCP/CLI/Skill discovery + install + route, capability-agnostic.
6. **Ambient** — scheduled tasks, async jobs, brand-voice-as-markdown, AI-as-column.

Slices 1-2 realize the core "one morphing conversation"; 3-4 the transparency+trust moat; 5-6 the open-ecosystem + ambient-OS reach. The pre-v6 4-column shell (§7) and 5-chip nav (§ nav-l1) are SUPERSEDED for the home surface by §8.1; chips survive only as capability shortcuts inside the morph layer.

## Dependencies

`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `@uiw/react-codemirror`, `@codemirror/{lang-json, lang-yaml, lang-html, lang-markdown, lang-css, legacy-modes, state, view}`, `mermaid`, `@tanstack/react-table`. All in lazy chunks per content-type. VMark is NOT a dependency.

## Acceptance

- [x] `packages/ctrl-web/` is single React 18 + Vite 5 codebase. Verified.
- [x] `src-tauri/src/shell/` stays ≤ ~500 LOC. Verified.
- [x] Tauri `invoke()` desktop + WS+token mobile bridge. Verified.
- [x] L1 nav 2 chips (Irisy / Coding); Settings out of L1 nav. v0.1.105.
- [x] Workspace 2-state (COMPANION 430 / EXPANDED 1800) with L1 `▾` sole operator; right edge anchored. v0.1.117 (`feat(shell): workspace = independent Tauri child window glued left of main`, then refined).
- [x] Pool→Keyboard drag wired v0.1.106 (initial path). External zip / GitHub URL drop + trash uninstall + reorder in § Future work below.
- [x] Viewer registry with content-type → lazy viewer mapping (Tiptap / CodeMirror 6 / mermaid / Tanstack Table / etc.). Verified.
- [x] `/vault` 3-pane browser with FTS5 search + click preview + double-click tab. Verified.
- [x] SmartTable viewer reads frontmatter `schema:` + pipe table + edits round-trip via `vault_write`. Verified.
- [x] VMark is NOT a runtime dependency (`grep vmark package.json` = 0). Verified.

## Future work

- Keyboard drag-install: external `.zip` / `mcp.json` drop + GitHub URL drag from address bar + trash zone uninstall + grid reorder persistence
- Settings page L1 entry — `/settings` route renders inside workspace EXPANDED area; sub-pages `/settings/providers` (ADR-002 § provider) / `/settings/brain` (Pi status) / `/settings/appearance` / `/settings/editor` / `/settings/language` / `/settings/shortcuts` left rail with content panel right (§2 v2 amend)

## Provenance

- §1-§3 ← orig-002 (PWA pivot, 2026-05-13 + 2026-05-30 amendment Irisy-as-sole-entry + Keyboard drag-install + workspace 2-state)
- §4-§6 ← orig-020 (VMark stack adoption, 2026-05-25; orig file was `superseded by memory decision_vmark_not_substrate_use_open_stack` — that "supersede" was a framing fix, not a drop; the actual viewer + smart-table + vault browser decisions stand and are preserved here as v1)
