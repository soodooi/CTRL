---
adr_id: 002
title: Pivot UI to single PWA codebase under thin Tauri 2 native shell
status: accepted
date: 2026-05-13
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/004-kernel-capability-surface.md       # § 9.2 Mesh (former ADR-003)
scope: framework
module: frontend
supersedes: []
superseded_by: []
---

## Context

ADR-001 §3.1 had separate UI per platform (XAML on Win, SwiftUI on Mac). After 1 month of Win XAML work the math was clear: UI engineering cost dominated kernel cost 4:1; the PWA mobile path needed a separate React codebase anyway; WebView2 / WKWebView are evergreen + production-grade. Persisting with per-platform native UIs would consume v1 timeline entirely.

## Decision

UI layer = single PWA codebase (`packages/ctrl-web`, React 18 + Vite 5 + TanStack Router/Query + Zustand). Same bundle runs in Tauri 2 WebView on desktop AND in any browser on mobile. Tauri 2 native shell (L0) drops to ~500 LOC Rust — owns only hotkey / tray / keychain / kernel supervisor. PWA → Rust kernel bridge: Tauri 2 `invoke()` on desktop, WebSocket + token on mobile.

## Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| A1 | Keep native UI per platform (XAML / SwiftUI / GTK) | 4x engineering cost; 3 codebases to maintain; mobile would need a 4th |
| A2 | Electron instead of Tauri 2 | 100MB+ installer baseline; CN bandwidth tax; battery drain |
| A3 | Native shell + native UI on each platform (no WebView) | Same problem as A1 |
| A4 | React Native cross-mobile + native desktop | Wrong tradeoff — RN mobile + native desktop = 2 stacks; PWA gets 1 |

## Consequences

**Positive**:
- 1 UI codebase across all platforms
- Mobile PWA Day-1 free (no separate app needed)
- Service Worker offline caching by default
- Instant install via "Add to home screen" on iOS/Android
- L0 native shell shrinks to ~500 LOC = tiny attack surface, easy audit

**Negative / cost**:
- PWA installability is awkward on iOS Safari (worse than Android Chrome)
- Native menu / OS chrome integration only on desktop side
- Lose some native-feel polish on macOS (no AppKit bindings)

**Reversal cost**:
- Medium — ~4 weeks to revert. PWA codebase would move into a new native UI shell per platform; mobile path lost until rebuilt. Has not been needed; ADR-003 actually deepens the bet.

## Acceptance

- [x] `packages/ctrl-web/` is the single React 18 + Vite 5 codebase
- [x] `src-tauri/src/shell/` stays ≤ ~500 LOC Rust (hotkey / tray / keychain / kernel supervisor only)
- [x] PWA invocable both via Tauri WebView (desktop) and direct browser load (mobile)
- [x] Tauri 2 `invoke()` desktop bridge in place; mobile WebSocket+token bridge specified (intra-device 127.0.0.1:17872)
- [x] All UI / settings / keycap workspace live inside PWA — no native UI windows beyond shell-summoned WebView

## Amendment 2026-05-30 — Irisy-as-sole-entry + Keyboard drag-install

bao directive 2026-05-30 ("走 A 合并, 不用太复杂 — 创建 keycap 的功能只是助理的一个功能; 其他的 keycap 是助手加了该 keycap 的 skill 和我们的底座. 所以前端要有一个能拖拽落地的键盘底座, 用于安装 keycap; 一旦安装, 就是新的功能"). Aligns frontend with ADR-001 6th 校准 (Pi-centric) + ADR-003 Brain (Pi sole brain) + memory `decision_one_persona_irisy` ("user sees only Irisy, never switches").

### §1 Frontend mental model

Single user-facing entry: **Irisy** (Pi 的表达). User does not switch between assistant / creator / coding modes — Pi internally dispatches based on conversation context + active keycaps' skills.

```
User talks to Irisy
  ↓
Pi (brain) reads active keycaps' skills (ADR-024 axis 4)
  ↓ internal dispatch (invisible to user)
  ├── chat reply
  ├── create-keycap skill (was builtin-create persona)
  ├── translate skill (when translate keycap installed)
  ├── ocr skill (when OCR keycap installed)
  └── ...
```

**Keycap model** (frontend-relevant restatement):
> A keycap = Irisy 助手 (base persona) + 该 keycap 的 skill + 底座 (kernel substrate sub-systems).
> Installing a keycap adds a skill to Irisy. Irisy's voice / persona / chat surface stays the same; what she *can do* grows.

### §2 L1 navigation (locked)

L1 navigation collapses from current `[助理 / Create / Coding]` 3 chips to **`[Irisy / Coding]` 2 chips** (Irisy default + Coding is the Code Space coding-companion 工作流, ADR-017 surface).

