# CTRL

> An ambient AI layer that runs on your machine, with your own keys, that we can't see. Press `Ctrl`, get a workspace, talk to one assistant that routes to any tool.

## What is CTRL

CTRL is the local AI workbench for the **one-person company** — the solopreneur, indie founder, or freelancer who runs a whole company alone, wants AI as their team, and won't hand their business data to someone else's cloud.

Press `Ctrl` anywhere → an ephemeral workspace appears → you talk to **one** assistant (Irisy) that reads your intent and routes it to the right capability: an LLM, an installed MCP tool, a CLI, a skill. The surface *morphs* to the output — a doc, a table, an editable HTML page, code — which you can copy, export as a file, or save into a plain-markdown vault you fully own.

Three things separate it from "yet another local AI client":

- **Ambient, not an app you open.** One global hotkey, one morphing conversation, no tab-soup. Capabilities live in an open registry (MCP / CLI / Skills), so the UI stays simple while the ecosystem scales — scale lives in the registry, not the chrome.
- **Bring your own everything — keys, models, brain.** No CTRL account, no markup, no default model spend. You wire your own provider (Claude / the fal.ai aggregator / OpenAI / local Ollama); CTRL is the stitching layer, not the model vendor. Keys live in the OS keychain — we literally can't read them.
- **Plain-text all the way down.** Your notes are markdown + frontmatter — and so are the agent assets: tools (`.mcp.json`), skills (`SKILL.md`), memory (`CLAUDE.md` / `AGENTS.md`). Open them in vim in 100 years. There's no "export" because nothing was ever imported.

The economy is **share & be shared**: package a tool as a plain-text definition, publish it to the Discover commons, one-click install what others share — only definitions travel; data and keys never leave any machine. CTRL sells the substrate; the commons stays free and is the moat.

> Full positioning + architecture: [`.olym/decisions/006-cross-cutting.md`](./.olym/decisions/006-cross-cutting.md) §5 (positioning) + §6 (cold-start loop) · [`.olym/decisions/INDEX.md`](./.olym/decisions/INDEX.md) (7 module ADRs).

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
