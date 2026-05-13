# ADR-002: PWA UI Pivot — Tauri 2 Native Shell + Shared Web Codebase

- **Status**: **Accepted** (bao 2026-05-13)
- **Date**: 2026-05-13 (proposed), 2026-05-13 (accepted)
- **Decision makers**: bao
- **Supersedes (partial)**: `.claude/ADR/001-system-architecture.md` §3.1 (UI rendering layer), §6 items #1/#7-9/#13/#15 (delivery surface), §10 (15 keycap delivery shape)
- **Preserves (untouched)**: ADR-001 5 primitives, 5 keycap sources, Pattern D LLM strategy, creator economy, repository topology, 不做清单, 18 底座 protocol/data/commercial layers
- **Triggers**: Session `079eb101` (2026-05-13 09:55–10:47), bao confirm `好，按照P2方向做规划` (2026-05-13)
- **References**: ADR-001, `.olym/specs/win-shell/spec.md` (partial deprecate), `.olym/specs/mac-shell/spec.md` (partial deprecate), `.olym/specs/pwa-shell/spec.md` (new)

---

## 1. Decision

CTRL adopts a **PWA-first UI architecture** with a **minimal native shell** (Tauri 2 host) on desktop. All product UI, keycap surfaces, marketplace, and creator manifest editor live in a single PWA codebase (`packages/ctrl-web`), shared across Win desktop, Mac desktop, and mobile (iOS/Android) browsers.

The native shell shrinks to ~500 LOC of Rust + Tauri 2 capability config, providing **only** the four functions PWA cannot provide: global `Ctrl` hotkey, system tray, MCP stdio process spawn, and OS keychain. The Rust kernel (5 primitives, MCP host, persistence) runs as a localhost daemon hosted by the shell, exposing a WebSocket bridge to the embedded WebView.

**Mobile lane is pure PWA** — no React Native, no Capacitor, no SwiftUI client. Mobile users open a URL or "Add to Home Screen" to install. Mobile is a thin client; full keycap host responsibilities remain on desktop.

**Brand promise preserved**: `按 Ctrl 唤起 → ephemeral workspace → 1 键帽 = 1 AI 工具`. The hotkey is the one feature the native shell exists to defend.

---

## 2. Why this changes now (delta from ADR-001)

ADR-001 specified L0 Tauri Native Shell + native UI per-platform (WinUI 3 / SwiftUI). After W3 (Win shell W3.1–W3.6) shipped real WinUI 3 surfaces, two product realities surfaced in the 2026-05-13 design session:

| Reality | Source | Forces toward |
|---|---|---|
| Cross-device "share URL → mobile sees stream → send Op back to PC" is a defining UX | bao 2026-05-13 09:55 prompt + ST-SS multi-terminal mesh | Mobile must be reachable without app store / install / build pipeline |
| Native UI dual-stack (WinUI 3 + future SwiftUI) doubles UI work, fragments design system, slows visual iteration | W3 review + Mac spec未启动 | One UI codebase across Win/Mac/mobile |
| Web stack iteration speed (Vite HMR, design tokens, component libraries) >> native UI iteration | Industry baseline (Linear, Notion, Cursor, Figma) | UI in HTML/CSS/JS |
| Hotkey, tray, MCP stdio, keychain are non-negotiable and PWA-impossible | Browser sandbox limits | Keep a thin native shell on desktop |

**Conclusion**: invert the architecture. Native shell becomes thin (~500 LOC), PWA becomes the product.

---

## 3. New 4-layer rendering (revises ADR-001 §3.1)

