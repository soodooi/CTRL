---
title: 功能包工作界面 = 智能表格操作界面（workspace 连接，governing）
kind: plan
created_at: 2026-07-03
owner: bao
author: claude
purpose: bao「智能表格应该能跟飞书一样做操作页面」+「用户可以创建功能包、上传分享、应该有真实的产品（对标 atoms project）」
serves: 补齐 §7.5 ①「产品级」缺的工作界面块 —— 让功能包从工具集合变成真实产品（create→work→share 闭环）
related:
  - 002-substrate.md §7.5 v48（工作界面=智能表格操作界面）+ §7.6（publish）+ §14 v30（smart-table=Bitable-parity）
  - "[[plan-ctrl-stock-cn-pack.md]]"   # stock-cn 是第一个受益者
  - "[[irisy-endpoint-truth.md]]"
---

# 功能包工作界面 = 智能表格操作界面

> **一句话**：功能包不写 bespoke UI —— 用**智能表格拼成操作界面**当工作页面（飞书 Bitable 式）。smart-table 是通用产品-UI 构建器（8 视图 + 全字段类型已就绪），功能包声明 `workspace` 指向它的表，scene 通用渲染。一建，所有包获得产品级工作界面。

## 0. 现状（grep 核实，非猜）

- **smart-table 已是飞书级**：8 视图（grid/kanban/calendar/chart/gallery/form/summary/timeline）+ 全字段类型（currency/rating/progress/select/date/checkbox + reference/lookup/rollup/formula）。= Bitable 能力面。
- **缺的连接**：`FeaturePackScene` 只认 record_source / actions / intro.md，**不认智能表格文件**。→ Irisy 建的表在 Tables 面板能看，但功能包 scene（工作页面）接不上 → 「装了没工作页面」。

## 1. 机制（数据驱动，零硬编码 —— 守 bao「硬编码不是系统该做的」）

- **manifest `workspace`**：v1 = `{ table_prefix: "tables/<pack>-" }` 约定。Irisy 建表落这前缀 → 自动进工作区，**加表零代码、零 manifest 维护**。（显式列表 `tables[]` 作为 v2 精确控制预留。）
- **加载**（`feature-pack.ts`）：读 manifest.workspace → FeaturePack.workspace 字段。
- **scene 渲染**（`FeaturePackScene`）：优先级 = workspace tables > record_source > intro.md > empty。有 workspace → 列出匹配前缀的 vault 表（`vault_list` + 前缀过滤）→ Tab 切换，每 Tab 嵌现有 smart-table 组件（含多视图）。
- **复用**：不新写表格 UI —— 嵌 Tables 面板已用的 smart-table 渲染组件（SmartTable viewer + 视图切换）。

## 2. 切片（dev-loop + checker）

| 片 | 内容 | 验收 |
|---|---|---|
| **W1 类型+加载** | manifest `workspace` schema（table_prefix）→ FeaturePack.workspace 字段 → loader 透传 | tsc；stock-cn manifest 声明 `workspace.table_prefix: "tables/stocks-"` |
| **W2 scene 渲染** | FeaturePackScene 有 workspace → `vault_list` 匹配前缀 → Tab 列表 + 嵌 smart-table 组件（多视图）；优先级高于 intro | 视觉：点股票 L1 → 见自选/策略/筛选三表 Tab，可切视图 |
| **W3 空态引导** | workspace 声明了但还没表 → 引导「让 Irisy 建一张」+ 快捷（不是空白） | 新装包无表时 scene 有引导非空白 |
| **W4 skill 更新** | create-feature-pack skill 加「声明 workspace + 建表落前缀」步 | skill 教对：产品级包=服务+工作表 |

## 3. 与产品闭环的关系（§7.5 三属性）

```
创造中心 ✅  Irisy 建服务 + 建智能表格（落 workspace 前缀）
产品级   ⬜→✅  workspace 智能表格操作界面 = 工作页面（本 plan）
分享中心 🟡  publish（§7.6，自包含打包待完善）
```
本 plan 完成「产品级」的工作界面块。分享侧的自包含打包（服务代码进包目录、workspace 表模板随包）是 §7.6 收尾，另计。

## 4. 红线

- 前端零 bespoke：只嵌通用 smart-table 组件；发现要为某包写 UI = 设计错。
- 数据驱动：workspace 是 manifest 数据 + 前缀约定，不硬编码任何 pack id。
- 锁点不动：smart-table 是既有 viewer；不新增 primitive；plain-text（表都是 vault md）。

## 5. 先做
W1（类型+加载）→ W2（scene 渲染，核心）→ W3（空态）→ W4（skill）。stock-cn 是第一个活体验收（点股票 L1 → 智能表格工作台）。
