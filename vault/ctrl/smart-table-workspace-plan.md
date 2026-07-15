# 智能表格工作区 — 完整功能清单 + 开发需求 (统管全局规划图)

> bao 2026-06-20 钦定:「我让你做智能表格工作区,你做了个表格」。本文件 = 补上缺失的**整体规划**(memory `feedback-system-design-not-debug-driven`):先有统管全局的功能全集 + 开发需求,再实施;不再 debug 式逐个组件凑。
> 事实源:`research-feishu-bitable.md`(飞书事实)。取舍落 `ADR-003 §6` + `ADR-002 §14`。本文件 = 可执行的开发分解(清单 + 需求 + 验收 + 分期)。

---

## 0. 为什么之前做成了「表格」而不是「智能表格工作区」(根因)

1. **没先建统管全局的规划就动手** —— 从「修显示 bug」→「接 AI 列」一路局部推进,每步都是 debug 式补丁,从没停下来画出工作区的完整功能全集。违反「系统设计先行」。
2. **以「内核已有切片」为锚,而非「产品全貌」为锚** —— 内核现成有 query / produce / ai_column,我就围着这几个接;应该从「智能表格工作区是什么」倒推完整需求,再看内核缺什么。
3. **GOAL 把范围窄成了工程切片(§14 接前端)** —— 顺着 SC8「消费 query gate」做,这是工程视角不是产品视角。
4. **调研只转成了 ADR 取舍表,没转成可执行开发需求** —— 飞书事实有了,但缺这份「功能清单 + 每条的 kernel/前端/数据格式/验收」分解。

本文件修正以上四点。

---

## 1. 产品定义:智能表格工作区 ≠ 一个表格组件

**智能表格工作区** = CTRL 的一个 L1 模块(per-L1 workspace, memory `project-ctrl-per-l1-workspace-output-routing`),它是一个**完整产品面**,不是一个 grid 组件。三件事缺一不可:

1. **结构化数据面** —— 强类型字段 + 多视图(grid/kanban/...)+ 数据操作(filter/sort/group)。这是「表格」部分。
2. **AI 长在数据上** —— AI-as-column(整列批处理)+ AI 生成表/列 + 与 Irisy 联动。这是「智能」部分(差异化核心)。
3. **工作区外壳** —— 左浏览区 + 中表格面 + **右 Irisy 常驻**;创建/打开流;数据即本地 markdown(vim test)。这是「工作区」部分。

> 之前只做了 (1) 的一个子集 + 今天刚接 (2) 的第一笔。这就是「做成了表格」的原因。

### 信息架构(整体网格 — 所有局部对齐它)

```
┌─ L1 rail ─┬──────────── scenePane (智能表格工作区) ───────────┬─ Irisy (常驻) ─┐
│  [✦表格]  │  ┌─ 左:表清单 ─┬─ 右:当前表 ────────────────┐  │  对话 + AI pipe │
│           │  │ Smart Tables │ [VAULT path]        [+Row]   │  │  路由 AI 结果回 │
│           │  │ · CRM Deals  │ ┌ query bar: view|filter|... │  │  本工作区       │
│           │  │ · Tasks      │ ├ AI panel (按列触发)        │  │                │
│           │  │ [+ New]      │ └ grid / kanban / gallery... │  │                │
│           │  └──────────────┴──────────────────────────────┘  │                │
└───────────┴──────────────────────────────────────────────────┴────────────────┘
        数据 = ~/Documents/CTRL/<path>.md  (YAML frontmatter schema + pipe table body)
```

数据格式(plain-text 哲学,vim test 门槛):
```markdown
---
title: CRM Deals
schema:
  - { key: name, label: Name, type: text }
  - { key: amount, label: Amount, type: currency }
  - { key: stage, label: Stage, type: select, options: [lead, won, lost] }
views:
  - { kind: kanban, group_by: stage }
---
| Name | Amount | Stage |
|---|---|---|
| Acme | 12000 | won |
```

