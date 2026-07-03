---
title: Notes 模块全替代方案 — Tolaria 功能面 + Obsidian 参考端点，全原生（governing）
kind: plan
created_at: 2026-07-02
owner: bao
author: claude
purpose: bao「替代现在的 note，保持所有功能都有；obsidian 不要了，参考 obsidian 的端点建立 ctrl 所有 note 相关端点」
sources:
  - ~/Documents/coding/tolaria-reference   # 已 clone，深读完毕
  - "[[tolaria-notes-module-benchmark.md]]"
  - 002-substrate.md §1.9/§1.9.1 (待 amend) + §14.13
---

# Notes 全替代 — CTRL 原生成为最好的本地 AI 笔记系统

> **两句话**：① 前端把 NotesApp 升到 Tolaria 级功能面（types 透镜 / git 层 / 编辑器补齐），在**自己的 Tiptap + ctrl-web 栈**上做，零 Tolaria 代码（AGPL 仅参考，ADR-006 §5.1）。② 端点把 Obsidian Local REST API 的全部能力**原生建成 CTRL gate 端点**（CTRL 惯用法，非 API 兼容层），同时**退役 Obsidian**（connector + provision 全撤，ADR-002 §1.9 v24-v28 姿态 superseded）。

## 0. 两个正式 amend（经 bao 2026-07-02 拍板）

| ADR 锁点 | 原文 | 变为 |
|---|---|---|
| ADR-002 §1.9 v26 | 「stop ADDING PKM parity」；Obsidian = preferred editor + escape 口 | **CTRL 原生全替代**：NotesApp = 完整 PKM，不再有 escape 口 |
| ADR-002 §1.9.1 v26/v28 | Obsidian connector（16 工具已连 bus）+ obsidian_provision 静默装 | **全部退役**：拆 connector 注册 + provision + `commands/obsidian.rs`；Obsidian 降为「格式兼容的邻居」（vault 仍是 plain md，用户想用随时能开，但 CTRL 零接线） |

哲学不变：plain markdown = truth / vim test / 本地是 truth / gate 治理。变的只是「谁提供体验」—— 从「借 Obsidian」到「CTRL 自己是」。

## 1. 差距总账（Tolaria 378 组件深读 + CTRL 现状盘点）

**CTRL 已反超的（不动）**：搜索（FTS5+语义 vs 它的无索引内存扫描——它 HN 被骂的性能根因）、§14 结构化查询（反幻觉 typed filters，优于 Dataview/JsonLogic 自由串）、MCP 端点面（32 工具 vs 它 ~5）、AI 治理（gate 审计/review vs 它裸 CLI 直读文件）、表格（smart-table Bitable-parity vs 它的 SheetEditor）、AI 助手（Irisy+hermes vs AiPanel）。

**要补的（= 本方案）**：

