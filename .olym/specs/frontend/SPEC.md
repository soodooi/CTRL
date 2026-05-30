---
module: frontend
purpose: PWA UI/UX — single React+Vite codebase, Tauri WebView on desktop + browser on mobile
lane_owner: daedalus
sub_specs:
  - .olym/specs/pwa-shell/
  - .olym/specs/pwa-workstation/
---

# frontend — module SPEC

> Entry page for the frontend (PWA) module. Single web codebase, two render targets (Tauri desktop / browser mobile).

---

## What this module is

`packages/ctrl-web/` is CTRL's only UI codebase. Runs as:

- **Desktop**: embedded in Tauri WebView (WebView2 / WKWebView), invokes kernel via Tauri `invoke()`
- **Mobile**: pure browser PWA (no React Native, no Capacitor), bridges to kernel via WebSocket + token (when in mobile-mode)

Two-panel layout (ADR-002 + memory `decision_pwa_two_panel_layout`): left Keyboard (always-on keycap grid) + right Workspace (current task surface).

## Code paths

- `packages/ctrl-web/src/app.tsx` · `main.tsx` — entry
- `packages/ctrl-web/src/routes/` — 8 routes (irisy / pool / code-space / vault / workspace / settings / icon-lab / default)
- `packages/ctrl-web/src/components/` — Keyboard / RightRail / StatusBar / TabBar / ClockStrip / KeycapCard / KeycapMenu / viewers/ (11 viewers) / vault/ / code-space/ / irisy/ / workspace/ / manifest/ / primitives/
- `packages/ctrl-web/src/lib/` — bridge / kernel invoke / viewer-registry / LLM transport / stores / asset-uri / icon
- `packages/ctrl-web/src/styles/` · `*.module.css` — CSS modules
- `packages/ctrl-web/vite.config.ts` — Vite + vite-plugin-pwa

## Owned ADRs

| ADR | Title | Status |
|---|---|---|
| [002](../../decisions/002-pwa-pivot.md) | Pivot UI to single PWA codebase under Tauri 2 | accepted |
| [020](../../decisions/020-vmark-stack-adoption.md) | VMark stack — viewer registry + vault browser + smart table | accepted |

Cross-references: ADR-001 §1.5 (vault stack libraries), Memory `decision_pwa_two_panel_layout` + `decision_pc_mirrors_mobile_layout` + `feedback_l1_nav_left_and_fixed`.

## Adjacent sub-specs

- `.olym/specs/pwa-shell/` — shell layout / right-rail / status-bar contract
- `.olym/specs/pwa-workstation/` — workspace / tab / viewer integration

## Current state (2026-05-26)

✅ shipped:
- PWA bootstrap (React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa)
- 8 routes + 2-panel layout (Keyboard + Workspace)
- 11 viewers (Markdown/Code/HTML/Image/JSON/Mermaid/PDF/SmartTable/SVG/TOML/YAML)
- Tiptap WYSIWYG markdown editor + CodeMirror 6 + mermaid.js + iframe+CSP
- ctrl-asset:// scheme consumed via `useViewerResource` / `asset-uri.ts`
- L1 nav fixed across all routes — left edge as of 2026-05-29, was right edge (memory `feedback_l1_nav_left_and_fixed`)
- Irisy ChatPane integrated (between main display and 副 nav)

⚠️ open:
- **G6 Vault new note/folder entry** — viewers are read-only paths today; user can't easily create new vault content from PWA
- **G7 Transparency UI** — keycap failure / drill-down to raw data not surfaced (philosophy #6)
- **G3 Workspace persistence UI** — `workspace-store.ts` has in-memory state, session restore on relaunch not wired (depends on substrate G3 backend)
- **G4 Keyboard 个性化 UI** — drag/reorder/pin/shortcut binding for Keyboard items not implemented (cap lane provides contract, frontend implements)
- Mobile-shaped layout (defer per "先 PC 端功能" 2026-05-26)

## Known drift / dead refs

- None major. Some legacy `decision_pwa_two_panel_layout` framing of "BottomTab 切右区" is still aspirational on mobile — desktop is fine.
