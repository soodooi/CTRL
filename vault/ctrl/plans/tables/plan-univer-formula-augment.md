---
title: 自研为骨 + Univer 补公式（smart-table 公式/电子表格增强，governing）
kind: plan
created_at: 2026-07-03
owner: bao
author: claude
purpose: bao 拍板「自研为骨 + Univer 补公式」——四方对比（pxcharts/Univer/Teable/自研）后定：主架构维持自研 smart-table（保 vault 统一 + gate + 8 视图 + 关联），引入 Univer（Apache-2.0、同栈 React18+Vite、Canvas 公式引擎）补掉自研唯一弱项：Excel 式公式 / 大网格计算。
serves: §7.5 功能包工作界面（智能表格操作界面）的能力补全——让 workspace 表格在「多维+关联+多视图+公式+大数据」全维度齐平飞书 Bitable，且数据全程留 vault、Irisy 统一可见。
related:
  - 002-substrate.md §14（smart-table = Bitable-parity）+ §7.5（workspace=智能表格操作界面）
  - 003-frontend.md § viewer（viewer registry：content-type 驱动、lazy load）
  - "[[plan-pack-workspace-smart-table-ui.md]]"
  - "[[architecture-byo-cli-driver.md]]"
---

# 自研为骨 + Univer 补公式

> **一句话**：不换 substrate。自研 smart-table 继续是骨（Airtable 式多维表格：关联/rollup/8 视图/gate produce，数据=vault markdown）；Univer 只当**渲染 + 公式内核**补自研弱项（Excel 式自由网格 + 400+ 函数）。数据 source of truth 永远是 vault 文件，Univer 是投影/计算层，不是存储。

## 0. 为什么是这条路（四方对比结论，非哲学）

| | pxcharts | Univer | Teable | 自研 |
|---|---|---|---|---|
| 本质 | 多维表格(弱) | **电子表格 SDK** | 多维表格(强) | 多维表格 |
| 形态 | 整包 Next.js | **可嵌入 SDK** ✅ | 整包 app + Postgres + NestJS | 已内建 |
| 同栈 | ✗ React19/Next | ✅ **React18+Vite+Canvas** | ✗ | ✅ |
| License | GPL+商用授权⚠️ | **Apache-2.0** ✅ | AGPL(AI 企业版) | 自有 |
| 关联/多视图 | ✗ | ✗(是 sheet) | ✅ | ✅ |

- **Teable 最强但不可嵌入**（整包 app + Postgres 后端）→ 数据搬出 vault → 切断 `vault_index` FTS5 + Irisy 统一 RAG + 表↔笔记 backlink = **数据孤岛**。对「OPC 统一 AI 前端」是净损失，弃。
- **Univer 唯一可嵌入 + 同栈 + 最干净 license**，但它是电子表格不是多维表格 → **只补公式/网格，不替代自研**。
- 自研 smart-table 已建好（8 视图 + reference/lookup/rollup/formula + gate produce + AI 列），沉没成本已付 → 保为骨。
- 自研唯一弱项 = 公式：`smart-table-formula.ts` 仅 304 行，基本只有 AND/OR/NOT + 基础算术，缺 SUM/IF/VLOOKUP/统计/文本/日期几百函数。Univer `@univerjs/engine-formula` = 400+ Excel 函数。**这就是要补的精确 gap。**

## 1. 机制（两种接法，互补）

Univer 是模块化的（`@univerjs/core` + `@univerjs/engine-formula` + presets UI）。两种角色：

- **A. 独立 spreadsheet viewer（松耦合，先做）**：Univer 完整 UI 作一个新 viewer 进 registry，content-type = `spreadsheet`（.xlsx / 自由网格）。补的是**真电子表格范式**（自由单元格，不是 schema 表）。数据 = vault 文件存 Univer snapshot（JSON）。与自研 smart-table 分工：smart-table 管 database 式多维表格，Univer 管 Excel 式自由表格。
- **B. 公式内核接入 smart-table（深，后做）**：把 `@univerjs/engine-formula` 当**纯计算库**，替换自研 `smart-table-formula.ts` 的弱求值器。smart-table 的 `formula` 字段 `expression`（`{col}` 语法）→ 适配层解析 `{col}` 为值 → 交 Univer 函数内核求值 → 拿 400+ 函数。**数据模型零改动**（vault markdown + schema 不变），只换求值引擎。保 vault 统一 + Irisy 可见。

## 2. 切片（dev-loop + checker）

