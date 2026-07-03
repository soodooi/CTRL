---
title: Irisy 端点唯一真相 — Notes(Obsidian 基准×Tolaria 前端) + 智能表格(Bitable 基准)
kind: truth
created_at: 2026-07-02
owner: bao
author: claude
purpose: bao「检查 note 和智能表格端点是否都给到 Irisy；note 对标 obsidian 用 tolaria 做；智能表格对标飞书；留唯一真相文件」
governing: true
related:
  - 002-substrate.md            # §1.9 v47 + §14.13 (ADR 真相)
  - "[[notes-module-replacement-plan.md]]"   # notes 设计史(切片计划)
  - "[[unified-productivity-suite-architecture.md]]"  # 写侧统一设计史
  - "[[feishu-endpoint-parity-map.md]]"      # 飞书全面 A/B/C 分桶(背景)
  - endpoint-catalog.md          # 机器生成的全量清单(每次 regen)
---

# Irisy 端点唯一真相（本文件 = 端点状态的 SSOT；其余文档是设计史/背景）

> **公式**：Notes = **Obsidian(LRA) 定端点基准** + **Tolaria 定前端** + CTRL kernel 唯一后端；智能表格 = **飞书 Bitable 定端点基准** + CTRL 原生 §14。两者全部经 `:17873` gate 给 Irisy（first-party 域，S3b 可见性修复后 `note_`/`notes_`/`doc_`→notes 域、`smart_table_`→smart_table 域、`calendar_`→calendar 域）。
>
> **定位（bao 2026-07-02）**：**CTRL 是 Irisy「项目伴侣」角色的第一个项目** —— 项目自身的 md（`vault/ctrl/` + ADR）已软链进用户 vault（`~/Documents/CTRL/projects/ctrl/{vault,decisions}`），在 CTRL 里可见可查可被 Irisy 操作，吃自己的狗粮。

## 1. Notes — Obsidian LRA 基准 ×39 工具，Irisy 全可见

| LRA 能力 | CTRL gate 工具（Irisy 用这个） | 状态 |
|---|---|---|
| vault 文件 CRUD + 目录 | `vault_read/write/delete/list/move/create_folder` | ✅ |
| **改名（link-aware）** | `vault_rename` — **自动重写全 vault wikilink**（2026-07-02 修复；LRA 生态公认缺口，我们原生补上） | ✅ |
| PATCH heading（append/replace/delete） | `doc_produce` {append/replace/delete_section}（fence-aware + CommonMark 缩进界定） | ✅ |
| PATCH frontmatter 键 | `doc_produce` {set/delete_frontmatter_key}（外科级：其余字节 verbatim，fail-closed） | ✅ |
| NoteJson 结构化读 | `note_get`（content+fm+tags+stat+links+backlinks 一次拿全） | ✅ |
| 文档地图 | `note_map`（headings 树 + ^block refs + fm 键 — AI 先看图再下刀） | ✅ |
| periodic notes（daily…yearly，指定日期） | `note_periodic`（daily 与 task 源同文件；ISO 周年界正确） | ✅ |
| active file | `note_active_get`（PWA 上报 focus，C3 边界：brain 只读）+ 写走 doc_produce | ✅ |
| open in UI | `note_open`（gate→PWA 事件，闭环在 CTRL 内） | ✅ |
| 搜索（带上下文） | `vault_search`(+`with_context`) / `vault_semantic_search` / `vault_text_query` / `notes_query` | ✅（超越：语义+§14 typed） |
| tags 计数 | `vault_tags`（+ backlinks/mentions/graph/orphans/aliases —— LRA 根本没有的图谱面） | ✅ 超越 |
| recent changes | `note_recent_changes`（第三方 MCP 的 workaround，我们原生） | ✅ |
| **git 历史/diff/活动流** | `note_history` / `note_diff` / `vault_pulse` — **user vs agent 归属**（LRA 无此能力；Tolaria 思想） | ✅ 超越 |
| **types 透镜查询** | `notes_query` 新增 `type`/`status` 字段（2026-07-02）— Irisy 能查「所有 status=active 的 Project」，与 UI 的 types-as-lenses 同一 fm 约定 | ✅ |
| PATCH 矩阵尾（prepend/块引用^id/嵌套 heading 消歧/create-if-missing/幂等守卫） | `doc_produce` E5 扩展 | ⬜ P2 按需 |
| 模板实例化 | `note_from_template`（E7） | ⬜ 待做 |
| `ctrl://` 深链 | E8 | ⬜ P2 |
| 命令面/插件命令 | 不建 —— CTRL 的等价物是 skills/工作流 | ➖ 设计裁决 |
| JsonLogic/DQL 自由查询 | 不建 —— §14 typed filters 反幻觉覆盖（LRA v4 自己都删了 DQL） | ➖ 设计裁决 |

