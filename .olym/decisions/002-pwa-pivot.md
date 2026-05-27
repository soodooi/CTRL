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

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial accept (bao verbal-go) |
| 2026-05-14 | ADR-003 supersedes mobile cross-device portion (mesh + WASM crypto) |
| 2026-05-18 | Rewrite to olym 0.3.1 ADR format |
