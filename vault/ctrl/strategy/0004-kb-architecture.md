---
title: 0004 — 个人知识库架构：地基 + 收集/整理/归纳/应用 闭环
tags: [strategy, knowledge-base, architecture]
updated: 2026-06-13
---

# 0004 — 个人知识库架构

> bao 2026-06-13 提问：「不得有个知识库的架构，然后才收集 / 整理 / 归纳等能力？」
> 对。知识库不是一堆零散笔记，得先有架构，能力才有地方落。
> 锚点：[[0003-notes-kb-design]] · [[0002-north-star-anti-trae]] · [[0001-why-users-love-ctrl]]

## 关键判断：CTRL 的架构 = 文件本身

传统知识库（Notion / 数据库式）要你**先建一套 schema / 数据库结构**才能用 —— 这就是复杂、劝退普通人的根源。

CTRL 是 plain-text 架构：**架构和数据是一体的**。
- 收集 = 写一个 .md 文件
- 整理 = 给文件加 tag / wikilink / 放进文件夹
- 归纳 = 生成一个新的 .md（摘要/大纲）
- 应用 = 读这些 .md

**不需要"先设计架构再用"** —— 这正是 CTRL 比 Notion 优雅、且过得了傻瓜测试的地方。架构是隐式的、长出来的，不是用户要先搭的。

## 三层地基（已有）

| 层 | 是什么 | 实现 |
|---|---|---|
| 存储 | 本地 markdown + YAML frontmatter（vault-is-truth，vim test） | `kernel/vault.rs` |
| 组织 | 文件夹（flat/by-day/by-entity）+ tags + wikilink 双链 + backlink | frontmatter + `[[ ]]` + backlink scanner |
| 索引 | FTS5 全文 + 语义向量嵌入 + tag/link scanner | `vault_search` + `vault_semantic_search` + `vault_backlinks`/`vault_tags` |

## 四个能力（建在地基上的闭环：Capture → Organize → Distill → Supply）

| 能力 | 是什么 | 现状 |
|---|---|---|
| **收集 Capture** | 信息进来 | 写笔记 ✓ / Irisy「记进笔记」✓ / 拖文件 ✗ / 网页抓取 ✗ |
| **整理 Organize** | 分类、关联 | tags ✓ / 文件夹 ✓ / wikilink 双链 ✓ / frontmatter ✓ / AI 自动打标签归类 ✗ |
| **归纳 Distill** | 提炼、连接、产生新知识 | Irisy 总结(一次性) / Studio 一键生成(summary/FAQ/大纲/时间线) ✗ / 连接发现 ✗ |
| **应用 Supply** | 输出、复用、喂 agent | recall「问知识库」✓ / grounded 引用溯源 ✗ / 喂 `AGENTS.md` ✗ |

✓ = 已实现 / ✗ = 待做

## 「第一步」在架构里的位置

用户的「第一步」= **Capture（收集）的入口**。但它属于整个四能力闭环，不是孤立的"创建笔记"。
- 没有库的新人（大多数，bao 2026-06-13：不是所有人都有 Obsidian 库）：第一步 = 一个**有起点、不留白**的 capture 入口（写第一篇 / Irisy 记 / 一键模板起点）。
- 有库的人（少数）：指向已有文件夹（次要入口，后续）。

## 路线（按闭环补齐，傻瓜化前提见 [[0002-north-star-anti-trae]]）

1. **Capture 入口**：新人友好起点（空库不留白，一键有第一篇）+ Irisy 记 ✓ + 拖文件喂料。
2. **Distill（最缺、最有价值）**：Studio 式一键生成（summary/FAQ/大纲），产物落成 vault 新 .md。
3. **Supply**：grounded 引用溯源（Irisy 答知识库问题挂引用、点击跳本地 .md 精确行）+ 喂 `AGENTS.md`。
4. **Organize 增强**：AI 自动打标签 / 归类（NotebookLM auto-label）。

> 不要先建复杂架构再用。架构已在文件里；按闭环补能力，每个能力都是对文件的一种操作。