**前端**：Tolaria（`packages/ctrl-notes-ui`，AGPL §5.1.1 例外）嵌在 CTRL 工作区（iframe + IPC 桥），49+ 命令 adapter 由 kernel 供给（`commands/notes_ui*.rs`）—— **adapter 是 UI 管线，不是 Irisy 面**；Irisy 只走上表的 gate 工具，同一 vault 同一真相。

## 2. 智能表格 — 飞书 Bitable 基准，Irisy 全可见（16 工具）

| Bitable 能力 | CTRL gate 工具 | 状态 |
|---|---|---|
| App/表 create | `smart_table_create` | ✅ |
| 记录 CRUD + 批量 | `smart_table_update_cell/append_row/delete_row/batch_*` + **统一 `smart_table_produce`**（§14.13 typed ProduceOp） | ✅ |
| 字段 CRUD | `add_field/delete_field` + produce{add/update/delete_field} | ✅ |
| **关系型列**（关联/Lookup/Rollup） | produce{add_field+relation}（建）+ describe 广告 + 索引计算（查） | ✅ |
| 视图 | `smart_table_add_view`；list/update/delete 视图 | 🟡 add ✅，其余 ⬜ |
| **AI 字段**（Bitable 没有的原生 AI 列） | `run_ai_column` 四件套（异步 job + 成本闸） | ✅ 超越 |
| 结构化查询 | `smart_table_describe/query`（§14 typed，FTS 索引后端） | ✅ |
| UpsertRows 按键合并 | 目前 append-only | ⬜ 待做 |
| 渲染级字段类型经 produce 建列 | bespoke add_field 有；produce 的 AddField 只收基类型 | ⬜ 待收敛 |
| 公式列 | RelationKind::Formula（读侧算） | ✅ 读；建列走 fm 手编 ⬜ |

**同一写侧词汇**：smart-table / task / calendar / docs 四源共用 `ProduceOp`（§14.13），Irisy 学一次动词。

## 3. Irisy 可见性证明（怎么核）

- 域分类：`visibility.rs` prefix 表 —— `note_`/`notes_`/`doc_`→`notes`，`smart_table_`→`smart_table`，`calendar_`→`calendar`（均在 FIRST_PARTY_DOMAINS）→ Irisy/hermes（first-party caller）默认 scope 全见。测试：`visibility::tests` 9 项域断言。
- 写审：所有 produce/write 动词过 review gate（`review_gate.rs` blast-radius 测试覆盖每个 `*_produce`）。
- 审计：每次调用进 audit ledger（event-store.db `audit_calls`）+ vault git 归属层（file 层 user vs irisy）。

## 4. 缺口清单（按优先级，动一条勾一条）

1. ⬜ E7 `note_from_template`（模板端点）
2. ⬜ 视图 list/update/delete（Bitable 视图面收尾）
3. ⬜ UpsertRows 按键合并
4. ⬜ E5 PATCH 矩阵尾（prepend/块引用/嵌套 heading/幂等）
5. ⬜ produce AddField 渲染级类型
6. ⬜ E8 `ctrl://` 深链（P2）
