---
title: 0003 — Notes 知识库板块设计（对标 NotebookLM / Kimi / 豆包）
tags: [strategy, notes, knowledge-base, design]
updated: 2026-06-13
---

# 0003 — Notes 知识库板块设计

> bao 2026-06-13：对标豆包 / Kimi / NotebookLM 来设计，确保用户体验，L2 默认关闭。
> 锚点：[[0002-north-star-anti-trae]]（傻瓜测试）· [[0001-why-users-love-ctrl]]

## 对标结论

- **NotebookLM = 主蓝本**：Sources（资料源）+ Chat（grounded 问答，逐句引用、hover 看原文、点击跳源）+ Studio（一键生成 summary / FAQ / 大纲 / 时间线 / 音频）。资料一进来就自动给「概览 + 建议问题 chips」，永不空白页。
- **Kimi**：拖拽即上下文、无「导入 / 建库」概念 —— 极简喂料。
- **豆包**：「边写边问」，AI 嵌在编辑器里改当前段，不是另开侧栏。
- **CTRL 独特优势**：它的「源」天生是本地 vault 文件，引用回跳 = 跳本地 .md，比三者都彻底（满足 vim test + 本地是 truth）。

## 用户意图清单 → 交互映射（L2 关闭时也要一键可达）

| 意图 | 交互 |
|---|---|
| 写（新建/编辑） | 首页「+ New note」；选中后编辑器全宽 |
| 找（搜索/浏览/最近） | 首页大搜索框（输入即展开 L2 看结果）+「Browse all notes」+「Jump back in」最近笔记 |
| 连（反链/wikilink） | ↩ 反链 toggle（默认关）+ 编辑器内 wikilink 点击跳转 |
| 问/记（AI） | Irisy 中间列（问知识库 / 记进笔记），grounded 引用（路线） |

## 已落地（2026-06-13）

- **L2 文件树默认关闭**（anti-Trae，不四区砸脸）；☰ 随时展开。`NotesApp` treeOpen 默认 false。
- **知识库首页**（无选中笔记时，对标 NotebookLM 防空白）：标题 + 人话引导 + 大搜索框 + 新建 + 浏览全部 + 最近笔记。不再是干巴的「Select a note」。
- 修复：`.cols` 从固定三列 grid 改 flex，否则 L2 关闭后 centerCol 被压到 200px。现在 centerCol flex:1 撑满。
- Irisy 列空态引导（打开 Notes 时中间列不空白，提示「我能配合右边内容、不用重说」）。

## 路线（对标提炼的 6 点，按 NotebookLM 蓝本）

1. **grounded 问答 + 引用溯源**：Irisy 答知识库问题时，每个论断挂引用，hover 看 vault 原文、点击跳到该 .md 精确行（CTRL 版的 transparency by drill-down）。← 下一步重点
2. **源勾选框圈定范围**：展开 L2 时每个文件带 checkbox，决定 Irisy 这轮只读哪些；对话上方「正在参考 N 个文件」chip。
3. **资料进来自动给概览 + 建议问题 chips**：监听 vault 新增，后台生成摘要 + 3-5 个可点问题。
4. **Studio 式一键生成**：summary / FAQ / 大纲 / 时间线，产物直接落成 vault 新 .md。
5. **边写边问（豆包）**：编辑器选区上的 inline AI 动作条（润色/扩写/摘要），结果就地替换。
6. **拖拽即喂料 + 空库种子动作（Kimi + NotebookLM）**：文件拖进窗口即入 vault（无导入概念）；空库不留白，给「拖文件进来 / Irisy 帮我开个头」。

## 守则

- 每加一个东西先过 [[0002-north-star-anti-trae]] 的傻瓜测试；过不了藏进 Irisy。
- 概念越少越好：「功能包 / RAG / 源」尽量不暴露给普通用户。