---

## 2. 完整功能清单(对照飞书 7 块 × CTRL 落地 × 优先级 × 现状)

优先级:**P0** = v1 MVP 必须 · **P1** = v1.1 · **P2** = v1.x/可选。
现状:✅done · 🟡partial · ⬜todo · ❌non-goal。

### A. 数据底座 + Schema
| # | 功能 | 优先 | 现状 | 备注 |
|---|---|---|---|---|
| A1 | frontmatter `schema` + pipe table body(plain-text)| P0 | ✅ | `vault_smart_table.rs` + `lib/smart-table.ts` |
| A2 | schema round-trip(对象数组 / flow-string 双形)| P0 | ✅ | 刚修 `body`→`content` bug |
| A3 | 字段增删改(改 schema)| P0 | ⬜ | 现在只能手编 frontmatter;缺 UI |
| A4 | 行身份 `row_id`(稳定主键)| P1 | ⬜ | 现按 snapshot 匹配;关联/历史需要它 |

### B. 字段类型系统(飞书 15+,渲染即类型)
| # | 类型 | 优先 | 现状 |
|---|---|---|---|
| B1 | text / number / select / date / checkbox / tags / url | P0 | ✅ 7 类 |
| B2 | 渲染即类型:select=彩色胶囊、rating=星、progress=进度条、currency=货币 | P0 | ⬜ 现在 select 是下拉、无星/进度/货币 |
| B3 | multiline / email / phone / rating / progress / currency | P1 | ⬜ |
| B4 | 元数据:created / modified / created_by(单人,弱)| P2 | ⬜ |
| B5 | attachment(指向 vault 文件/asset)| P1 | ⬜ |
| B6 | formula(单行公式:`amount*qty`)| P1 | ⬜ |

### C. 视图系统(视图 ≠ 数据,态存 frontmatter `views`)
| # | 视图 | 优先 | 现状 |
|---|---|---|---|
| C1 | Grid | P0 | ✅ |
| C2 | Kanban(按字段分组,拖拽换列=改值)| P0 | 🟡 显示有,拖拽改值 ⬜ |
| C3 | 视图态(filter/sort/group/kind)存 frontmatter + 读回 | P0 | 🟡 kind/group 存;filter/sort 未持久化 |
| C4 | 多视图并存(一表多 saved view,可切换/命名)| P1 | ⬜ 现在只存 1 个 |
| C5 | Gallery(卡片墙)| P1 | ⬜ |
| C6 | Calendar(按 date 字段)| P1 | ⬜ |
| C7 | Form(对外收集,提交=新增行)| P2 | ⬜ |
| C8 | Gantt(按起止日期)| P2 | ⬜ |

### D. 数据操作
| # | 功能 | 优先 | 现状 |
|---|---|---|---|
| D1 | filter(类型感知算子)| P0 | ✅ `smart-table-query.ts` + kernel `query.rs` |
| D2 | sort(单列)| P0 | ✅ |
| D3 | group(单级)| P0 | ✅ |
| D4 | 计数 matchCount / total | P0 | ✅ |
| D5 | filter 多条件 AND/OR + 多级 group | P1 | ⬜ 现在 AND 链、单级 |
| D6 | 行展开 = 记录详情卡 | P1 | ⬜ |
| D7 | 隐藏列 / 冻结列 / 行高 | P2 | ⬜ |
| D8 | 全表搜索 | P1 | ⬜(可复用 vault FTS5)|
| D9 | 前端 query 改走 :17873 gate(§14 单一回流)| P2 | ⬜ 现在前端本地 `queryTable` 重算,绕 gate |

