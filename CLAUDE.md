# CTRL — Claude Code Project Entry

> **新 session 必读**: `.olym/steering/ctrl-strategy.md` (5 min navigator) + `.claude/ADR/001-system-architecture.md` (architecture lock)

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

---

## Architecture overview

详细见 `.claude/ADR/001-system-architecture.md`.

```
L3 Userland (WASM sandboxed actors, 键帽 / 硬件 / LLM call / OAuth flow)
       ↑↓
L2 SDK (@ctrl/{kernel-sdk, stss, memory, desktop})
       ↑↓
L1 CTRL Kernel (Rust microkernel, 5 primitives)
       ↑↓
L0 Tauri Native Shell
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
├── src-tauri/                  L0 Tauri + L1 Kernel
│   └── src/kernel/             ← Rust microkernel (P2)
├── src/                        React UI (Pool + Workspace)
├── packages/
│   ├── olym-core/              copy from hello-olym (SSOT)
│   ├── olym-desktop/           桌面 olym 派生
│   ├── ctrl-stss/              cherry-pick from screi
│   ├── ctrl-memory/            cherry-pick from screi
│   └── ctrl-kernel-sdk/        L2 syscall surface
├── .claude/
│   └── ADR/                    architectural decisions
└── .olym/
    ├── steering/               ctrl-strategy.md (5min navigator)
    ├── specs/                  domain specs (5 currently)
    └── handoffs/               work items

ctrl-cloud/  (separate repo)    CF Workers backend (auth/billing/market)
hello-olym/                     olym-core SSOT (also serves mamamiya)
screi/                          ARCHIVE after P3 cherry-pick
```

---

## Stack

| Layer | Tech |
|---|---|
| Desktop shell | Tauri v2 |
| Kernel (L1) | Rust stable, Tokio async runtime |
| Sandbox | WASM (wasmtime preferred), capability-based |
| UI (L3) | React 18 + Vite 5 |
| Package manager | npm workspaces (跟 mamamiya 一致) |
| State persistence | SQLite (event-sourced), optional CRDT |
| LLM (default) | CF Workers AI (Qwen / Llama) |
| LLM (BYOK) | Anthropic Claude / OpenAI GPT-4 |
| MCP | Anthropic MCP SDK |
| Backend (cloud) | Cloudflare Workers + D1 + Wrangler v3 |
| Payments | Stripe |
| Min platform | macOS 13+ primary, Windows 11+ secondary |
| Node | 20.x LTS |
| Rust | 1.75+ stable |

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
2. **Check** `.claude/ADR/001-system-architecture.md` for lock points
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
