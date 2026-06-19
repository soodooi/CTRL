---
paths:
  - "src-tauri/**"
  - "packages/**"
---

# CTRL Stack + Repository topology (reference)

> Reference content split out of CLAUDE.md (Anthropic best practice: keep CLAUDE.md < 200 lines, move reference to `.claude/rules/`). Path-scoped — loads when working under `src-tauri/` or `packages/`.

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2 (~500 LOC Rust shell: hotkey / tray / keychain / kernel daemon supervisor) |
| Kernel (L1) | Rust stable 1.77+, Tokio async runtime, ST-SS WS bridge @ 127.0.0.1:17872 (token-authenticated) |
| Sandbox | OS-level subprocess isolation (sandbox-exec / landlock / AppContainer) + Tauri 2 Capability + Isolation Pattern + CSP. **WASM removed** in 0.1.39 lean kernel (ADR-001 spine § philosophy #1+#4 v1) — re-evaluate via WasmEdge if v1.x needs in-process untrusted code. |
| UI | Single PWA (`packages/ctrl-web`) — React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa |
| Vault viewers | **Tiptap** (markdown WYSIWYG+source) + **CodeMirror 6** (code/JSON/YAML/TOML/HTML) + **mermaid.js** (mermaid graphs) + iframe+CSP (HTML sandbox) — content-type viewer registry, replaces VMark MCP sidecar (S15 deprecated 2026-05-25) |
| Vault index | SQLite FTS5 (`src-tauri/src/kernel/vault_index.rs`) + backlink scanner + tag scanner (kernel-native, no VMark dep) |
| Brain | **No CTRL-bundled general-purpose brain — 2 parallel paths, both gated at `:17873`** (ADR-002 substrate § brain v28). (1) **Irisy brain = Hermes Agent** (NousResearch, CTRL bundles + launches it, dashboard `:17890`). (2) **BYO-CLI driver** = user's own local CLI (Claude Code flagship); kernel `projector.rs` materializes assets into its native config (`.mcp.json` etc.), CTRL does not supervise. **Pi retired** (v19, 2026-06-09). opencode reserved (unwired); ACP demoted to future channel. |
| Web ↔ Rust bridge | Tauri 2 `invoke()` on desktop (intra-process), WebSocket + token on mobile |
| Stream protocol | ST-SS (CBOR Cell/Op) |
| Package manager | npm workspaces |
| State persistence | SQLite (event-sourced) + Automerge CRDT (cross-device, ADR-002 substrate § crypto v1, v1.1+ scope) |
| **Mesh comm** (ADR-002 substrate § crypto v1, v1.1+ scope) | **vodozemac (Olm 1:1) + webrtc-rs v0.17.x + Automerge v0.7.x + mdns-sd v1.71+ + ctrl-relay CF Worker** |
| LLM (default) | CF Workers AI (Qwen / Llama) |
| LLM (BYOK) | Anthropic Claude / OpenAI GPT-4 |
| MCP | Anthropic rmcp Rust SDK |
| Subprocess execution | portable-pty 0.9 (Unix forkpty + Windows ConPTY) via `kernel::subprocess_actor` — ADR-002 substrate § subprocess v1 |
| Backend (cloud) | Cloudflare Workers + D1 (ctrl-auth / ctrl-billing / ctrl-market / **ctrl-relay** / ctrl-push) |
| Payments | Stripe |
| Min platform | Windows 10 1809+ (primary Win 11+ dev; ADR-003 frontend § pwa v2 — WebView2 bootstrapper covers 10), macOS 13+ (secondary), iOS 16.4+ PWA, Android Chrome PWA, WebView2 / WKWebView evergreen |
| Mobile | Pure browser PWA (no React Native, no Capacitor) + WebRTC + WASM vodozemac + WASM Automerge |
| Node | 20.x LTS |
| Rust | 1.77+ stable |
| Binary size | kernel ≤ 18 MB (ADR-002 substrate § crypto v1), installer ≤ 25 MB default / ≤ 18 MB slim (mesh-included) |
| PWA bundle | ≤ 500 KB gzip (ADR-002 substrate § crypto v1); critical-path shell ≤ 200 KB, mesh modules lazy-load |
| Local ports | **0 listening** for cross-device (ctrl-relay outbound WSS); kernel daemon WS bridge @ 127.0.0.1:17872 with token auth for intra-device PWA mobile-mode |

## Repository topology

```
CTRL/                           ← THIS REPO (deliverable)
├── src-tauri/                  L0 Tauri 2 shell + L1 Kernel
│   └── src/
│       ├── shell/              ← Tauri 2 native shell (hotkey/tray/window/keychain/kernel_supervisor)
│       ├── commands/           ← #[tauri::command] handlers (kernel/stss/memory/keychain)
│       ├── kernel/             ← Rust microkernel (5 primitives + projector + mcp_server :17873 gate + mcp_host + provider/ + notes + stss_bridge + persistence)
│       └── bin/                helper binaries (stss_spike, setup_llm_key)
├── packages/
│   ├── ctrl-web/               ← PWA (React + Vite + vite-plugin-pwa) — SINGLE UI codebase
│   ├── olym-core/              copy from hello-olym (SSOT)
│   ├── olym-desktop/           桌面 olym 派生
│   ├── ctrl-stss/              ST-SS protocol TS (69 tests; 99 workspace-wide)
│   ├── ctrl-memory/            client-side event log TS
│   └── ctrl-kernel-sdk/        L2 syscall surface (mirrors Rust kernel)
├── share/
│   └── stss-spike/             standalone WS server + browser viewer (reference)
├── doc/
│   ├── design/                 HTML prototypes + tokens.json
│   ├── reference/              brand assets
│   └── setup-github-token.md   operational doc
├── .claude/                    Claude Code config (agents/commands/hooks/rules/settings/skills)
├── .claude-plugin/             olym dev framework (Claude Code plugin)
└── .olym/
    ├── decisions/              7 module ADRs (single source of truth)
    │   ├── 001-spine.md … 007-workbench.md
    │   ├── INDEX.md            module map + provenance from original 22 numbered ADRs
    │   └── PROCESS.md          version-control rules
    └── handoffs/               (template only; 灵活开发期间不跑 handoff)

ctrl-cloud/  (separate repo)    CF Workers backend (auth/billing/market/push)
hello-olym/                     olym-core SSOT (also serves mamamiya)
screi/                          ARCHIVE (ST-SS cherry-pick complete H-2026-05-12-002)
```
