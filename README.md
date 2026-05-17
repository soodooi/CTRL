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


## Latest Updates (2026-05-16)

### Key Decisions
1. **Platform Repositioning**: CTRL is now an **OPC成品承载平台** (OPC product hosting platform)
2. **New Positioning**: Not building tools ourselves, but **hosting existing OPC products**
3. **AI Model Selection**: Using **Minimax 2.7 Highspeed** as primary LLM for Chinese OPC market
4. **Market Strategy**: Domestic market first, focusing on Chinese OPC users
5. **Development Priority**: Lightweight integration + AI agent auto-integration

### New Platform Positioning
- **Not building tools**: Hosting existing OPC products
- **Not integrating with Feishu**: Becoming a lightweight alternative to Feishu for OPC
- **Not requiring coding**: AI agent fully automatic integration
- **Not requiring 24/7 uptime**: On-demand startup, use and exit

### Current Status
- ✅ Hotkey system fixed (single Ctrl activation working, fast open/close)
- ✅ L1 Kernel running with WS bridge at 127.0.0.1:17872
- ✅ 99 tests passing across packages
- ✅ GitHub push successful (hotkey fixes)
- ✅ Business assessment completed
- ✅ AI model selection finalized (Minimax 2.7 Highspeed)
- ✅ Platform positioning clarified
- ⚠️ Frontend PWA needs completion
- ⚠️ Lightweight integration layer needs implementation
- ⚠️ AI agent auto-integration needs development
- ⚠️ Sharing and collaboration features needed

### Next Steps
1. **Week 1**: Complete frontend PWA + CLI wrapper implementation
2. **Week 2**: Integrate Minimax 2.7 API + AI agent prototype
3. **Week 3**: Validate 3 OPC product integrations
4. **Week 4**: Launch lightweight platform with seed user community

### Key Documents
- [Product Spec](./doc/product-spec.md) - Updated with latest decisions and new positioning
- [Commercial Assessment](./doc/commercial-assessment-market-strategy.md) - Market analysis with new positioning
- [Minimax Integration Plan](./doc/minimax-integration-plan.md) - Technical implementation with AI agent
- [Next Action Plan](./doc/next-action-plan.md) - Detailed roadmap for lightweight platform
- [Current Status & Business Modules](./doc/current-status-business-modules.md) - Updated status and modules
- [Keycap Ideas Record](./doc/keycap-ideas-record.md) - Record of tool ideas for keycap development
- [Flomo Integration Guide](./doc/flomo-integration-guide.md) - Guide for integrating flomo notes with CTRL

## Getting Started

See [CLAUDE.md](./CLAUDE.md) for development rules and workflow.

**Note**: This is a private repository. All packages are `private: true` with `license: UNLICENSED`. No npm publishing allowed.


## AI选型状态更新（2026-05-16）

### ✅ **Minimax 2.7 Highspeed 验证完成**

**Token状态**: ✅ **有效且可用**
- Token已通过全面API测试
- 支持所有必需功能：聊天、流式、工具调用、JSON输出
- 7个模型可用，包括我们需要的 `MiniMax-M2.7-highspeed`

**测试结果**:
- ✅ 模型列表获取成功
- ✅ 聊天完成功能正常
- ✅ 流式响应支持确认
- ✅ 工具调用（function calling）工作正常
- ✅ CTRL集成能力验证通过

**立即可用**:
- 可以开始 `packages/ctrl-llm` 包开发
- 可以开始AI agent自动集成实现
- 可以开始八字算命工具集成验证

**详细报告**: [Minimax Token Status](./doc/minimax-token-status.md)

### 🚀 **下一步行动**
1. **今天**: 创建Minimax客户端基础包
2. **明天**: 实现AI agent原型
3. **本周**: 完成Minimax基础集成
4. **下周**: 验证3个OPC成品自动集成

**AI选型工作状态**: ✅ **完成 - 可以开始实施**