```
┌──────────────────────────────────────────────────────────────────┐
│ L3 Userland (WASM sandboxed actors — UNCHANGED)                 │
│  键帽 actors / 硬件 source actors / LLM call actors / OAuth /    │
│  Tool runtime actors                                             │
└────────────────────────────┬─────────────────────────────────────┘
                             │ typed message passing (UNCHANGED)
                             ↓
┌──────────────────────────────────────────────────────────────────┐
│ L2 SDK (TS + Rust dual — UNCHANGED)                             │
│  @ctrl/kernel-sdk · @ctrl/stss · @ctrl/memory · @ctrl/desktop   │
└────────────────────────────┬─────────────────────────────────────┘
                             │ syscall-like API (UNCHANGED)
                             ↓
┌──────────────────────────────────────────────────────────────────┐
│ L1 CTRL Kernel (Rust microkernel — UNCHANGED)                   │
│  Actor Scheduler · Capability Broker · Event Bus · LLM Port ·    │
│  MCP Host · Persistence (event-sourced)                          │
│  ↓ NEW: spawned as localhost daemon, exposes WS bridge :17872    │
└────────────────────────────┬─────────────────────────────────────┘
                             │ Tauri 2 IPC (replaces UniFFI/cbindgen for UI calls)
                             │ stdin/stdout (kernel ↔ MCP servers, UNCHANGED)
                             ↓
┌──────────────────────────────────────────────────────────────────┐
│ L0 Tauri 2 Native Shell (~500 LOC — REVISED)                    │
│  Hotkey · Tray · WebView host · Kernel daemon supervision ·      │
│  Keychain · Update channel                                       │
└────────────────────────────┬─────────────────────────────────────┘
                             │ embeds WebView2 (Win) / WKWebView (Mac)
                             ↓
┌──────────────────────────────────────────────────────────────────┐
│ NEW: packages/ctrl-web — single PWA codebase                    │
│  KeycapPool · WorkspacePage · Marketplace · Manifest editor ·    │
│  Settings · ST-SS viewer · AI 创作助手 chat                       │
│  ────────                                                        │
│  Service worker (offline cache, push) · manifest.webmanifest    │
│  Mobile: opens at https://app.ctrl.run as standalone PWA        │
│  Desktop: same code loads inside WebView at tauri://localhost   │
└──────────────────────────────────────────────────────────────────┘
```

**Key invariants preserved from ADR-001**:
- 5 primitives (Actor / Capability / Event / Channel / Effect) — no change
- 5 keycap sources — no change
- Capability-based security — strengthened (PWA cannot escape WebView sandbox; native syscalls only via explicit Tauri command allowlist)
- Event-sourced persistence — no change
- Rust kernel — no change to internal design, only deployment shape (in-process → localhost daemon)

---

## 4. The four native-shell responsibilities (PWA-impossible)

These are the ONLY justifications for keeping native code on desktop. Anything else lives in PWA.

| # | Responsibility | OS API | Why PWA cannot do it |
|---|---|---|---|
| 1 | **Global `Ctrl` hotkey** | Win32 `RegisterHotKey` + `WM_HOTKEY` pump / macOS `CGEventTap` | Browsers cannot register OS-level hotkeys; key events only delivered when WebView focused |
| 2 | **System tray icon** | Tauri 2 `tauri-plugin-positioner` + `SystemTray` API | Browsers have no tray API; PWA "shelf" is OS-managed and not programmable |
| 3 | **MCP stdio process spawn** | Tokio `Command::new` (via Rust kernel) | Browsers cannot spawn arbitrary local processes; required for 10,000+ MCP servers per ADR-001 §4 |
| 4 | **OS keychain for BYOK** | Tauri 2 `keyring` plugin (Win Credential Vault / macOS Keychain) | Browsers only have IndexedDB / WebCrypto; insufficient for BYOK API key security |

If any future PWA web standard collapses one of these (e.g. permanent SharedHotkey API), revisit this ADR.

---

## 5. PWA stack (locks)

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **React 18 + Vite 5** | Aligns with existing `src/` (current Tauri React UI), team already in this stack |
| Routing | **TanStack Router** | Type-safe, search-param-as-state aligns with web/patterns.md |
| Server state | **TanStack Query** | Aligns with web/patterns.md |
| Client state | **Zustand** (minimal) | Default per web/patterns.md |
| Forms | **React Hook Form + Zod** | Zod already in dep tree (manifest schemas) |
| Styling | **CSS modules + design tokens (`:root` custom properties)** | No Tailwind by default — protects against template look per CLAUDE.md design-quality rule |
| Animation | **Framer Motion** for UI transitions; **CSS** for keycap hover/active | Compositor-friendly per web/performance.md |
| PWA tooling | **Vite PWA plugin** (`vite-plugin-pwa`) | service worker, manifest, push subscription, offline cache |
| Push transport | **Web Push (VAPID)** via new `ctrl-push` worker | iOS 16.4+ and Android both support |
| Bridge (web ↔ Rust kernel) | **Tauri 2 `invoke()`** on desktop, **WebSocket** when running in mobile browser | One JS API, two transports underneath |
| Bundle budget | **< 300 kB gzipped** for app shell, lazy-load market + manifest editor | Per web/performance.md app page budget |