| # | 功能簇 | Tolaria 实现 | CTRL 落法 | 规模 |
|---|---|---|---|---|
| G1 | **git 层**（历史/commit/diff/冲突/pulse 活动流/**AI-vs-人 attribution**） | git2 全模块 | kernel `vault_git.rs`（git2-rs）+ gate 端点 + gate 写路径自动 commit（author=irisy/user） | 大 |
| G2 | **Types 透镜 + Views/Collections**（软类型导航 + 保存的过滤视图） | 前端 types/views/FilterBuilder | fm `type:` 驱动 + **保存的 §14 notes_query 当 sidebar 透镜**（复用查询引擎，零新后端） | 中 |
| G3 | **编辑器补齐**：TOC、math(KaTeX)、折叠段、块重排、callouts、图片 lightbox、PDF 导出 | BlockNote 生态 | **Tiptap 官方扩展**逐个装（栈已锁，全有现成 ext） | 中 |
| G4 | **Wikilink 前端**：内联 token + 自动补全 + 粘贴恢复 | 自研 inline-wikilink 系列 | Tiptap suggestion + gate `vault_suggest_links`（已有） | 小 |
| G5 | **Properties 面板升级**：typed 属性编辑 | DynamicPropertiesPanel | FrontmatterPanel 升级 + 新 fm-patch 端点（E4） | 小 |
| G6 | **白板** | tldraw（⚠️ 非 MIT：tldraw license 带水印/商用需授权） | **Excalidraw（MIT）**作 viewer registry 新 content-type（`.excalidraw.md`） | 中 |
| G7 | 多 vault / workspaces | 多 vault 切换 | **不做 v1**（CTRL 单 vault root 是 ADR 锁点；后评估） | — |
| G8 | 命令面板/QuickOpen | CommandPalette+AI mode | ctrl-web 已有底子，补 notes 作用域 | 小 |

## 2. 端点计划 — 参考 Obsidian LRA，建 CTRL 原生全端点

> 原则：**CTRL 惯用法**（gate 工具 + §14 动词），不是 Obsidian API 路径兼容。参考基准 = LRA 端点组（§1.9.1 v26 已调研的表 + 深研附录）。

**已覆盖（32 工具，超越 LRA——它连 backlinks/graph 端点都没有）**：vault CRUD（read/write/delete/list/rename/move/create_folder）、搜索三层（FTS5/语义/§14 notes_query+text_query）、知识图（backlinks/mentions/tags/graph_data/aliases/orphans/broken_links/suggest_links）、watch、embed、star、`doc_produce`（§14.13 heading 级手术编辑 = LRA `PATCH /vault/ Target-Type: heading` 的等价物，刚建成）。

**新建端点（E 系列，全走 review gate）** — 参考基准 = LRA v4.1.3 openapi.yaml 逐条核验（16 路径/34 操作，深研 2026-07-02）+ 两个主流 obsidian-MCP 的工具清单（它们把哪些 REST 能力提升为独立工具 = 生态用法投票）：

| # | 端点 | LRA 参照 | 说明 |
|---|---|---|---|
| E1 | `note_periodic(period, date?)` + 写侧走 doc_produce | `/periodic/{daily…yearly}/` + `/periodic/{p}/{y}/{m}/{d}/`（5 动词全套） | 解析/创建 daily/weekly/monthly/quarterly/yearly note，含指定日期寻址（daily 已有 `daily_note_path`，推广）。Irisy「加到今天的日记」「我这周写了什么」 |
| E2 | `note_active_get` / active 写走 doc_produce(path=active) | `/active/` 5 动词 | **当前在 CTRL workspace 打开的笔记**：PWA 经现有 WS 上报 active path → kernel 记录 → Irisy「总结我正在看的」 |
| E3 | `note_open(path, heading?)` | `POST /open/{path}` + URI open 的 heading/block 深链 | 让 PWA 跳转到某笔记（可带 heading 锚点）；「打开 X」闭环在 CTRL 内 |
| E4 | `doc_produce` 新 ProduceOp：`SetFrontmatterKey {key,value}` / `DeleteFrontmatterKey {key}` | `PATCH Target-Type: frontmatter`；两个第三方 MCP 都把它提升为独立工具（manage_frontmatter）= 生态强需求 | 手术式 fm 键改（在 write_body 的 raw-fm 保真上做定向行编辑，不整块重写）；G5 properties 面板的后端 |
| E5 | `doc_produce` PATCH 语义补齐（P2 按需）：`PrependSection`、嵌套 heading 路径（`H1::H2` 消歧同名）、块引用 `^id` 寻址、`create_if_missing`、`if_absent`（幂等守卫） | `Operation: prepend` × `Target-Type: block` × `Target-Delimiter` × `Create-Target-If-Missing` × `Reject-If-Content-Preexists` | LRA 的 PATCH 矩阵是**全生态被包装最多的原语**；现 doc_produce 已覆盖主场景（append/replace/delete by heading），矩阵剩余项按 Irisy 真实需求逐个上 |
| E6 | `note_history(path)` / `note_diff(path, rev)` / `vault_commit` / `vault_pulse` | LRA 无此能力（**超越项**，来自 Tolaria G1） | git 层端点：per-note 历史、diff、活动流、AI attribution |
| E7 | `note_from_template(template, target)` | LRA 无（Templater 是插件） | 模板实例化（前端 TemplatesModal 已有，落端点让 Irisy 可用） |
| E8 | `ctrl://` URI scheme（open/new/daily/search） | Obsidian URI 7 action（open/new/daily/unique/search/choose-vault/hook） | P2 可选：系统级深链，Tauri deep-link；unique/choose-vault/hook 不建（niche） |
| E9 | `note_map(path)` — 文档地图：headings 树 + block-ref 列表 + fm 键 | MCP 工具 `vault_get_document_map` | **AI 精准 patch 的前置**：Irisy 先看地图再选 heading 寻址，防瞎猜 |
| E10 | `note_get(path)` — 一次返回 content+fm+tags+stat+**links+backlinks** | `GET /vault/{f}` `Accept: note+json`（NoteJson，table-stakes） | CTRL 现在要 3-4 次调用拼齐；合一减少 AI 回合数 |
| E11 | `vault_rename`/`vault_move` 升级为 **link-aware**（改名自动重写全 vault 指向它的 wikilink） | 插件 API `fileManager.renameFile`；REST 无此路由 = 公认缺口，MCP 工具 `vault_move` 补的就是它 | **超越项**：backlink 索引已有，重写引用是增量 |
| E12 | `note_recent_changes(limit, days?)` | 第三方 MCP `get_recent_changes`（REST 缺口 workaround） | 按 mtime 从 FTS 索引直出；「我最近改了什么」 |
| E13 | `vault_search` 返回**匹配上下文**（match 位置 + context 片段, contextLength 参数） | `POST /search/simple/` 的返回形状 | 现在只回 path 列表；AI 需要上下文判断相关性 |

**不建**：`/commands/`（Obsidian 插件命令面——CTRL 的等价物是 skills/工作流，已有自己的面）、证书端点（gate token 已有）、JsonLogic/DQL 自由查询语法（§14 typed filters 反幻觉路线已覆盖同一需求，且 LRA v4 自己都把 DQL 删了）、多 vault 端点（G7 不做）、事件 webhook（vault_watch + event_ws 已超越——LRA 全程无事件流）。

## 3. 切片序（dev-loop，每片独立 checker + commit）

| 片 | 内容 | 验收 |
|---|---|---|
| S1 | **退役 Obsidian**：拆 `commands/obsidian.rs` + boot provision + connector 注册；ADR-002 §1.9/§1.9.1 amendment（v29） | 代码零 obsidian 引用；ADR 无漂移；ratchet 降 |
| S2 | **E4 fm 手术端点**（SetFrontmatterKey/Delete…，raw-fm 保真行编辑）+ **E9 note_map + E10 note_get**（读侧合一）+ G5 properties 面板接线 | fm 注释/键序在未触键上 verbatim（回归测试）；note_map 引导 doc_produce 精准寻址 |
| S3 | **E1 periodic + E2 active + E3 open + E12 recent + E13 search 上下文** | Irisy 真机三连：「加到今天日记」「总结我在看的」「打开 X」 |
| S4 | **G1 git 层 kernel 半**：vault_git.rs（init/auto-commit on gate writes + author attribution）+ E6 端点 | gate 写→git log 可见 irisy/user 区分 |
| S5 | **G1 git 层前端半**：per-note History/Diff 面板 + Pulse 活动流 | 视觉验证（Playwright） |
| S6 | **G2 types 透镜 + views**：fm type: 软类型 + 保存的 §14 查询当 sidebar 透镜 | 建 type/建 view/过滤全流跑通 |
| S7 | **G3+G4 编辑器补齐**：TOC/math/折叠/块重排/callout/lightbox/wikilink 自动补全/PDF | 逐项视觉验证 |
| S8 | **G6 白板**：Excalidraw viewer type | 建白板/存 `.excalidraw.md`/vim 可读(JSON in md) |
| S9 | **E7 模板端点 + E11 link-aware 改名 + G8 命令面板 notes 作用域** + 收尾（E5/E8 视需求） | 改名后全 vault wikilink 不断链（回归测试）；全端点 catalog 重生成 |

依赖：S1 独立先行；S2→S3（active 写复用 fm/heading 手术）；S4→S5；其余并行度高。

## 4. 许可与代码来源（红线）

- **Tolaria 代码零 vendoring**（AGPL 仅参考，ADR-006 §5.1）——本方案全部自实现；它的价值 = 功能清单 + UX 模式 + 用户研究（HN 反馈的坑：block editor 摩擦/无索引搜索/大文件性能，全绕开）。
- **白板选 Excalidraw（MIT）不选 tldraw**（tldraw 是自定义 license：免费带水印、商用去水印需付费——踩不得）。
- Tiptap 扩展全 MIT；KaTeX MIT；git2-rs MIT/Apache。

## 5. 锁点自检

5 primitives 不动；三动词加固（E4/E5 是 ProduceOp 变体不是新工具族）；`:17873` gate + review 全覆盖；plain-text/vim test 全过（白板也是 md 内 JSON）；秘密不进 LLM；**「Ctrl-key 唯一入口」反而被加强**（Obsidian escape 口消失）。

## 待 bao 拍
1. 切片序 OK？（我建议 S1 立即做——退役是净删除，最安全的第一刀）
2. G7 多 vault 确认不做 v1？
3. 白板 Excalidraw 替 tldraw，OK？
