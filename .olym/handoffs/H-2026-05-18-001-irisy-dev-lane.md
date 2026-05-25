---
id: H-2026-05-18-001
title: "Irisy keycap-creator companion — bao 在 PWA 操作 Irisy 生成键帽 (no-Claude runtime)"
severity: P0
status: open
reporter: zeus
assigned_to: daedalus
lane: lane-A
touches:
  - packages/ctrl-web/src/routes/irisy.tsx
  - packages/ctrl-web/src/lib/llm-transport.ts
  - packages/ctrl-web/src/lib/irisy/**
  - packages/ctrl-web/src/components/irisy/**
  - .olym/personas/irisy/**
  - .olym/specs/lane-a/**
related:
  - H-2026-05-14-003  # PWA frontend polish (同 slot 续接)
  - H-2026-05-18-002  # jiazuo-spike (依赖输出)
project_id: irisy-v0.3-prod-agent
category: feature
created: 2026-05-18
updated: 2026-05-18
---

## 🎯 目标 (Ship value, 1 句)

bao 在 v0.3 启动 PWA → 唤起 Irisy → 自然语言描述键帽 → Irisy 用 user 配置的 AI provider (Volc 默认 / BYOK Anthropic/OpenAI key) 产出 manifest + MCP server 代码 → bao 审 → [Install] 装入 `~/.ctrl/keycaps/` → 立刻可在 Keyboard 触发。**全程零 Claude/Anthropic SDK 在 production binary**。

## 📦 交付成果 (Deliverables)

| # | 文件 / 工件 | 状态 |
|---|---|---|
| D1 | `packages/ctrl-web/src/lib/llm-transport.ts` 默认 model 从 `'claude-haiku-4-5'` 改成 Volc-shaped string | 🔴 待修 (line 108 现违反 no-Claude) |
| D2 | `routes/irisy.tsx` 增加"创作键帽"模式（mode toggle 或 sub-route `/irisy/create-keycap`），含左聊天 / 右 manifest+code preview / 底 [Install] | 待造 |
| D3 | `.olym/personas/irisy/keycap-creator.md` system prompt + `.few-shots.json` ≥5 示例（参考 `doc/keycap-integration-research/02-*`） | 待造 |
| D4 | Manifest 实时 Zod 校验（schema 引 zeus 的 Z1 spec 升级版） | 待 zeus Z1 |
| D5 | [Install] 按钮调 kernel command 落盘 `~/.ctrl/keycaps/<id>/`（依赖 zeus Z2） | 待 zeus Z2 |
| D6 | 移除 `experiments/claude-cli-shim` 在 production bundle 的任何引用（grep 验 0 命中） | 待修 |

## 🧠 Skill 匹配 (daedalus L4 frontend + L3 design system)

bao 提醒"匹配 skill"。本 lane 用 daedalus 矩阵的：

- **L4 用区**: Vue3+TS 知识迁移到 React (CTRL 是 React 不是 Vue)、Tailwind + design tokens、HTML/CSS semantic、Vite 构建
- **L3 用区**: Component composition / compound pattern、Animation (创作过程的 micro-interaction)、Brand token consumption
- **L2 用区**: Accessibility (manifest preview 表单可键盘操作)、Hono / D1 接口消费 (只读 LLMTransport API)
- **不碰**: Rust kernel (zeus)、键帽 manifest schema 定义 (zeus + hephaestus)、AI provider 接口实现 (zeus)

**Olym skill 调用建议**（开 daedalus 窗口的第一条 prompt 引这些）— 起 session 在 `.worktrees/lane-a/irisy-companion/` worktree (`.lane=irisy-companion`), 必读 `personas/daedalus/{persona,skills}.md` + `CLAUDE.md` + 本 handoff + `doc/keycap-integration-research/01-semantic-co-view.md`. 执行顺序: `/shape` 规划 keycap-creator UX → `/brainstorming` Irisy persona voice + few-shot 示例 (D3) → `/test-driven-development` Zod validator + LLMTransport unit test → `/impeccable:impeccable` D2 UI → `/verification-before-completion` 收尾前跑验收清单.

*(Prompt scaffolding elided — daedalus assembles per usual session-start convention.)*

## 现象 / 证据

- `feedback_no_claude_in_production.md` (memory, 2026-05-18) — bao 明确指令
- `packages/ctrl-web/src/lib/llm-transport.ts:108` — `model: opts.model ?? 'claude-haiku-4-5'` 🔴 直接违反 no-Claude
- `llm-transport.ts:2` 注释引用 `claude-cli-shim`（注释不挡 bundle，但语义错）
- `experiments/claude-cli-shim/` 仍存在，必须确认不在 prod build path
- 当前 `routes/irisy.tsx` 只是基础聊天框，无"创作键帽"模式
- 16 starter keycap 在 `doc/keycap-integration-research/` 可作 few-shot 素材

## 依赖 zeus 的 4 个平行项 (Z1-Z4)

不阻塞 daedalus 启动（先做 D1/D2/D3 不依赖），但中段会卡：

| # | zeus 平行 | daedalus 阻塞点 |
|---|---|---|
| Z1 | manifest spec v0.2 正式升级 → `.olym/specs/tool-manifest/spec.md` | D4 Zod 校验 |
| Z2 | kernel `~/.ctrl/keycaps/<id>/` install + load flow | D5 [Install] 按钮 |
| Z3 | AI capability (`text.chat` 等) SDK 暴露给 PWA | LLMTransport 默认改 Volc 时需要 |
| Z4 | `@ctrl/keycap-build` 作者侧 SDK | D2 MCP server 代码生成模板 |

依赖：**Z1/Z3 24h 内出 → daedalus 中段不卡**。Z2/Z4 可推到 daedalus MVP 后。

## ⚠️ 阻塞 / 待 bao 决策

- (a) **分支策略**: `feat/athena-irisy-v0.2` 有 19 commits 历史前端工作 (Athena 兼任期间产物)。daedalus 接手:
  - 选 1: 合 main 后从干净 main 起 `feat/h-2026-05-18-001-irisy-companion` (推荐, 清账)
  - 选 2: 续做 v0.2 (累积 PR, 但 churn 大)
- (b) **lane-ownership.yaml RFC** 未 merge → daedalus 在 worktree 写 PWA 文件可能触发 lane-guard warn（template 状态宽松，应该能过；但写 `.olym/personas/irisy/**` 是新路径要在 yaml lane.frontend.files 加白）
- (c) **底座 ADR-004 未 propose** → D3 中"调用什么 capability"段需要预先约定（spike 输出后定）

## ✅ 验收清单

- [ ] D1: LLMTransport 默认 model 从 claude-haiku 改 Volc，`grep -rn 'claude-haiku' packages/ctrl-web/src/` 0 命中
- [ ] D2: 创作键帽 UI 跑通：natural language → manifest live preview → MCP server code preview
- [ ] D3: `.olym/personas/irisy/keycap-creator.{md,few-shots.json}` 落地，≥5 示例
- [ ] D4: Manifest Zod 校验在前端实时，invalid manifest 红色提示具体字段（依赖 Z1）
- [ ] D5: [Install] 按钮跑通：点击 → 调 kernel command → 出现在 Keyboard（依赖 Z2）
- [ ] D6: 反例自查 `grep -rn 'claude-cli-shim\|@anthropic\|claude-haiku' packages/ctrl-web/src/` 在 prod build 输出 0 命中
- [ ] E2E: `pnpm dev` → 在 Irisy 创建一个 "Clipboard → 翻译"键帽 → Install → keyboard 触发成功（用 Volc 提供 chat completion）
- [ ] zeus + bao 验收（status → verified）

## 讨论 / 备注

**等 daedalus claim 后追加**：
- 实施顺序计划（@daedalus 你的拆解）
- 跟 zeus 同步 Z1/Z2/Z3/Z4 时间线
