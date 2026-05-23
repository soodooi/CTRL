---
adr_id: 002
title: Pivot UI to single PWA codebase under thin Tauri 2 native shell
status: accepted
date: 2026-05-13
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/003-multi-device-mesh.md
scope: framework
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
- [x] *(amendment 2026-05-22)* 2-zone workbench layout: Keyboard 12-grid (left, persistent) + Workspace multi-tab (right, IDE-style) + Irisy drawer/bubble (auxiliary, never full-screen takeover)
- [x] *(amendment 2026-05-22)* Workspace tab type registry (renderer enum 10 types + `custom_component_path` for keycap-supplied React components); LifecycleShell does NOT hardcode keycaps
- [x] *(amendment 2026-05-22)* Non-chat-app discipline: `/` route = empty workspace tab model, NOT Irisy chat page; Irisy is auxiliary (drawer/bubble), never the main route

## Amendment 2026-05-22 — 2-zone workbench framing (non-chat-app)

bao 在 2026-05-22 session 钉死 PWA UX 范式 (memory `decision_ctrl_is_ai_workshop_not_chat` + `decision_pwa_two_panel_layout`):

**CTRL = AI 工作台, 不是 chat app**. PWA 类比 Cursor / Figma / Notion 持久工作面 + AI 辅助位, 不是 ChatGPT / Claude Desktop / Doubao 的 chat shell.

Layout 硬约束:

```
┌──────────────────────────────────────────────────────────────┐
│  Topbar (route-level)                                Irisy   │
├──────────────────────┬───────────────────────────────────────┤
│                      │                                       │
│  Keyboard            │   Workspace (multi-tab, IDE-style)    │
│  12-grid             │                                       │
│  always-on left      │   [vault] [keycap A] [Code Space] [+] │
│  persistent          │   ┌──────────────────────────────┐    │
│                      │   │ active tab content            │    │
│                      │   │ (renderer based on type)      │    │
│                      │   └──────────────────────────────┘    │
│                      │                                       │
├──────────────────────┴───────────────────────────────────────┤
│  Irisy drawer (slide up from bottom) — auxiliary             │
│  collapses to bubble when not in use                         │
└──────────────────────────────────────────────────────────────┘
```

- **Keyboard** (左) — daily-work always-on 12-grid; `~/.ctrl/keycaps/` shared with Pool
- **Workspace** (右) — IDE-style 多 tab, tab type 由 renderer enum 决定; 任意 keycap activation 落 tab, 不开新窗
- **Irisy** — 抽屉 / bubble; 永不取代 workspace 全屏; 跨 keycap 8-stage lifecycle 伴随 (Discovery / Creation / Config / Invoke / Collab / Debug / Improvement / Retire — 详见 ADR-016)
- **BottomTab** 只换右侧 workspace 内容; 禁止全屏单窗页跳转
- **不画 iPhone 边框 / 不画 bezel / 不画刘海** — 学手机 UX 解小屏高密度的技术方案, 不是 PC 容纳 mobile

Renderer enum (workspace tab type) — 10 types:
- `none` / `notification` / `modal` / `clipboard` / `html-output` / `chat-stream` / `picker` / `form` / `canvas` / `custom`
- `custom` 类型由 `manifest.workspace.custom_component_path` 指向 keycap-supplied React component (例: Code Space tile 走 `packages/ctrl-web/src/components/keycaps/CodeSpaceTab.tsx`)
- LifecycleShell 持 keycap-tab-registry, 不内置 keycap-specific dispatch

**Mobile UX 借鉴** ≠ **PC 渲染 mobile 容器**:
- 借鉴: 小屏高信息量的 stacking / sheet / drawer 技术方案
- 不借鉴: 容器边框 / 单页式 nav / hamburger

## Amendment 2026-05-22 — referenced ADR-013

PWA → Rust kernel bridge 不止 Tauri `invoke()` + ST-SS WS. **新增 MCP wire @ 127.0.0.1:17873** (ADR-013):
- 同 PWA 可通过 `mcp_server_info` 拿 URL+token, 在 mobile mode 直接 fetch MCP
- 外部 AI agent (Claude Code / Cursor / hermes) 同一份 wire
- 不影响 PWA 桌面端 Tauri invoke 默认路径

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial accept (bao verbal-go) |
| 2026-05-14 | ADR-003 supersedes mobile cross-device portion (mesh + WASM crypto) |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format |
| 2026-05-22 | Amend: 2-zone workbench layout (Keyboard + Workspace + Irisy drawer) + non-chat-app discipline + 10-type renderer enum + custom_component_path + reference ADR-013 MCP wire |
