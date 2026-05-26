# CTRL

> AI-native ambient OS 中枢 — press `Ctrl` to summon an ephemeral workspace; 1 keycap = 1 AI tool.

Private repository. Single deliverable: this repo (`soodooi/CTRL`). All Rights Reserved (see [LICENSE](./LICENSE)).

## Required reading (in order)

1. [`CLAUDE.md`](./CLAUDE.md) — project entry, rules, design philosophy, do-not-do list
2. [`.olym/steering/ctrl-strategy.md`](./.olym/steering/ctrl-strategy.md) — 5-minute navigator: positioning, 15 v1 keycaps, phase plan
3. [`.olym/decisions/INDEX.md`](./.olym/decisions/INDEX.md) — ADR registry (architectural decisions)

The full stack table and architecture diagram live in [CLAUDE.md](./CLAUDE.md) — single source of truth. This file stays minimal on purpose.

## Prerequisites

| Tool | Min version |
|---|---|
| Rust | 1.77+ stable (`rustup show`) |
| Node | 20 LTS, npm 10+ |
| Tauri CLI | 2.x (`cargo install tauri-cli --version "^2"` or via npm devDeps) |
| Platform | macOS 13+ (primary dev) / Windows 11 (secondary) |
| WebView | macOS 13+ (WKWebView) / Win 10 1809+ (WebView2 evergreen) — no extra install |

## First-time setup

```bash
git clone git@github.com:soodooi/CTRL.git
cd CTRL
npm install
```

## Run (development)

```bash
npm run tauri:dev
```

Tauri spawns the Rust shell, which boots the L1 kernel, opens the ST-SS WS bridge on `127.0.0.1:17872`, installs the tray icon, registers the lone-`Ctrl` hotkey, and loads the PWA from `http://localhost:5173` in the WebView.

PWA only (mobile testing in a regular browser):

```bash
npm run dev
# desktop: http://localhost:5173
# mobile : http://<lan-ip>:5173   (tunnel WS bridge via cloudflared if cross-router)
```

## Build (release)

```bash
npm run tauri:build
```

Outputs (current binary budget per ADR-003 + CLAUDE.md Stack table):

- macOS: `src-tauri/target/release/bundle/dmg/CTRL_*.dmg`
- Win: `src-tauri/target/release/bundle/msi/CTRL_*_x64_en-US.msi`

Budget: kernel ≤ 18 MB · installer ≤ 25 MB default / ≤ 18 MB slim (mesh-included).

## License

**All Rights Reserved.** See [LICENSE](./LICENSE). Private repository; no part of this source may be used, copied, or distributed without prior written permission. All packages are `private: true` with `license: UNLICENSED`.
