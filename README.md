# CTRL

> AI-native ambient OS 中枢 — 按 `Ctrl` 唤起, ephemeral workspace, 1 键帽 = 1 AI 工具.

Private repository. Single deliverable: this repo (`soodooi/CTRL`). All Rights Reserved (see [LICENSE](./LICENSE)).

For full context read in order:
1. [`CLAUDE.md`](./CLAUDE.md) — project entry, rules, do-not-do list
2. [`.olym/steering/ctrl-strategy.md`](./.olym/steering/ctrl-strategy.md) — 5-minute navigator: positioning, 15 keycaps, phase plan
3. [`.claude/ADR/INDEX.md`](./.claude/ADR/INDEX.md) — architecture decisions registry

## Stack

Per [ADR-001](./.claude/ADR/001-system-architecture.md) (architecture spine) + [ADR-002](./.claude/ADR/002-pwa-pivot.md) (UI layer, accepted 2026-05-13):

| Layer | Tech |
|---|---|
| L3 Userland (keycaps) | WASM sandbox (wasmtime), declarative manifests |
| L2 SDK | TypeScript (`@ctrl/{kernel-sdk, stss, memory}`) + Rust |
| L1 Kernel | Rust microkernel (5 primitives: Actor / Capability / Event / Channel / Effect) |
| L0 Native shell | Tauri 2 + ~500 LOC Rust shell (hotkey / tray / keychain / kernel daemon supervisor) |
| Product UI | Single PWA codebase (`packages/ctrl-web`) — React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa |
| Web bridge | Tauri 2 `invoke()` on desktop, WebSocket fallback on mobile (`packages/ctrl-web/src/lib/bridge.ts`) |
| Stream protocol | ST-SS (CBOR Cell/Op over WS @ 17872) — `kernel::stss_bridge` |
| LLM (Pattern D) | CF Workers AI (subscription default) + BYOK Anthropic/OpenAI + local Ollama |
| Backend | Cloudflare Workers (`ctrl-auth`, `ctrl-billing`, `ctrl-market`, `ctrl-push`) — separate `ctrl-cloud` repo |

## Prerequisites

| Tool | Min version |
|---|---|
| Rust | 1.77+ stable (`rustup show`) |
| Node | 20 LTS, npm 10+ |
| Tauri CLI | 2.x (`cargo install tauri-cli --version "^2"` or via npm devDeps) |
| Platform | Windows 11 (primary dev) / macOS 13+ (secondary) |
| WebView | Win 10 1809+ (WebView2 evergreen) / macOS 13+ (WKWebView) — no extra install |

## First-time setup

```bash
git clone git@github.com:soodooi/CTRL.git
cd CTRL
npm install                  # installs all workspaces (ctrl-web, ctrl-stss, ctrl-memory, ctrl-kernel-sdk, olym-core)
```

## Run (development)

```bash
# Tauri 2 desktop shell + PWA dev server (vite HMR), one command:
npm run tauri:dev
```

Tauri spawns the Rust shell, which boots the L1 kernel, opens the ST-SS WS bridge on `127.0.0.1:17872`, installs the tray icon, registers the low-level keyboard hook for lone-Ctrl detection, and loads the PWA from `http://localhost:5173` in the WebView.

**To run only the PWA in a regular browser (mobile testing):**

```bash
npm run dev                  # @ctrl/web vite dev server on :5173
# then open http://localhost:5173 (desktop) or http://<lan-ip>:5173 (mobile)
```

PWA in a browser falls back to the WebSocket bridge on `ws://127.0.0.1:17872`; for mobile across a router, tunnel the bridge with `cloudflared tunnel --url ws://localhost:17872`.

## Build (release)

```bash
npm run tauri:build
```

Outputs:
- Win: `src-tauri/target/release/bundle/msi/CTRL_*_x64_en-US.msi`
- macOS: `src-tauri/target/release/bundle/dmg/CTRL_*.dmg`

Binary size budget (per ADR-002 §16 + P3.9 hardening gate): kernel ≤ 15 MB, installer total ≤ 25 MB default / ≤ 15 MB slim.

## Architecture

```
L3 Userland (WASM sandboxed actors)
    ↑↓ typed message passing
L2 SDK (@ctrl/{kernel-sdk, stss, memory, desktop})
    ↑↓ syscall-like API
L1 Kernel (Rust microkernel: Actor / Capability / Event / Channel / Effect)
                                                      daemon @ 127.0.0.1:17872 (ST-SS WS)
    ↑↓ Tauri 2 invoke() on desktop / WS on mobile
L0 Tauri 2 Native Shell (~500 LOC: Hotkey / Tray / Keychain / Kernel supervisor)
    ↑↓ embeds WebView2 (Win) / WKWebView (Mac)
PWA (packages/ctrl-web) — single web codebase
    ├ desktop: runs in Tauri WebView
    └ mobile : runs in any browser (Add to Home Screen)
```

5 primitives only at L1. See [`.olym/specs/kernel/spec.md`](./.olym/specs/kernel/spec.md) for the Rust API surface.

## Repository layout

```
CTRL/
├── src-tauri/                          L0 Tauri shell + L1 Rust kernel + commands
│   └── src/
│       ├── shell/                      Tauri 2 native shell (hotkey/tray/window/kernel_supervisor/keychain)
│       ├── commands/                   #[tauri::command] handlers (kernel/stss/memory/keychain)
│       ├── kernel/                     L1 microkernel (5 primitives + mcp_host + stss_bridge + persistence)
│       └── bin/                        helper binaries (stss spike, keychain seeder)
├── packages/
│   ├── ctrl-web/                       PWA (React + Vite + vite-plugin-pwa)
│   ├── ctrl-stss/                      ST-SS protocol TS impl (99 tests)
│   ├── ctrl-memory/                    client-side event log TS impl
│   ├── ctrl-kernel-sdk/                L2 syscall surface (TS, mirrors Rust kernel)
│   ├── olym-core/                      olym-core SSOT (copy from hello-olym)
│   └── olym-desktop/                   desktop olym variant
├── share/
│   └── stss-spike/                     standalone WS server + browser viewer (reference)
├── doc/
│   ├── visual-identity/                logo SVGs + brand-tokens.md (single source of truth)
│   └── reference/                      design references (logo png, etc)
├── .claude/
│   ├── ADR/                            architecture decisions (numbered, never deleted)
│   └── PRPs/                           legacy PRP docs (historical; superseded by ADR + specs)
└── .olym/
    ├── steering/                       ctrl-strategy.md (5-minute navigator)
    ├── specs/                          domain specs (kernel, pwa-shell, stss, tool-manifest, …)
    └── handoffs/                       work items (H-YYYY-MM-DD-NNN)
```

## License

**All Rights Reserved.** See [LICENSE](./LICENSE). Private repository; no part of this source may be used, copied, or distributed without prior written permission.