**Anti-template guardrails** (per `web/design-quality.md`):
- No default Tailwind+shadcn cards-grid look
- No generic gradient hero
- Visual direction = OP-1 / Braun / Linear / Cursor (per `ctrl-strategy.md` line 17)
- Default theme = dark, deliberate (not auto-dark per OS)
- Typography pairing = mono for keycap labels, sans for content

---

## 6. Native shell stack (Tauri 2)

| Concern | Choice | Rationale |
|---|---|---|
| Shell | **Tauri 2** (stable 2.x channel) | Reuses existing `src-tauri/` with P2 kernel already in place; cross-platform (Win + Mac) single Rust codebase |
| Window | Frameless, always-on-top, `decorations: false`, transparent backdrop | Mica on Win 11, vibrancy on Mac |
| Hotkey | `tauri-plugin-global-shortcut` | Cross-platform `Ctrl` registration |
| Tray | `tauri-plugin-tray` | Built-in tray icon + menu |
| Keychain | `tauri-plugin-stronghold` (Win Credential / macOS Keychain) | Built-in OS keychain bridge |
| Updater | `tauri-plugin-updater` | Auto-update channel from `ctrl-cloud` static asset host |
| Kernel daemon | Spawned by shell on app launch, child process supervision | Same Rust binary, two entry points (`shell` + `kernel-daemon`) |
| WebView | WebView2 (Win, Edge Chromium, evergreen) / WKWebView (Mac) | Tauri 2 default, no shipping our own runtime |
| WebView load source | `tauri://localhost` serving bundled PWA in production; `http://localhost:5173` Vite dev in dev | Same security model as Tauri |
| IPC allowlist (capabilities) | Strict allowlist in `tauri.conf.json` | Capability-based principle from ADR-001 §3.2 propagates to JS↔Rust boundary |

**Why Tauri 2 over custom-tiny-shell**:
1. `src-tauri/` already contains P2 kernel + UniFFI bindings → reuse, not throw away
2. Cross-platform single source (vs. WinUI 3 + future SwiftUI = 2 codebases)
3. Battle-tested updater, tray, hotkey plugins (stronger than rolling our own)
4. Mature WebView lifecycle (drag/drop, devtools toggle, zoom, multi-window)
5. Tauri 2 is *not* Tauri Mobile — we are not relying on mobile alpha; mobile lane is pure browser PWA

**Why not Electron**: ships Chromium runtime (~150MB), violates lean install promise. WebView2/WKWebView are evergreen system components.

---

## 7. W3 (Win shell) asset disposition

Current state per recent commits (`450cbda`, `0ec0bc2`, `793d36a`, `cf40993`, `5b651fc`, `dc8518a` etc.) and uncommitted hotkey refactor.

### Preserve (move/refactor into Tauri 2 shell)

| W3 asset | Disposition | New home |
|---|---|---|
| `win/CTRL/Services/HotkeyService.cs` | **Logic preserved**, port to Rust via `tauri-plugin-global-shortcut` | `src-tauri/src/shell/hotkey.rs` |
| `win/CTRL/Services/HotkeyInterop.cs` | Replaced by Tauri plugin | (deleted) |
| `win/CTRL/Services/TrayInterop.cs` | Replaced by `tauri-plugin-tray` | (deleted) |
| `win/CTRL/Services/KernelErrors.cs` (uncommitted) | **Logic preserved**, port to Rust error enum | `src-tauri/src/kernel/errors.rs` |
| `win/CTRL/Services/Win32.cs` (uncommitted) | Mostly obsoleted by Tauri plugins; keep any focus-loss specifics | `src-tauri/src/shell/window.rs` |
| `win/CTRL/Bindings/CtrlNative.cs` + `CtrlBindings.cs` | Replaced by Tauri 2 `invoke()` (JS→Rust) | (deleted, replaced by `src-tauri/src/commands/`) |
| `win/CTRL/App.xaml.cs` lifecycle (kernel boot, focus-loss hide, modal guard) | Logic preserved, port to Rust shell | `src-tauri/src/shell/lifecycle.rs` |
| MCP roundtrip wiring (W3.6, commit `0ec0bc2`) | **Fully preserved** — kernel-side already in Rust | (no change) |

