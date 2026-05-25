# CTRL — Claude Code Project Entry

> **新 session 必读**: `.olym/steering/ctrl-strategy.md` (5 min navigator) + `.olym/decisions/001-system-architecture.md` (architecture lock)

---

## What is CTRL?

CTRL = **AI-native ambient OS 中枢** (野心), v1 落地 = **中文 OPC 桌面 AI 工具入口 + 创作者底座**.

按 `Ctrl` 唤起 → ephemeral workspace → 1 键帽 = 1 AI 工具. 极简化 + AI native + 创作者经济.

**Single deliverable**: this repo (`soodooi/CTRL`, private). Self-contained, consumes `olym-core` via workspace copy.

---

## Rules

- 全英文代码 (注释 / UI 文本 / API 响应 / 错误信息) — 中文 OPC 用户但代码英文 + 国际化 ready
- All `.md` 文档 + 注释允许中文 (战略文档 / spec / handoff)
- License: All Rights Reserved. **所有子包 `private: true` + `license: UNLICENSED`**
- 禁止 `npm publish` 任何 `@ctrl/*` 包到公开 npm
- 禁止本地 `wrangler dev` (ctrl-cloud 走 `*.workers.dev` staging)
- 禁止 `--no-verify` 跳过 git hooks
- 禁止跨 D1 JOIN
- 模棱两可的指令直接询问 bao
- 开始前查 `.olym/skills/` 和 `.olym/best-practice/` (后续建立)
- 涉及战略改动: 先读 ADR-001, 再读相关 spec, 不冲突再动手

### Working mode: 灵活开发, 文档后补

bao 2026-05-25 校准: 当前处于 v1 快速迭代期, **代码 ship 优先, 文档后补**。

- 不阻塞: handoff 状态 / spec 细则 / ADR 撰写 / README 同步 — 全部允许滞后
- 先动手: 实装 → commit → push, 不等 spec/handoff 齐全
- 回填窗口: 功能 ship 后 (release 切版本时 / EOD / 周末) 集中回补 doc 状态
- 例外 (仍需先 doc): 战略级 ADR 改动 (架构 lock 点) / 安全相关 / 8 zeus-stewardship 类
- 不变: olym 主循环 / RFC 5 步 / lane 边界 / commit message 规范 — 这些是流程保命线, 不是 doc

---

## Design Philosophy