| Before (deprecated) | After (locked 2026-05-30) |
|---|---|
| 助理 (builtin-assist chip) | **Irisy** (single chip; merged assist + create) |
| Create (builtin-create chip) | Removed — create-keycap is a skill inside Irisy, invoked by "帮我做个 keycap" |
| Coding | **Coding** (kept; ADR-017 ui_surface) |

Settings remains accessible via current cog in StatusBar / corner — not L1 nav chip.

### §3 Keyboard = drag-install dock

The Keyboard (always-on grid, memory `project_keyboard_vs_pool`) becomes the **drag-target for keycap installation**. Replaces current "Pool → install button" flow.

| Drag source | Effect |
|---|---|
| Pool keycap card → Keyboard | Installs to `~/.ctrl/keycaps/<id>/`, runs ADR-024 cap_asset provisioning (assets + vault folder + seed files), keycap appears on Keyboard grid |
| External `.zip` / `keycap.json` file → Keyboard | Same, after manifest validation (`packages/ctrl-keycap-sdk/manifest-schema.ts`) |
| GitHub URL (drag from address bar) → Keyboard | Fetch manifest from URL, validate, install (network-fetched install path per ADR-024 + ADR-011) |
| Keycap on Keyboard → trash zone | Uninstall (`rm -rf ~/.ctrl/keycaps/<id>/` per ADR-001 invariant #1) |
| Keycap on Keyboard → reorder within grid | Updates Keyboard layout state (persisted per-user) |

**Visual feedback**: drop zone highlights when dragging valid keycap; reject + toast for invalid manifest.

**Post-install effect**: installed keycap immediately available — Irisy detects new active skills + can invoke them in the next conversation turn. No restart, no "enable" toggle. Per bao "一旦安装, 就是新的功能".

### §4 What this amendment supersedes / amends

- **Supersedes** L1 nav locked 2026-05-29 (`[助理 / Create / Coding / Settings]`) — Create removed, Settings out of L1.
- **Amends** memory `project_keyboard_vs_pool` (Keyboard always-on grid + Pool picker). Pool stays as browse surface; install path now goes through drag-to-Keyboard instead of Pool's install button.
- **Aligns with** memory `decision_one_persona_irisy` (single user-facing persona, internal modes invisible) — restores after temporary 2026-05-30 morning `[助理 / Create]` 2-chip framing.
- **Aligns with** ADR-003 Brain (Pi sole brain, user never sees "Pi", internal dispatch).
- **Implementation requires** ADR-024 cap_asset.files / cap_asset.vault install-time provisioning (already in `P1.8 cap_asset loader` task).

### §5 Frontend implementation surface (handoff scope for the lane)

1. **Merge `packages/ctrl-keycaps/builtin/{builtin-assist, builtin-create}/` → `builtin-irisy/`** with union of: persona (single voice, assist base), skills (`create-keycap`, `validate-manifest`, `discover-skill`), capabilities (clipboard.write + network.http `api.github.com` + mcp.list_tools/invoke_tool + file.write `~/.ctrl/keycaps/*`), ui_surface (`chat-stream` default; form when create mode), cap_asset.vault seed (history/ + saved-replies/ + drafts/).
2. **PWA L1 nav** — update `packages/ctrl-web/src/components/PrimaryRail.tsx` NAV_ITEMS to `[Irisy, Coding]`. Remove Create icon + route.
3. **Keyboard drag-install** — `packages/ctrl-web/src/components/Keyboard/` (or wherever Keyboard component lives) accepts drop events; wires drop handler to existing `install_keycap` Tauri command.
4. **Pool install button** — remove or relabel "preview" (Pool is browse-only; install goes through Keyboard drop).
5. **Irisy chat** dispatches skills based on active keycaps. Skill lookup uses ADR-024 axis 4 manifest data. Atomic Pi-driven; PWA frontend ReAct (`lib/irisy-tools.ts`) is retired per ADR-003 §5.

### §6 Out of scope (do not bundle into this amendment)

- Pi brain spawn / supervisor / upgrade (ADR-003 owns that).
- Provider module integration (ADR-004 §9.1 owns that).
- Pool design overhaul (separate amendment if needed).
- Mobile-mode touch-drag keycap install — phase 2; desktop drag-install first.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial accept (bao verbal-go) |
| 2026-05-14 | ADR-003 supersedes mobile cross-device portion (mesh + WASM crypto) |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format |
| 2026-05-30 | Amendment: Irisy-as-sole-entry (assist + create merged into single `builtin-irisy`); L1 nav `[Irisy / Coding]` 2 chips; Keyboard becomes drag-install dock. bao directive "走 A 合并 + 助手 + skill + 底座 + 拖拽键盘". Aligns ADR-001 6th 校准 Pi-centric + ADR-003 Brain + memory `decision_one_persona_irisy`. Implementation lane handoff scope in §5. |
