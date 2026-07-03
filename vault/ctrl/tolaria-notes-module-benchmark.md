---
title: Tolaria 对标 CTRL Notes 模块 — 调研与裁决建议
kind: research
created_at: 2026-07-02
owner: bao
author: claude
purpose: bao「你看一下这个开源项目 tolaria，看看对标我们 note 模块，是否合适？」
sources:
  - https://github.com/refactoringhq/tolaria
  - https://tolaria.md/
  - https://news.ycombinator.com/item?id=47882697
related:
  - "[[lifeos-layer-restructure.md]]"
  - 002-substrate.md   # §8 vault / §14
---

# Tolaria = 目前最贴的 Notes 模块单一对标（哲学几乎同构），但只对标模块、不对标 spine

## 身份

`refactoringhq/tolaria` — "Desktop app to manage markdown knowledge bases"。作者 Luca Ronin（Refactoring newsletter 创始人），为管理自己 ~6 年 ~10,000 条笔记而建。**18.2k stars / 1.2k forks，alpha 阶段**（1,442 releases，push-to-main 即发版），Show HN 出圈。定位口号 = "a second brain for the AI era"。

## 与 CTRL 的哲学同构度（惊人地高）

| 维度 | Tolaria | CTRL Notes | 判定 |
|---|---|---|---|
| 存储 | plain markdown + YAML fm，无数据库真相、无私有格式、"no export step" | 同（vim test） | ✅ 同构 |
| 账号 | 无账号、free forever、无服务器依赖 | 同（无 CTRL 账号系统） | ✅ 同构 |
| 壳/栈 | **Tauri + React/TS** | 同 | ✅ 同构 |
| 开源 | **AGPL-3.0**（商标另管） | AGPL-3.0 open-core | ✅ 同构 |
| AI 接入 | **自带 MCP server 暴露 vault** + Claude Code / Codex / Gemini CLI 接入路径 | `:17873` gate + BYO-CLI driver（Claude Code 旗舰） | ✅ 同构 —— **独立验证了 BYO-CLI projection 这条路** |
| 同步 | **git-first**（任意 remote，无私有 sync） | mesh P2P（ADR-002 crypto，v1.1+） | ⚠️ 不同解，同一"不锁定"价值观 |
| 编辑器 | **BlockNote**（Notion 式 block） | **Tiptap**（markdown WYSIWYG+source） | ❌ 分歧（见下） |
| 搜索 | 全文搜索，实现未文档化 | SQLite FTS5 + backlink/tag scanner | CTRL 更扎实 |
| 插件 | 无 | 功能包生态（§7） | CTRL 更有故事 |

## 值得偷的两个想法

1. **git 作 AI 审计层（attribution）**：每个 vault 是 git repo，commit 区分「AI 改的 vs 你写的」。CTRL 的审计在 `:17873` gate（调用层）；Tolaria 在文件/历史层 —— **互补不冲突**，是 Transparency-by-drill-down 哲学在文件层的落法。候选切片：doc_produce/produce 写盘时可选 git commit + author 标注。
2. **"Types as lenses, not schemas"**：Project/Topic/Journal 等软类型（frontmatter 驱动、带色/icon）只作导航透镜、不强制 schema —— 正合 CTRL「vault layout 由用户决定」的立场，比 Notion database 软、比裸 tag 富。可作 Notes workspace（LifeOS 层）的组织原语。

## 编辑器分歧反而验证了 CTRL 锁点

Tolaria 作者从 Swift 起步、因 markdown 编辑器限制转 BlockNote（block-over-markdown）。HN 实测反馈：**code-fence 怪癖、markdown 保真问题、大文件性能差** —— block 编辑器叠在 markdown 上有摩擦。CTRL 锁的 Tiptap（markdown 原生 WYSIWYG+source）对 markdown 保真更安全。**不改锁点，且这是反证加固。**

## 作对标的边界（哪里不合适）

- 它是**独立笔记 app，不是 ambient workbench** —— 没有 gate/projection/capability/功能包等 spine 概念。**只对标 Notes 模块，不对标 CTRL 整体**。
- 搜索实现未文档化、无插件生态、alpha 期 bug 多（排序坏、fence 怪癖）—— 这些维度 CTRL 更 deliberate。

## 竞品警报

18.2k stars 的 alpha，正好长在 CTRL 同一细分（local-first markdown + AI-agent-native）。**既是最好的参照，也是最近的邻居** —— 值得持续跟踪其 MCP server 的工具面设计与 CLI 接入 UX（它对 Claude Code 用户的开箱体验就是 CTRL BYO-CLI 路径要赢的那场仗）。

## 建议（待 bao 拍）

1. **合适对标，采纳为 Notes 模块基准** —— 哲学同构度是所有已调研项目里最高的（比 Obsidian 更贴：同 Tauri/React/AGPL/MCP/BYO-CLI）。
2. 两个偷点排 backlog：git-AI-attribution（文件层审计）、types-as-lenses（Notes workspace 组织原语）。
3. 不因它改任何锁点（Tiptap / FTS5 / mesh sync 全保留，且 BlockNote 之痛反向加固 Tiptap）。