> 跨 session 强约束。冲突时优先级：**目标推进 > 硬规则 (## Rules) > 设计哲学 (本节) > 实施细节**。

### Meta: Obsidian 哲学 (一切派生于此)

**CTRL 是用户能力的延伸 (augmentation)，不是知识中介。**

- 数据本来就是用户的——本地 markdown + YAML / TOML / JSON, 永恒中间格式, 100 年后用 vim 还能读
- 本地是 **truth**, 云是 **mirror**, 不是反过来
- 无 lock-in：离开 CTRL = 文件还在那, 不需要"导出"因为根本没"导入"
- 无 CTRL 账号系统：用户身份 = 本机 keychain 里的密钥, CTRL 团队不知道你存在
- 无私有 binary 格式：所有用户内容必须 plain text + structured frontmatter

**vim test** (每个新 capability 的设计门槛): 用户用 vim 打开本机文件, 能拿到 CTRL 提供的核心价值吗? 答 No = 设计错, 重做。

### Derived rules (任何新代码都遵守)

1. **本地是 truth, 云是 mirror** — 所有读走本地；写本地立即可见, 异步推云。云不在 → 降级运行, 不 hard fail。
2. **端侧化优先** — OAuth (本机 loopback callback, 不走 CTRL cloud proxy) / LLM (Volc 云 + Ollama 端侧 dual) / sync (mesh P2P, ADR-003) / RAG (本机 SQLite FTS5 + WASM embed) / OCR (本机 Vision framework) 都端侧实现。**ctrl-cloud 是 augmentation, 不是 dependency**——用户拔网 / 不用 ctrl-cloud, CTRL 完整可用。
3. **Ctrl-key 是唯一入口** — 用户永不打开飞书 / Notion / Linear 等第三方 app；CTRL workspace 区 render 所有数据类型 (viewer registry by content type, 不是 by platform)。
4. **One-shot, not flows** — 一个 keycap = 一个原子动作。无 wizard / 无 multi-step / 无 dialog tree。
5. **AI 是 pipe, 不是 sidebar** — 发收消息 / 处理内容时 AI 默认 in-line 处理 (润色 / 摘要 / 抽 action item / 翻译), 可关默认开。
6. **Transparency by drill-down** — 任何 AI / 抽象处理都可长按 / hover 看 raw 数据 (飞书原文 / AI 改后 / 本地草稿三层视图)。

### 几个具体推论

- **没有"导出"功能** — 数据从来没被进口过, vault 文件夹就是数据
- **OAuth tokens 存 macOS Keychain** — CTRL 团队 server 不在 token 流量里
- **keycap manifest = markdown + JSON frontmatter** — 不是 binary blob, 用户可手编可 git diff
- **vault layout 由用户决定** — CTRL 提供 default policy (flat / by-day / by-entity), 用户可换；不 hardcode 目录结构
- **第三方 backend (飞书 / Notion / Slack) 是 sync provider** — 不是 source of truth, 本地永远赢冲突

详见 memory `decision_ctrl_obsidian_philosophy.md` (long-form rationale + Raycast 对比 + audit 清单)。

---

## Architecture overview

详细见 `.olym/decisions/001-system-architecture.md` (spine) + `.olym/decisions/002-pwa-pivot.md` (UI layer, accepted 2026-05-13).

```
L3 Userland (WASM sandboxed actors, 键帽 / 硬件 / LLM call / OAuth flow)
       ↑↓
L2 SDK (@ctrl/{kernel-sdk, stss, memory, desktop})
       ↑↓
L1 CTRL Kernel (Rust microkernel, 5 primitives, ST-SS WS @ 17872)
       ↑↓
L0 Tauri 2 Native Shell (~500 LOC Rust shell)
       ↑↓ embeds WebView2 / WKWebView
PWA (packages/ctrl-web) — single web codebase, runs in Tauri WebView (desktop) + any browser (mobile)
```

**5 kernel primitives**: Actor / Capability / Event / Channel / Effect.

**5 keycap sources** (the integration map):
1. MCP servers (10,000+ Day-1)
2. Big-platform OAuth (Feishu / Coze / Notion / Linear)
3. Local agents (OpenClaw / ClawX / Python)
4. ST-SS shared windows (long-tail desktop + hardware)
5. Built-in (15 v1 keycaps)

---

## Repository topology

```
CTRL/                           ← THIS REPO (deliverable)
├── src-tauri/                  L0 Tauri 2 shell + L1 Kernel
│   └── src/
│       ├── shell/              ← Tauri 2 native shell (hotkey/tray/window/keychain/kernel_supervisor)
│       ├── commands/           ← #[tauri::command] handlers (kernel/stss/memory/keychain)
│       ├── kernel/             ← Rust microkernel (5 primitives + mcp_host + stss_bridge + persistence)
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
│   ├── visual-identity/        logo SVG + brand-tokens.md (single source of truth)
│   └── reference/              design references
├── .claude/
│   ├── ADR/                    architectural decisions (numbered, never deleted)
│   └── PRPs/                   legacy PRP docs (historical)
└── .olym/
    ├── steering/               ctrl-strategy.md (5min navigator)
    ├── specs/                  domain specs (kernel, pwa-shell, stss, tool-manifest, …)
    └── handoffs/               work items (H-YYYY-MM-DD-NNN)

ctrl-cloud/  (separate repo)    CF Workers backend (auth/billing/market/push)
hello-olym/                     olym-core SSOT (also serves mamamiya)
screi/                          ARCHIVE (ST-SS cherry-pick complete H-2026-05-12-002)
```

---

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2 (~500 LOC Rust shell: hotkey / tray / keychain / kernel daemon supervisor) |
| Kernel (L1) | Rust stable 1.77+, Tokio async runtime, ST-SS WS bridge @ 127.0.0.1:17872 (token-authenticated) |
| Sandbox | WASM (wasmtime, cranelift), capability-based |
| UI | Single PWA (`packages/ctrl-web`) — React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa |
| Web ↔ Rust bridge | Tauri 2 `invoke()` on desktop (intra-process), WebSocket + token on mobile |
| Stream protocol | ST-SS (CBOR Cell/Op) |
| Package manager | npm workspaces |
| State persistence | SQLite (event-sourced) + Automerge CRDT (cross-device, ADR-003) |
| **Mesh comm (ADR-003)** | **vodozemac (Olm 1:1) + webrtc-rs v0.17.x + Automerge v0.7.x + mdns-sd v1.71+ + ctrl-relay CF Worker** |
| LLM (default) | CF Workers AI (Qwen / Llama) |
| LLM (BYOK) | Anthropic Claude / OpenAI GPT-4 |
| MCP | Anthropic rmcp Rust SDK |
| Backend (cloud) | Cloudflare Workers + D1 (ctrl-auth / ctrl-billing / ctrl-market / **ctrl-relay** / ctrl-push) |
| Payments | Stripe |
| Min platform | Windows 10 1809+ (primary Win 11+ dev; ADR-002 §6 WebView2 bootstrapper covers 10), macOS 13+ (secondary), iOS 16.4+ PWA, Android Chrome PWA, WebView2 / WKWebView evergreen |
| Mobile | Pure browser PWA (no React Native, no Capacitor) + WebRTC + WASM vodozemac + WASM Automerge |
| Node | 20.x LTS |
| Rust | 1.77+ stable |
| Binary size | kernel ≤ 18 MB (revised by ADR-003), installer ≤ 25 MB default / ≤ 18 MB slim (mesh-included) |
| PWA bundle | ≤ 500 KB gzip (revised by ADR-003); critical-path shell ≤ 200 KB, mesh modules lazy-load |
| Local ports | **0 listening** for cross-device (ctrl-relay outbound WSS); kernel daemon WS bridge @ 127.0.0.1:17872 with token auth for intra-device PWA mobile-mode |

---

## Keycap manifest model

Every keycap = declarative manifest (Zod schema). 5 source types: builtin / mcp / oauth / local_agent / stss.

详细 schema: `.olym/specs/tool-manifest/spec.md`.

AI 创作助手 generates manifests from natural language. User never writes JSON unless they want to (advanced mode).

---

## Top 15 keycaps (v1 scope)

| # | Keycap | Tier |
|---|---|---|
| 1-5 | Clipboard AI / OCR / Translate / Text / Chat | P0 v1.0 |
| 6-10 | 窗口 / PDF / LaTeX / 智识 / 屏幕录 | P1 v1.1 |
| 11-15 | Snippet / Code / Email / 会议 / 同步 | 差异化 |

详细 `.olym/steering/ctrl-strategy.md`.

---

## LLM Pattern D

```
Default subscription = CF Workers AI quota (Qwen-3 / Llama-3.3, 含在订阅)
       ↓
BYOK 高级 = user fills own Anthropic / OpenAI key (advanced creation tier)
       ↓
Local Ollama = privacy geek tier
```

**We sell tools + platform, not models.**

---

## Active handoffs

Read `.olym/handoffs/` for current work. New handoff template: `.olym/handoffs/_template.md` (create when needed).

Current open:
- **H-2026-05-11-001** [P0] CTRL Kernel bootstrap — P1+P2+P3 合并启动

---

## Decision flow

When you need to make any non-trivial decision:

1. **Read** `.olym/steering/ctrl-strategy.md` (5 min)
2. **Check** `.olym/decisions/001-system-architecture.md` for lock points
3. **Drill** into relevant spec under `.olym/specs/`
4. **Ask** bao if conflict between docs or decision absent

Do **not** unilaterally change lock points without ADR amendment.

---

## What CTRL is NOT

| Don't | Why |
|---|---|
| Workflow editor | Coze / n8n 已经做了 |
| 自己造硬件 | Solo + 资本错配 |
| 100+ 长尾 platform adapter | ST-SS 给创作者自己接 |
| Quicker 8000 长尾 clone | 不可能赢 |
| ChatGPT GPTs 接入 | API 不开放 |
| 共享 mamamiya 用户数据 | 独立 D1 |
| 多 tenant SaaS | Pandagooo 那条线, 不混 |

---

## Key external references

- Architecture: AIOS (Rutgers COLM 2025), Anthropic Sandbox Runtime, IronClaw seL4-inspired
- MCP standard: Linux Foundation / AAIF governance, Anthropic SDK
- Inspirations: Raycast, Cursor, Linear, OP-1, Frank Chimero
- Anti-references: ChatGPT 灰, Material Design, 紫色渐变 SaaS 模板

---

## Git workflow

- Branch from `main`: `feat/h-001-bootstrap` style
- Every commit message includes handoff ID: `[H-2026-05-11-001]`
- Conventional commits: `feat / fix / chore / refactor / docs / test`
- Squash merge to main via PR
- No force push to main, no `--no-verify`

---

## When in doubt

- Architecture question → ADR-001 + relevant spec
- Strategic question → `.olym/steering/ctrl-strategy.md`
- "Should I add this?" → check 不做清单 first
- "How does X work?" → ask bao directly, do not guess