### Delete (UI rewritten in PWA)

| W3 asset | Reason |
|---|---|
| `win/CTRL/Pages/KeycapPoolPage.xaml` (+`.cs`) | Re-implemented in `packages/ctrl-web/src/routes/pool.tsx` |
| `win/CTRL/Pages/WorkspacePage.xaml` (+`.cs`) | Re-implemented in `packages/ctrl-web/src/routes/workspace.tsx` |
| `win/CTRL/Models/Keycap.cs` | Re-implemented in `packages/ctrl-web/src/types/keycap.ts` (already aligned to Zod manifest schema) |
| `win/CTRL/Views/Components/*` (KeycapCard, SpringHover, etc.) | Re-implemented as React components |
| `win/CTRL/Resources/Tokens.json` | Re-emitted as CSS custom properties in `packages/ctrl-web/src/styles/tokens.css` (single source of truth) |
| `win/CTRL/Package.appxmanifest` (MSIX packaging) | Replaced by Tauri 2 bundler config |
| `win/CTRL/CTRL.csproj`, `win/CTRL.sln`, `.NET 8` toolchain | No more C# in CTRL |

**Net code delta** (estimated): −~1500 LOC C#/XAML, +~500 LOC Rust shell, +~3000 LOC TypeScript/CSS PWA.

**Net repo simplification**: drop entire `win/` tree, drop .NET 8 / WindowsAppSDK / Visual Studio prerequisites. Single Rust toolchain + Node 20 LTS.

---

## 8. Mobile lane (PWA only)

Per ADR-001 5 keycap sources, mobile cannot host MCP stdio processes or local agents. Mobile is therefore a **thin client** in v1:

| Capability | Mobile PWA | Justification |
|---|---|---|
| View desktop's stream (ST-SS subscriber) | ✅ | WebSocket to desktop kernel daemon (LAN) or via cloud relay (NAT) |
| Send Op back to desktop (e.g. trigger keycap) | ✅ | Same WS channel |
| Push notification on stream event | ✅ | Web Push via `ctrl-push` worker |
| Install to home screen | ✅ | manifest.webmanifest |
| Add new MCP server | ❌ (v1) | No local stdio spawn; defer to v1.x with cloud-hosted MCP proxy |
| Run keycaps locally | ❌ (v1) | Sandbox + local LLM not viable on mobile in v1 |
| Read/write local clipboard automatically | ⚠️ partial | iOS: tap-to-paste only; Android: same |
| Background WS connection | ❌ | Mobile suspends WS; rely on Web Push to wake |

**Mobile UX shape**: bento-style stream tiles per device, tap-to-focus, swipe between devices. Aligns with prior session's wireframe (Hub / Stream Viewer / Compose).

---

## 9. ctrl-cloud delta

Three workers per ADR-001 §7. PWA pivot adds one and unchains another:

| Worker | ADR-001 status | ADR-002 delta |
|---|---|---|
| `ctrl-auth` | Spec'd, P8 | No change — JWT issued by auth, PWA uses standard `Authorization: Bearer` |
| `ctrl-billing` | Spec'd, P8 | No change |
| `ctrl-market` | Spec'd, P9 | **Becomes more central** — manifest editor in PWA publishes directly to ctrl-market; market also serves as PWA's static asset host (`https://market.ctrl.run`) |
| `ctrl-push` (NEW) | — | VAPID Web Push subscription registry + dispatch on ST-SS stream events. Small (~200 LOC TS), Phase P8 alongside auth/billing |
| Optional `ctrl-relay` (NEW, deferred) | — | LAN-impossible mobile↔desktop bridge via cloudflared-style tunnel; defer to P11+ post-launch if NAT traversal is a problem |

**Static asset host for PWA**: serve `packages/ctrl-web/dist/` from Cloudflare Pages or as a Worker static asset binding. URL: `https://app.ctrl.run`. Service worker scope = root. Updater on desktop fetches from same origin.

---

