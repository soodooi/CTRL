# 调研 — 好的笔记软件 + AI 知识库该怎么做

> bao 2026-06-12:Notes 一堆问题(没伴随/太挤/控件杂),先调研"什么是好笔记
> 软件 + AI 知识库怎么做",再重做 Notes,不补丁。

## 一、什么是好的笔记软件(2026)
- **数据架构是第一分水岭**:**local-first**(本地文件、离线可用、永久拥有)vs
  cloud-first(vendor 服务器)。好的 = local-first(Obsidian / Logseq / Tana)。
- **plain markdown**:Obsidian 把笔记存成纯 markdown 文件,无 cloud 账号,最私密
  —— "你永远拥有数据"。
- **组织模型两派**:
  - **双向链接 / backlinks**(Obsidian / Logseq / Tana)— 笔记靠引用互连。
  - **数据库视图**(Notion / Capacities)— 笔记当结构化记录,像表格过滤。
- **简洁**:好的笔记软件界面克制(Bear / Obsidian 默认极简),不是控件堆砌。
- 标杆:**Obsidian = 个人知识库最佳**(local + markdown + backlinks)。

## 二、AI 知识库该怎么做
**AI 不是"外挂个编辑器",是一个「层」覆盖在笔记上:**
1. **capture(自动记)**:Mem / Reflect 从你的写作学习,自动建立链接,减少手动标签
   —— 不用你整理,AI 帮你组织。
2. **recall(语义搜索 / RAG)**:传统搜索找关键词,AI 语义搜索懂**意义**。建一个
   跨全部笔记的**持久记忆层**,你问问题 → 从整个库拉答案。
3. **resurface(主动重现)**:在你需要时把遗忘的洞察重新浮出来。
4. **Graph RAG**:Obsidian 2026 上了 Graph RAG 插件,用图结构找**非显性连接**;
   Tana 从对话自动捕获 → 结构成可查询知识图,随时间复利。

## 三、CTRL 的位置(差异化)
| | local own? | AI native? | 喂 coding agent? |
|---|---|---|---|
| Obsidian | ✅ markdown | ⚠️ 插件外挂 | ❌ |
| Notion / Mem / Reflect | ❌ cloud | ✅ | ❌ |
| **CTRL** | ✅ markdown | ✅ **Irisy 原生伴随** | ✅ **supply** |

**别人要么 local 没原生 AI(Obsidian),要么 AI 没 own(Notion/Mem cloud)。**
CTRL = **local markdown(own)+ Irisy AI native 伴随 + capture→recall→supply**。
独有的两张牌:**① Irisy 实时伴随 ② supply 派生 AGENTS.md 喂 coding agent**。

## 四、所以 CTRL Notes 该改成什么样
1. **Irisy 伴随**(最该补):看笔记时 Irisy 在旁,一起读 / 问 / 记。别的笔记软件
   没有原生 AI 伴随 —— 这是 CTRL 的 AI native 核心。(现在 Notes 是孤立全屏,把
   Irisy 甩出去了。)
2. **简洁**:去控件堆砌(FRONTMATTER/Edit-Reading-Spell/PREVIEW-SOURCE 一排)、
   藏系统文件夹(KEYCAPS/BUILTIN-*)、收掉挤的 backlinks 列。像 Bear/Obsidian 的
   克制。**CTRL 不该再做一个臃肿编辑器。**
3. **AI 层 = Irisy**(不是又做编辑器):
   - **capture**:对话 / 工作中 Irisy 把决策蒸馏进 Notes。
   - **recall**:问 Irisy "关于 X 我们记了啥" → 本地 RAG(FTS5 + 向量)从 Notes 拉。
   - **resurface**:Irisy 主动把相关旧笔记浮出来。
   - **supply**:派生 `AGENTS.md` 喂 coding agent(CTRL 独有 wedge)。

**一句话**:CTRL 不做"又一个 Obsidian",做的是 **own 的 markdown + Irisy 当知识库
的 AI 大脑(伴随 + capture/recall/resurface/supply)**。编辑器保持极简,价值在 AI 层。

## Sources
- [Note-Taking Apps 2026 — honest comparison](https://soft-amis.com/blog/2026-05-03-note-taking-apps-2026-honest-comparison/)
- [Obsidian vs Notion vs Logseq — sovereignty comparison](https://vucense.com/tech-guides/sovereign-productivity/best-note-taking-apps-2026-obsidian-notion-logseq/)
- [AI KM tools — Mem, Reflect, Tana compared](https://www.taskfoundry.com/2025/06/ai-knowledge-management-tools-mem-reflect-tana.html)
- [Build a Personal Knowledge System with AI (2026)](https://readingnotes.ai/guides/knowledge-management-with-ai)