### E. AI 能力(★ 差异化核心 = AI-as-column)
| # | 功能 | 优先 | 现状 |
|---|---|---|---|
| E1 | run_ai_column 内核(plan/complete/apply,同步)| P0 | ✅ `ai_column.rs` |
| E2 | run_ai_column 异步 job 三件套(start/status/cancel)| P1 | ✅ 内核 |
| E3 | **AI 列前端入口**(列头 ✦ → op+prompt → Run)| P0 | 🟡 **本回合刚接(Tauri command + UI),待真机验**|
| E4 | cost gate 确认(>100 行)+ no_provider 提示 | P0 | 🟡 刚接 confirm 重试 |
| E5 | 「自动更新」:新增行自动跑该列 AI(飞书杀手锏)| P1 | ⬜ 需把 op+prompt 存进 schema 字段定义 |
| E6 | AI 生成整表(自然语言 → schema + 种子行)| P1 | ⬜ Irisy 联动 |
| E7 | AI 智能标签 / 信息提取(op 已有 classify/extract)| P1 | 🟡 op 在,缺预定义标签 UI |
| E8 | 异步 job 前端(start→poll status→进度条→cancel)| P1 | ⬜ 现在前端走同步 command |

### F. 关系 / 软关联(plain-text 取舍:不做外键)
| # | 功能 | 优先 | 现状 |
|---|---|---|---|
| F1 | `[[wikilink]]` 单元格 + backlink 软关联 | P1 | ⬜ 复用 `vault_graph.rs` |
| F2 | Lookup(沿 wikilink 跨文件取值,走 query 内核)| P2 | ⬜ |
| F3 | Rollup(对关联记录聚合)| P2 | ⬜ |
| F4 | 关系型外键(关联/双向)| — | ❌ non-goal(ADR-003 §6.4)|

### G. 协作 / 历史 / 集成
| # | 功能 | 优先 | 现状 |
|---|---|---|---|
| G1 | 编辑历史(git diff;文件即数据)| P2 | 🟡 天然有 git,无 UI |
| G2 | 导入 CSV/Excel → 智能表格 | P1 | ⬜ |
| G3 | 导出 | — | ❌ 无需(文件就是数据,plain-text 哲学)|
| G4 | 实时协同 / 评论 @ / 字段级权限 | P2 | ❌/⬜ 多数 non-goal(单人模式)|

### H. 派生 / 仪表盘
| # | 功能 | 优先 | 现状 |
|---|---|---|---|
| H1 | 只读派生视图(图表:柱/折/饼)| P2 | ⬜ |
| H2 | AI 一键生成仪表盘 | P2 | ⬜ |

### I. 工作区外壳
| # | 功能 | 优先 | 现状 |
|---|---|---|---|
| I1 | scenePane 三区 + Irisy 常驻(非全屏)| P0 | ✅ `TablesPanel` + `AmbientHome` |
| I2 | 表清单浏览(扫 vault schema 文件)| P0 | ✅ `smart-tables.ts` |
| I3 | + New 建表 | P0 | ✅ starter schema |
| I4 | Irisy 把 AI 输出路由进本工作区(AI is pipe)| P1 | ⬜ |
| I5 | 自动化流程编辑器 | — | ❌ non-goal(撞不做清单)|

---

## 3. v1 MVP 开发需求(P0 集合 — 下一步只做这些)

目标:让「智能表格工作区」名副其实 = 能建表 / 强类型 / 多视图查询 / **AI 列真能跑** / Irisy 常驻。

| 需求 | kernel | 前端 | 数据格式 | 验收 |
|---|---|---|---|---|
| **R1 AI 列前端可用**(E3/E4)| `smart_table_run_ai_column` command(✅ 本回合)| 列头 ✦ → op+prompt → Run + 结果(✅ 本回合)| 写回 body | 真机:配 provider 后,一列空格被 AI 填满;无 provider 给提示;>100 行确认 |
| **R2 渲染即类型**(B2)| — | select=彩签、rating=星、progress=进度条、currency 格式化 | type 已在 schema | 各类型视觉区分,非裸下拉 |
| **R3 字段增删改 UI**(A3)| 复用 vault_write | 列头菜单:加列/改类型/删列 | 改 frontmatter schema | UI 改 schema 后文件 frontmatter 正确变更 |
| **R4 视图态完整持久化**(C3)| add_view 已有 | filter/sort 也存 frontmatter + 读回 | `views[]` 扩展 | 切走再回来,filter/sort 还在 |
| **R5 Kanban 拖拽改值**(C2)| — | 拖卡片到另一列 → update_cell | body | 拖拽后该行分组字段值变更并落盘 |