## 10. Phase plan (revises ADR-001 §9)

| Phase | Content | Status | Change |
|---|---|---|---|
| P0 | Legal cleanup | ✅ done 2026-05-11 | unchanged |
| P1 | CTRL workspaces + olym-core | ✅ done | unchanged |
| P2 | L1 Kernel skeleton (5 primitives) | ✅ done (W3.1-W3.6 era) | unchanged |
| P3 | L2 SDK (@ctrl/stss + @ctrl/memory cherry-pick) | ✅ done (P3.5 hardening complete) | unchanged |
| **P3.7 (NEW)** | **Tauri 2 shell migration + W3 deprecation + kernel-as-daemon refactor** | next, this handoff | NEW between P3 and P4 |
| **P3.8 (NEW)** | **`packages/ctrl-web` PWA scaffold + first 3 routes (Pool / Workspace / Settings)** | depends P3.7 | NEW |
| **P3.9 (NEW)** | **Kernel hardening** — scheduler deadline-aware + priority; sandbox WASM (advanced from P7); mcp_host introspection cache; persistence indexed query + retention; binary size budget gate (≤ 15 MB) | parallel with P3.8 | NEW |
| P4 | MCP host integration | ✅ partially done (W3.6 MCP roundtrip) | preserved |
| P5 | Tool manifest spec implementation | depends P3.8 | UI now in PWA |
| **P6** | **AI 创作向导 (manifest generator)** | depends P5 | **v1.0 mandatory** — gate for "客户能 0 代码集成 1 个键帽" success criterion |
| P7 | 5 P0 built-in keycaps (sandbox dependency satisfied by P3.9) | depends P3.9 + P5 | keycap UI now in PWA; WASM sandbox moved into P3.9 |
| P8 | `ctrl-cloud` + ctrl-auth + ctrl-billing + **ctrl-push** | parallel P7 | +ctrl-push |
| P9 | ctrl-market + creator revenue share | depends P8 | manifest editor now in PWA; **v1.0 includes seed marketplace (no affiliate yet)** |
| **P9.5 (NEW)** | **`ctrl-affiliate` worker + 智识 + 比价 keycap + 联盟归因** | depends P9 | **v1.1** — electronic commerce extension; ADR-001 spine untouched, all source via MCP |
| P10 | Closed beta (v1.0) | depends P7-P9 | unchanged |
| P11+ | Hardware actor SDK + 1-2 hardware demos + optional ctrl-relay | post-launch | +relay deferred |

---

## 11. Risk register (delta)

| Risk | Severity | Mitigation |
|---|---|---|
| Tauri 2 plugin churn (global-shortcut, tray APIs) | 🟡 | Pin to stable 2.x; audit plugin maturity before W3 deprecate |
| Kernel-as-daemon refactor introduces race in startup ordering | 🟡 | Shell awaits daemon ready signal before showing window; hotkey deferred until daemon up |
| WebView2 not present on Win 10 LTSC / older builds | 🟡 | Tauri 2 bundler can ship WebView2 bootstrapper; documented min OS = Win 10 1809 |
| PWA service worker bug locks users on stale build | 🟡 | Strict cache versioning, "skipWaiting + reload on update" pattern, kill-switch via response header |
| Mobile Web Push reliability (iOS 16.4+ only) | 🟢 | Documented, fall back to in-app polling when push unavailable |
| Brand loss if "Ctrl" key is platform-restricted (e.g. macOS Karabiner conflicts) | 🟡 | Reuse W3.2 single-tap detection logic; document fallback to user-configured hotkey |
| Sunk cost concern over W3 C#/XAML | 🟢 | W3 was hotkey/tray/MCP validation; that work survives via Rust port. UI-layer XAML is acceptable loss (~1000 LOC) |
| Mobile users expect "real app" on App Store | 🟢 | Phase P11+ optional Capacitor wrap if metrics justify; not in v1 scope |

---

## 12. Decision-amendment process (bao 2026-05-13 ask: "以后的更新也要有方案，版本控制")

Codify ADR + handoff lifecycle:

