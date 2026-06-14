# CTRL — Claude Code Project Entry

> **新 session 必读**: `.olym/decisions/INDEX.md` (7 module ADRs) + `.olym/decisions/001-spine.md` (architecture lock)

---

## What is CTRL?

CTRL = **AI-native ambient OS 中枢** (野心), v1 落地 = **global ambient AI workbench + creator substrate** (ADR-006 cross-cutting § global-english v1; 中文是后续 i18n locale, 不是 v1 default).

按 `Ctrl` 唤起 → ephemeral workspace → 1 键帽 = 1 AI 工具. 极简化 + AI native + 创作者经济.

**Single deliverable**: this repo (`soodooi/CTRL`, private). Self-contained; olym dev framework installed as Claude Code plugin (`.claude-plugin/`) — no npm runtime dependency.

---

## Rules

- 全英文代码 — **整个项目代码零中文** (注释 / UI 文本 / 字符串字面量 / API 响应 / 错误信息 全英). bao 钦定 2026-05-28
- 中文只允许出现在 `.md` 文档 (战略文档 / spec / handoff / ADR) + 跟 bao 对话, **不允许出现在任何 `.rs` / `.ts` / `.tsx` / `.css` 代码注释里**
- License: All Rights Reserved. **所有子包 `private: true` + `license: UNLICENSED`**
- 禁止 `npm publish` 任何 `@ctrl/*` 包到公开 npm
- 禁止本地 `wrangler dev` (ctrl-cloud 走 `*.workers.dev` staging)
- 禁止 `--no-verify` 跳过 git hooks
- 禁止跨 D1 JOIN
- 模棱两可的指令直接询问 bao
- 涉及战略改动: 先读 ADR-001 spine + `.olym/decisions/INDEX.md` (7 module ADR 索引), 不冲突再动手

### Working mode: 灵活开发 — 只做 ADR + 代码 + PR

bao 2026-05-25 进一步校准: **只 3 件事**:

1. **ADR** — 战略决策必写 ADR (module-based, 7 个, 编号 001-007 锁死). **section amendment = bump version: + 加 changelog 行, 不开新 ADR** (PROCESS.md §1 锁). **ADR 跟最新决策有冲突立刻改**, 不留拖延 (memory `decision_pi_is_sole_brain_hermes_is_keycap` 反例: 原 ADR-019 hermes-primary 等到第二天才删 — 不允许再发生)
2. **代码** — 直接动手实施, cargo + tsc 双绿就 commit
3. **PR** — 单 branch 累积 commit, 一次性 PR → main, squash merge

**不做** (灵活模式期间):
- spec 细则 / handoff 中间态 / README 同步 — 暂搁
- olym 主循环 / RFC 5 步 / 7-step process — 暂搁
- doc churn / cleanup PR / governance ADR — 暂搁

**仍守** (这些是保命线):
- 全英文代码 (pre-push hook)
- `--no-verify` 禁用
- Cargo.lock + package-lock.json 进 commit
- ADR-001 spine § primitives v1 (5 primitives) 不动
- 安全 (Keychain secrets, no hardcode)
- **ADR 跟实装不允许漂移** — 发现冲突立刻 superseded / amend

---

## Design Philosophy