| 片 | 内容 | 验收 |
|---|---|---|
| **S0 spike** | 装 `@univerjs/core` + `@univerjs/engine-formula`（+ preset UI 探）；写 headless PoC：给 workbook data + 公式 → 独立算出值（验证 engine-formula 能脱离 UI 当库用）；量 lazy-chunk 体积 | PoC 打印 `SUM/IF/VLOOKUP` 正确结果；确认 React18/Vite 装得上、体积可 lazy 隔离 |
| **S1 spreadsheet viewer** | Univer preset UI 作 viewer 进 registry（`spreadsheet` content-type，lazy）；data ↔ vault 文件（读 snapshot / onSave 写回） | 工作区开一个电子表格：Excel 式编辑 + 公式算数 + 存回 vault，刷新还在 |
| **S2 公式内核接入** | smart-table `formula` 字段求值改走 Univer engine-formula；`{col}`↔值适配层；自研 `smart-table-formula` 降级为 fallback | smart-table formula 列：`{price}*{qty}`、`SUM`/`IF`/`ROUND`/`VLOOKUP` 算对；旧公式不回归 |
| **S3 ADR+skill** | ADR-002 §14 amend（bump version + changelog：Univer 补公式）；若涉及功能包工作界面，更新 create-feature-pack skill | §14 记录决策；skill 教对 |

## 3. 红线

- **数据留 vault** — Univer 是渲染/计算层，source of truth 永远是 vault 文件（snapshot JSON 或 markdown schema）。vim test：文件还在、能开。**这是弃 Teable 的核心理由，不能自己破。**
- **自研是骨** — smart-table 的多维/关联/rollup/8 视图/gate produce 不动；Univer 只补公式 + 电子表格网格。发现要为 Univer 改自研数据模型 = 设计错。
- **lazy 隔离体积** — Univer 只在用到（开 spreadsheet / 首个 formula 列求值）时进 bundle，不进 critical-path（≤200KB PWA 壳不受影响）。
- **锁点不动** — 5 primitives / `:17873` gate / plain-text（表=vault 文件）/ secret 不进 LLM。
- **License** — Univer Apache-2.0 核心免费；**只用社区版模块**，不碰 Univer Pro 付费层（协作/导入导出/透视表等）。若某能力只在 Pro → 记为 gap，不引入 Pro 依赖。

## 3.5 S0 spike 结论（2026-07-03，已跑）

装 `@univerjs/core@0.25.1` + `@univerjs/engine-formula@0.25.1`（40 包）+ headless PoC 实测：

- ✅ **核心过**：Univer core + engine-formula 在 **node headless 起成功、零 DOM 依赖**（`new Univer()` + `registerPlugin(UniverFormulaEnginePlugin)` + `FUniver.newAPI` 全通）。→ 嵌 CTRL(Vite/React18) 无阻塞；React18–19 官方兼容确认。Apache-2.0，无 Pro 依赖。
- ⚠️ **重路径不划算**：workbook + facade 跑完整 calc 需再接 `@univerjs/sheets`(数据插件) + facade + calc 管线（facade `getActiveWorkbook` 拿不到 = 缺 sheets 插件；`onCalculationEnd` 事件在裸装配下不 fire）。**这条正好不是 S2 要的**——S2 要的是「表达式 + 命名值 → 值」，不需要 sheet/calc 管线。
- **对 S1/S2 排序的验证**：
  - **S1（独立 spreadsheet viewer）走 `@univerjs/presets`** —— presets 自动接全插件(含 sheets + calc)，UI 里 calc 正常跑，**低风险**，先做。
  - **S2（公式内核当库）不走 workbook 路径**，改走底层 `Lexer → LexerTreeBuilder → AstTreeBuilder → Interpreter + FunctionService`（值代入后是无引用公式，绕开 sheet/command/mutation 管线）。需 DI 装配 + 函数注册 = **中风险，另起一个 S2 spike 定装配**。

**净判断**：plan 的「S1 先、S2 深」排序被 spike 证实正确。S1 用 presets 稳落地；S2 的引擎装配值得单独 spike。

## 4. 顺序 + 风险

**S0（spike，绿了才继续）→ S1（独立 viewer，快见效、零回归）→ S2（引擎接入，深）→ S3（ADR+skill）。**

- **风险 1（S0 决定成败）**：`engine-formula` 能否脱离 Univer UI 独立当库用？若强耦合 `@univerjs/core` 的重数据结构 → S2 成本升高，退而只做 S1（独立 viewer）也已补齐「真电子表格 + 公式」这块可见价值。
- **风险 2**：`{col}` 语法 ↔ Univer A1 引用体系的适配（S2）。缓解：保留 smart-table `{col}` 语法，只借 Univer 的**函数求值内核**（把 `{col}` 预解析成值代入，再交 Univer 算函数），不整体迁到 A1。
- **风险 3**：体积。缓解：lazy chunk + 只引 core+engine-formula（S2）/ preset（S1），不引全套 presets。