1. **ADR numbering**: monotonically increasing (`001`, `002`, …). New ADR may amend or supersede prior; prior ADR is never deleted.
2. **Status lifecycle**: `Proposed` → `Accepted` (bao confirms) → `Superseded` (later ADR amends) / `Rejected` (bao declines).
3. **Handoff IDs**: `H-YYYY-MM-DD-NNN` per existing convention. One handoff per discrete deliverable.
4. **Spec lifecycle**: `Draft v0.x` → `Stable v1.0` after first implementation passes acceptance.
5. **Cross-references**: every ADR lists what it preserves/supersedes from prior ADRs (this ADR §0). Every spec lists parent ADR.
6. **Steering doc** (`ctrl-strategy.md`): updated within same PR as ADR acceptance — never lags.

This ADR is the first to formalize the protocol. Apply retroactively to ADR-001 (already follows pattern by accident).

---

## 13. Success criteria (validate ADR-002 acceptance)

- ✅ `Ctrl` hotkey wakes Tauri 2 shell ≤ 80 ms cold, ≤ 30 ms warm (matches current W3 latency)
- ✅ PWA loads inside Tauri 2 WebView in < 500 ms warm cache
- ✅ Same `packages/ctrl-web` build runs unchanged in mobile Safari/Chrome
- ✅ Kernel daemon survives shell crash and reconnects on shell restart (supervision)
- ✅ MCP roundtrip from PWA → kernel daemon → MCP server → back to PWA in < 200 ms (matches W3.6 baseline)
- ✅ Bundle size for PWA app shell < 300 kB gzipped (per web/performance.md)
- ✅ Visual identity does not look like default React + Tailwind template (per CLAUDE.md anti-template policy)

If any of these fail measurably during P3.7 or P3.8, return to ADR review.

---

## 14. Open questions (deferred)

| Question | Defer until |
|---|---|
| Custom domain for PWA (`app.ctrl.run` vs `ctrl.run/app`) | P8 (when ctrl-cloud DNS provisioned) |
| Service worker update strategy: silent vs prompt user | P3.8 (after first PWA build) |
| Mobile bento layout: device-per-tile vs stream-per-tile | P3.8 wireframe |
| Tauri 2 WebView devtools toggle in production builds | P3.7 |
| Kernel daemon IPC: WS only, or also Unix domain socket / named pipe for lower latency | P3.7 prototype |
| Where to host `packages/ctrl-web/dist/` (Cloudflare Pages vs Workers static) | P8 ctrl-cloud setup |

---

## 15. What remains explicitly out-of-scope for ADR-002

This ADR does NOT change:

- 5 kernel primitives (Actor / Capability / Event / Channel / Effect)
- 5 keycap sources (MCP / OAuth / Local agent / ST-SS / Built-in)
- LLM Pattern D (CF Workers AI default + BYOK + Ollama)
- Creator economy (manifest schema, AI 创作助手, ctrl-market, revenue share)
- Repository topology (single CTRL repo + ctrl-cloud + olym-core SSOT in hello-olym)
- 不做清单 (no workflow editor, no hardware vendor, no long-tail adapter farm, no Quicker clone, no GPT clone, no mamamiya tenant)
- License (All Rights Reserved, all sub-packages `private: true` + `license: UNLICENSED`)
- CLAUDE.md disciplines (no `wrangler dev`, no `--no-verify`, English code + Chinese docs)

Anyone reading ADR-002 in isolation should re-read ADR-001 §1, §4, §5, §6, §10 (the unchanged spine) before designing anything.

---

## 16. Acceptance

**Status: Accepted by bao on 2026-05-13.**

Acceptance scope:
- §1–§15 locks confirmed; mobile lane = pure browser PWA; desktop = Tauri 2 + ~500 LOC Rust shell + Rust kernel daemon.
- Phase plan (§10) **revised on acceptance** to add P3.9 (Kernel hardening), mark P6 as v1.0-mandatory, add P9.5 (ctrl-affiliate, v1.1).
- Kernel binary size budget: **≤ 15 MB stripped+LTO release** (enforced by P3.9 CI gate). Total desktop installer target: **≤ 25 MB** (P2 default) / **≤ 15 MB** (P2-slim).
- H-2026-05-13-001 moves from `proposed` → `open`; execution divided into 5 sub-PR gates (a/b/c/d/e per handoff §讨论), HARD GATE on `git rm -r win/` (step e) is end-to-end demo passing in step d.