> 跨 session 强约束。冲突时优先级：**目标推进 > 硬规则 (## Rules) > 设计哲学 (本节) > 实施细节**。

### Meta: 系统设计先行 — 不用 debug 的方式开发系统 (bao 钦定 2026-06-13)

**先有统管全局的整体规划, 再实施; 不要靠 debug 式试错凑结果。**

- 动手改 UI / 数据流 / 架构前, 先建立一张统管全局的规划图 (信息架构 / 边界 / 职责 / 网格), 把它写下来 (vault 或 ADR), 所有局部对齐它。
- **反模式 (debug 式开发)**: 逐个组件调样式、改一处看一处、靠截图 / 日志反复试错来「凑齐」。结果必然是各组件各自为政 —— 品牌出现两次、竖线各画各的 x 对不齐、token 各 fallback 各的。
- debug / 截图 / 日志 / tsc 是**验证**手段, **不是开发方法**。先把设计想对, 再用它们验证; 不是边试边改凑出对。
- **症状自检**: 一旦发现「局部各自为政 / 对不齐 / 重复 / 搞不清楚」= 整体规划缺失的信号 → **停下补规划**, 不要继续局部打补丁。
- 反例 (bao 2026-06-13): UI 布局逐组件调样式、没有统一网格 → L1 和第一行各放一次品牌、4 条竖线各在各的 x 对不齐。bao: 「线都不齐 我搞不清楚 你是不是没有整体规划」。

### Meta: Plain-text 哲学 (VMark-compatible vault, 一切派生于此)

**CTRL 是用户能力的延伸 (augmentation)，不是知识中介。**

- 数据本来就是用户的——本地 markdown + YAML / TOML / JSON, 永恒中间格式, 100 年后用 vim 还能读
- 本地是 **truth**, 云是 **mirror**, 不是反过来
- 无 lock-in：离开 CTRL = 文件还在那, 不需要"导出"因为根本没"导入"
- 无 CTRL 账号系统：用户身份 = 本机 keychain 里的密钥, CTRL 团队不知道你存在
- 无私有 binary 格式：所有用户内容必须 plain text + structured frontmatter
- **VMark / Obsidian 是兼容承诺, 不是依赖** — vault 文件夹是普通 markdown, 用户已装的 VMark / Obsidian / vim 都能开, 但 CTRL 不依赖它们任何一个 (不集成 VMark MCP sidecar, 不依赖 Obsidian DB cache)

**vim test** (每个新 capability 的设计门槛): 用户用 vim 打开本机文件, 能拿到 CTRL 提供的核心价值吗? 答 No = 设计错, 重做。

### Derived rules (任何新代码都遵守)

1. **本地是 truth, 云是 mirror** — 所有读走本地；写本地立即可见, 异步推云。云不在 → 降级运行, 不 hard fail。
2. **端侧化优先** — OAuth (本机 loopback callback, 不走 CTRL cloud proxy) / LLM (Volc 云 + Ollama 端侧 dual) / sync (mesh P2P, ADR-002 substrate § crypto v1) / RAG (本机 SQLite FTS5 + WASM embed) / OCR (本机 Vision framework) 都端侧实现。**ctrl-cloud 是 augmentation, 不是 dependency**——用户拔网 / 不用 ctrl-cloud, CTRL 完整可用。
3. **Ctrl-key 是唯一入口** — 用户永不打开飞书 / Notion / Linear 等第三方 app；CTRL workspace 区 render 所有数据类型 (viewer registry by content type, 不是 by platform)。
4. **One-shot, not flows** — 一个 mcp = 一个原子动作。无 wizard / 无 multi-step / 无 dialog tree。
5. **AI 是 pipe, 不是 sidebar** — 发收消息 / 处理内容时 AI 默认 in-line 处理 (润色 / 摘要 / 抽 action item / 翻译), 可关默认开。
6. **Transparency by drill-down** — 任何 AI / 抽象处理都可长按 / hover 看 raw 数据 (飞书原文 / AI 改后 / 本地草稿三层视图)。
7. **Pi 是唯一 brain** *(ADR-002 substrate § brain v1; hermes 彻底移除 2026-05-28 PR #62)* — Irisy 跑 agent loop 永远走 **Pi** (`@mariozechner/pi-coding-agent`, MIT, lazy install via `~/.ctrl/pi/`). kernel `text.chat` 调用通过 provider router (ADR-002 substrate § provider v1) 路由到当前 active provider, Pi 通过 ctrl-bridge 扩展 HTTP-fetch kernel `/text-chat` endpoint. **hermes 已彻底移除** — 不再作 keycap, 无 kernel / PWA 接线, `packages/ctrl-hermes-plugin/` 已删. hermes 的长效记忆优点已原生落在 Irisy (`vault/irisy/SOUL.md` + `.irisy-memory/`).

### 几个具体推论

- **没有"导出"功能** — 数据从来没被进口过, vault 文件夹就是数据
- **OAuth tokens 存 macOS Keychain** — CTRL 团队 server 不在 token 流量里
- **mcp manifest = markdown + JSON frontmatter** — 不是 binary blob, 用户可手编可 git diff (mcp = 用户 + 代理共享 vocab, 替代"keycap" 2026-06-07)
- **vault layout 由用户决定** — CTRL 提供 default policy (flat / by-day / by-entity), 用户可换；不 hardcode 目录结构
- **第三方 backend (飞书 / Notion / Slack) 是 sync provider** — 不是 source of truth, 本地永远赢冲突
- **CTRL-native vault stack** *(2026-05-25)* — viewer 用 **Tiptap** (markdown WYSIWYG+source) + **CodeMirror 6** (code/JSON/YAML/TOML/HTML) + **mermaid.js** (mermaid) + iframe+CSP (HTML sandbox) + browser-native (SVG); 索引用 **SQLite FTS5** (kernel `vault_index.rs`) + 自实现 backlink/tag scanner. VMark 用的也是同样开源 stack — 不需要把 VMark 作 substrate, 直接 npm 装这些 lib 即可

详见 memory `decision_ctrl_obsidian_philosophy.md` (long-form rationale) + `decision_pi_is_sole_brain_hermes_is_keycap.md` (brain 校准) + `decision_vmark_not_substrate_use_open_stack.md` (vault stack 校准)。

---

## Architecture overview

> Spine: `.olym/decisions/001-spine.md` § pi-centric (Pi-centric 5 块图). INDEX = `.olym/decisions/INDEX.md` (7 module ADR).

**Pi-centric 5 块** (顶 → 底, 一切围绕 Pi):

1. **ui-ux** — PWA, Irisy 表达 (user 唯一接触面)
2. **kernel** — Rust microkernel + 公共服务 (provider / vault / storage / mcp / stss / mesh)
3. **Pi** ★ — 核心 brain, 唯一 agent loop
4. **provider** — Pi 用的 LLM 调用 (kernel/provider/ 子系统)
5. **mcp** — Pi 调的 tool (subprocess via MCP) — 此前称 "keycap", 2026-06-07 改名跟 MCP 生态对齐

**5 kernel primitives** (L1 内): Actor / Capability / Event / Channel / Effect.

**5 mcp sources** (Pi 工具注入路径): MCP servers / Big-platform OAuth / Local agents / ST-SS shared windows / Built-in.

物理 topology (L0-L3 + PWA 4 层垂直栈) 见 ADR-001 spine § layers v1 — Pi-centric 是 logical view, 4 层是 implementation view, 两图并存.

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
│   ├── design/                 HTML prototypes + tokens.json
│   ├── reference/              brand assets
│   └── setup-github-token.md   operational doc
├── .claude/                    Claude Code config (agents/commands/hooks/settings/skills)
├── .claude-plugin/             olym dev framework (Claude Code plugin)
└── .olym/
    ├── decisions/              7 module ADRs (single source of truth)
    │   ├── 001-spine.md
    │   ├── 002-substrate.md
    │   ├── 003-frontend.md
    │   ├── 004-cap.md
    │   ├── 005-irisy.md
    │   ├── 006-cross-cutting.md
    │   ├── 007-workbench.md
    │   ├── INDEX.md            module map + provenance from original 22 numbered ADRs
    │   └── PROCESS.md          version-control rules
    └── handoffs/               (template only; 灵活开发期间不跑 handoff)

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
| Sandbox | OS-level subprocess isolation (sandbox-exec / landlock / AppContainer) + Tauri 2 Capability + Isolation Pattern + CSP. **WASM removed** in 0.1.39 lean kernel (ADR-001 spine § philosophy #1+#4 v1) — re-evaluate via WasmEdge if v1.x needs in-process untrusted code. |
| UI | Single PWA (`packages/ctrl-web`) — React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa |
| Vault viewers | **Tiptap** (markdown WYSIWYG+source) + **CodeMirror 6** (code/JSON/YAML/TOML/HTML) + **mermaid.js** (mermaid graphs) + iframe+CSP (HTML sandbox) — content-type viewer registry, replaces VMark MCP sidecar (S15 deprecated 2026-05-25) |
| Vault index | SQLite FTS5 (`src-tauri/src/kernel/vault_index.rs`) + backlink scanner + tag scanner (kernel-native, no VMark dep) |
| Brain (sole) | **Pi** (`@mariozechner/pi-coding-agent`, MIT, lazy npm install to `~/.ctrl/pi/`) — kernel routes `text.chat` via provider router (ADR-002 substrate § provider v1); Pi consumes via ctrl-bridge extension. **hermes fully removed** (2026-05-28, PR #62) — not a brain, not an mcp, package deleted. ADR-002 substrate § brain v1. |
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

---

## MCP manifest model

Every mcp = declarative manifest (Zod schema). 5 source types: builtin / mcp-server / oauth / local_agent / stss.

> 2026-06-07: "keycap" 退役为 UX 装饰概念, 技术端统一称 "mcp" 跟 MCP 生态对齐. memory `decision_keycap_collapses_to_mcp_meta_ux_layer` (2026-06-05) 已升级 — 都叫 mcp, skills 也是 mcp.

详细 schema: ADR-002 substrate § composition v1 + `packages/ctrl-mcp-sdk/src/manifest-schema.ts` (SSOT).

AI 创作助手 generates manifests from natural language. User never writes JSON unless they want to (advanced mode).

---

## Top 15 mcps (v1 scope)

| # | MCP | Tier |
|---|---|---|
| 1-5 | Clipboard AI / OCR / Translate / Text / Chat | P0 v1.0 |
| 6-10 | 窗口 / PDF / LaTeX / 智识 / 屏幕录 | P1 v1.1 |
| 11-15 | Snippet / Code / Email / 会议 / 同步 | 差异化 |

---

## LLM Pattern D

```
Default subscription = CF Workers AI quota (Qwen-3 / Llama-3.3, 含在订阅)
       ↓
BYOK 高级 = user fills own Anthropic / OpenAI key (advanced creation tier)
       ↓
Local Ollama = privacy geek tier
```

> **ADR-006 cross-cutting § byok-no-claude v1 lock**: Anthropic Claude / GPT-4 / Ollama 都是 **BYOK only**, 用户主动启用. Default subscription path 只 CF Workers AI (Tokyo 主路径). CTRL runtime never ships an Anthropic / OpenAI SDK on its hot path — those clients only load when the user has filled their own key in Settings → Providers (ADR-002 substrate § provider §3.6 v1). User-facing references to `claude-code` / `aider` etc. as external CLIs (Code Space env presets) are NOT a violation: they are user choice, not CTRL-bundled dependency.

**We sell tools + platform, not models.**

---

## Active handoffs

Read `.olym/handoffs/` for current work. New handoff template: `.olym/handoffs/_template.md` (create when needed).

Current open:
- **H-2026-05-11-001** [P0] CTRL Kernel bootstrap — P1+P2+P3 合并启动

---

## Decision flow

When you need to make any non-trivial decision:

1. **Read** `.olym/decisions/INDEX.md` (1 min) — 7 module ADR map
2. **Open** the relevant module ADR — § Decision + § Acceptance + § Future work
3. **Ask** bao if conflict between ADRs or decision absent

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

- Architecture question → ADR-001 spine + relevant module ADR (INDEX.md)
- Strategic question → `.olym/decisions/INDEX.md` + relevant module ADR
- "Should I add this?" → check 不做清单 first
- "How does X work?" → ask bao directly, do not guess
