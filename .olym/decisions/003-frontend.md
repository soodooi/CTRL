---
adr_id: 003
module: frontend
title: CTRL frontend — single PWA + Irisy-as-sole-entry + Keyboard drag-install + vault viewer stack + 4-col shell
version: 3
status: accepted
last_updated: 2026-06-01
deciders: [bao, zeus, daedalus]
sections:
  - { id: pwa,           source: orig-002 }
  - { id: nav-keyboard,  source: orig-002-amendment-2026-05-30 }
  - { id: vault-stack,   source: orig-020 }
  - { id: shell-4col,    source: new-2026-06-01 }
changelog:
  - v1 2026-05-31: module reorg — merged orig-002 (PWA pivot + Irisy-as-sole-entry + Keyboard drag-install) + orig-020 (VMark stack adoption: Tiptap + CodeMirror 6 + mermaid + smart table + vault browser).
  - v2 2026-05-31: § nav-keyboard — Settings enters L1 (bao "L1 上的 setting 页面, 点击打开就是 setting 页面, 其中一个页面就是 providers"). Replaces v1 "Settings via StatusBar cog". L1 buttons under `▾`: [Chat] [New] [Vault] [Coding] [Settings]. Each opens its route in workspace EXPANDED area; no floating cog.
  - v3 2026-06-01: NEW § shell-4col — 4-column shell `[L1 | L2 | Tab | Irisy]` lock-in. bao multi-message校准 in workspace tab refactor (2026-06-01 session, ~$720 cost). Keycap surface (separate Tauri child window) retired in concept; ship still has bugs (see § shell-4col known-bugs list). v0.1.127 → v0.1.132 released during this session.
related:
  - .olym/decisions/001-spine.md
  - .olym/decisions/002-substrate.md
  - .olym/decisions/005-irisy.md
---

## §1 Single PWA codebase

UI layer = single `packages/ctrl-web` (React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa). Same bundle runs in Tauri 2 WebView on desktop AND any browser on mobile. Bridge: Tauri 2 `invoke()` on desktop (intra-process), WebSocket + token on mobile (127.0.0.1:17872, intra-device).

L0 native shell (`src-tauri/src/shell/`) stays ≤ ~500 LOC Rust — hotkey / tray / window / keychain / kernel_supervisor only. All UI / settings / keycap workspace live inside PWA — no native UI windows beyond shell-summoned WebView.

## §2 L1 navigation — single Irisy entry