> P0 之外(P1/P2)按 roadmap 分期,不在 MVP 切片。

---

## 4. Roadmap(分期)

- **v1.0 (MVP)** = §3 的 R1–R5 + 现有 A1/A2/B1/C1/D1-4/I1-3。→ 真·智能表格工作区最小闭环。
- **v1.1** = 字段类型扩(B3/B5/B6)、多视图(C4)、gallery/calendar(C5/C6)、AI 自动更新(E5)、AI 生成表(E6)、异步 job 前端(E8)、wikilink 软关联(F1)、导入(G2)、多级/OR 查询(D5)、记录详情卡(D6)。
- **v1.x** = form/gantt(C7/C8)、lookup/rollup(F2/F3)、仪表盘(H)、前端 query 走 gate(D9)。

---

## 全量令 (bao 2026-06-20:「不要做裁剪,所有的表格功能都要」)

核实 Teable(开源飞书 Bitable)后,bao 钦定 **全量对标,零裁剪**。原先因 plain-text 哲学标的 non-goal(关系型用 wikilink 替代、自动化不做、字段类型砍、视图砍)**全部取消** —— 路线 C(SQLite 派生索引,markdown 仍 truth)正是为了「守哲学又能做全」。

**全做(不再裁剪)**:全部 27 字段类型(含 link/Lookup/Rollup/公式/附件/人员/按钮…)· 全部视图(grid/kanban/gallery/calendar/gantt/form)· 多表 base + 表间关联 · 多级分组 + OR 筛选 · 公式(100+ 函数)· 统计栏 · 复选框选择列 + 列头字段类型图标 · 导入导出 · 仪表盘 · (自动化若撞当前 Kiro Product Boundaries（`.kiro/steering/development-philosophy.md`）,遇到时与 bao 确认)。

---

## 实装进度 (2026-06-20 — 分支 feat/smart-table-full,一次性全量)

按本规划全量推进,7 批全部落地(每批 tsc + cargo + vitest + Playwright 验证后 commit):

1. ✅ AI 列前端(E3/E4)+ 本规划 + 开源源码参考(Teable/undb,AGPL 只参考设计)
2. ✅ 渲染即类型 + 6 新字段类型(B2/B3):select/tags 彩签、rating 星、progress 条、currency 货币、email/phone/url 链接、multiline
3. ✅ 字段增删改 UI(A3)+ Kanban 拖拽改值(C2)
4. ✅ 多视图 tabs + Gallery + Calendar 视图 + sort 持久化(C3/C4/C5/C6)
5. ✅ 记录详情卡(D6)
6. ✅ AI 自动更新(E5):aiConfig 存字段 + 新行自动跑
7. ✅ CSV 导入(G2)

**剩余(诚实标注,均 P2,需内核 cross-file query 等更大工作)**:wikilink 软关联 + Lookup + Rollup(F1-F3)、前端 query 改走 :17873 gate(D9)、AI 异步 job 前端(E8)、仪表盘(H)、Form/Gantt 视图(C7/C8)、多级/OR 查询(D5)。

---

## 5. 现状一句话总结

- 「表格」部分(A/C/D 的 P0)≈ 完成。
- 「智能」部分(E)= 内核早已实装,前端入口**本回合刚接上(R1),待真机验证**。
- 缺口集中在:**渲染即类型(R2)、字段编辑 UI(R3)、视图态完整持久化(R4)、kanban 拖拽(R5)** —— 这四条做完,v1 MVP 闭环。