User-facing single entry: **Irisy** (Pi's expression). User does NOT switch between assistant/creator/coding modes — Pi internally dispatches based on conversation context + active keycaps' skills.

L1 nav lives on the left rail (48 px, ADR-001 §4 ui-ux), top to bottom:

```
[▾ / ▴]        ← workspace toggle (always top, never goes away)
[Chat]         ← builtin-assist persona (Irisy default chat)
[New]          ← builtin-create persona (make a keycap)
[Vault]        ← /vault browser
[Coding]       ← Code Space (ADR-005 § remote-view surface)
   (spacer)
[Settings]     ← always bottom
```

Each L1 button (NOT just `▾`) opens the workspace area in EXPANDED state and renders the corresponding route as the workspace content. Settings is no exception — clicking L1 Settings opens `/settings` in the workspace area; `/settings/providers` / `/settings/brain` / etc. are sub-pages inside the Settings page. There is NO floating cog in StatusBar / corner — the workspace IS the design target for these pages (bao 2026-05-31: "L1 上的 setting 页面, 点击打开就是 setting 页面, 其中一个页面就是 providers").

User-facing intents only; never expose keycap ids like "Assist" / "Create" / "Pool" / "Provider" — internal codenames stay internal (ADR-005 § persona v1).

Workspace layout — 2 visual states only:
- **COMPANION** (default, 430 px): `[L1 48] [Irisy chat 382]`
- **EXPANDED** (1800 px, clamp to monitor): `[L1 48] [workspace area 1370] [Irisy chat 382]`

Window right edge anchored top-right of primary monitor. Expansion grows leftward (Irisy stays visually). L1 `▾`/`▴` chevron toggles the workspace area; clicking any other L1 button while in COMPANION expands automatically. Independent Tauri windows for workspace are forbidden (0.1.95 user feedback "关都不知道怎么关").

## §3 Keyboard = drag-install dock

The Keyboard (always-on left grid) is the **drag-target for keycap installation**. Replaces Pool's install-button flow.

| Drag source → Keyboard | Effect |
|---|---|
| Pool keycap card | Installs to `~/.ctrl/keycaps/<id>/`, runs ADR-002 § composition cap_asset provisioning, keycap appears on grid |
| External `.zip` / `keycap.json` | Same after manifest validation |
| GitHub URL | Fetch manifest, validate, install (ADR-007 § skill-discovery path) |
| Keycap → trash zone | Uninstall (`rm -rf ~/.ctrl/keycaps/<id>/`) |
| Keycap → reorder | Persists Keyboard layout state |

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

All viewers `lazy()` — critical-path stays under 200 KB mobile cap. Triple-axis viewer resource model: `source ∈ {vault, keycap, system}` × `editable: bool` × `companion?: string`.

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

`VaultBrowser` reused inside Pool keycap detail panel ("edit prompt.md").

## §7 Shell 4-col layout (NEW v3, 2026-06-01) — `[L1 | L2 | Tab | Irisy]`

**Why this section exists**: bao 2026-06-01 multi-message refactor (`你怎么这么蠢？无非就是最简单的tab和导航` + `L2和tab，是两个东西` + `keycap这个是pool` + 5 release iterations v0.1.127 → v0.1.132). The previous 2-col `[L1 | Irisy]` shell could not host the workspace tab paradigm; an ad-hoc Tauri child window (`WorkspaceSurface` + `toggle_workspace_window`) was filling that role and conflicting with the inline cockpit. This section locks the canonical 4-column shell.

### §7.1 Column model

| Column | Width | Role |
|---|---|---|
| **L1** | 48px fixed | Primary nav rail. Vertical icon-only chips: ▾ (window expand toggle, top), Irisy, Keycap pool, Coding, Settings (bottom). Always visible. |
| **L2** | 0 (compact) / 200px (when active L1 has sub-nav) | Secondary nav for the active L1 item — VS Code-style sidebar. Reserved column; sub-nav components land per L1 item as needed. **L2 and Tab are two separate things** (bao explicit). |
| **Tab** | 0 (no workspace) / 1fr (any workspace instance open) | Workspace tab content — `<WorkspaceShell />` from `components/workspace/`. Renders `InstanceSwitcher` (pill row) + `TabBar` (horizontal tabs) + active tab body. |
| **Irisy** | 430px fixed | Always-on right pane. `<IrisyChat />` + `<InfraBar />` (kernel/MCP/vault chips at bottom). |

CSS file: `packages/ctrl-web/src/app.module.css`. Driven by `--l1-width / --l2-width / --tab-width / --irisy-pane-width` CSS vars + `data-workspace-open / data-l2-open` attributes on `.shell`. Status bar spans all 4 columns at top via `grid-template-areas`.

### §7.2 Window-size states

- **Compact**: window ≈ 478px. Only L1 (48) + Irisy (430) render. No workspace open. Sufficient for "ask Irisy a question, dismiss" loop.
- **Expanded**: window ≈ 1100px+. All 4 columns visible. Toggled via the `▾` chevron at the top of L1 (calls Tauri `toggle_workspace_window` which slides the main window's left edge 430 ↔ 1600). User-driven; L1 chip clicks do NOT auto-expand or auto-compact the window (bao 2026-06-01 `L1切换为什么要关掉工作区？`).

### §7.3 L1 click semantics

| L1 chip | Behaviour |
|---|---|
| ▾ (top) | Tauri `toggle_workspace_window` — manual window expand/compact only. |
| Irisy | `navigate('/')` — Irisy is always rendered in the .irisy column; clicking refocuses route only. |
| Keycap pool | `openSystemTab({id:'pool', path:'/pool', title:'Keycap pool'})` — opens a route tab in the singleton "system" workspace instance. Window is NOT auto-expanded. |
| Coding | `openSystemTab({id:'coding', path:'/coding', title:'Coding'})`. |
| Settings (bottom) | `openSystemTab({id:'settings', path:'/settings/ctrl', title:'Settings'})`. |

System instance: `workspace-store.ts::openSystemTab(tab)` — singleton id `ws-system`, layout `tabs`, idempotent on `tab.id`. Non-keycap L1 chips share this instance.

### §7.4 Keycap page = Pool route (NOT a separate Tauri window)

bao 2026-06-01: `keycap这个是pool，用于管理keycaps`. The legacy `WorkspaceSurface` (separate Tauri child window opened by `toggle_workspace_window` with `?surface=workspace`) is **retired in concept**. The keycap grid view is the `/pool` route, opened as a Tab in the main window via the L1 "Keycap pool" chip.

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

- Keyboard drag-install: external `.zip` / `keycap.json` drop + GitHub URL drag from address bar + trash zone uninstall + grid reorder persistence
- Settings page L1 entry — `/settings` route renders inside workspace EXPANDED area; sub-pages `/settings/providers` (ADR-002 § provider) / `/settings/brain` (Pi status) / `/settings/appearance` / `/settings/editor` / `/settings/language` / `/settings/shortcuts` left rail with content panel right (§2 v2 amend)

## Provenance

- §1-§3 ← orig-002 (PWA pivot, 2026-05-13 + 2026-05-30 amendment Irisy-as-sole-entry + Keyboard drag-install + workspace 2-state)
- §4-§6 ← orig-020 (VMark stack adoption, 2026-05-25; orig file was `superseded by memory decision_vmark_not_substrate_use_open_stack` — that "supersede" was a framing fix, not a drop; the actual viewer + smart-table + vault browser decisions stand and are preserved here as v1)
