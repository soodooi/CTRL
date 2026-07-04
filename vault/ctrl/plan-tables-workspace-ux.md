---
title: Tables 工作区 UX 重设计 — 抄 best-in-class 作业（governing）
kind: plan
created_at: 2026-07-03
owner: bao
author: claude
purpose: bao 2026-07-03「ui ux 没有太多改变，你还是得研究一下，规划一下；抄作业最好」——现 TablesPanel 还是早期 Grist 极简侧栏（New/Import + 扁平列表 + detail），没升到 v48 §7.5「跟飞书一样做操作页面」的产品级操作台。本 plan = 真调研五家（飞书 Bitable/Airtable/Notion/Teable/Univer）后的 UX 规划。
serves: 兑现已有 IA（smart-table-workspace-plan.md 的「L1 | 左表清单 | 中表格面 | 右 Irisy」）+ §7.5 产品级工作界面。
research_source: 五家真·web 调研（agent a16fbe1f，2026-07-03，全带一手 URL）；已有事实源 research-feishu-bitable.md。
related:
  - "[[smart-table-workspace-plan.md]]"   # 已有功能全集 IA（本 plan 补 UX 外壳）
  - "[[plan-univer-formula-augment.md]]"  # Univer 电子表格（本 plan 统一两范式）
  - "[[smart-table-minimal-ui.md]]"       # 旧 Grist 极简方向（被本 plan 升级）
  - 003-frontend.md §6（smart-table workspace）
---

# Tables 工作区 UX 重设计

> **一句话**：把「扁平侧栏列表 + 通用 detail 面」换成五家趋同的**三区外壳**：**左树 spine（飞书 web 导航）· 中「工具栏 + 网格」· 右 Irisy 视图感知面板**。表格 + 电子表格在左树统一为兄弟叶子；智能表格的视图嵌套其下；Univer sheet 保留自带底部 tab。

## 0. 现状 gap（为什么「没太多改变」）

已有 IA（`smart-table-workspace-plan.md`）画对了（左表清单 | 中表格 | 右 Irisy），但**从没做成 UI**——TablesPanel 停在早期 Grist 极简侧栏。我这轮加的 Spreadsheets 分区是往旧壳贴补丁，不是设计。本 plan 补的是「长什么样、怎么流转」。

## 1. 趋同作业（五家都这么做 = 安全可抄）

1. **一份数据 → 多视图**，视图 = 保存的镜头（filter+sort+group+layout），`+` 廉价新建、可逆。
2. **视图塑形工具栏 = 一排 popover 触发按钮**：Hide-fields · Filter · Group · Sort · Color · Row-height。**无 modal 向导**，全是从按钮落下的轻 popover；**所有设置 view-scoped 不是 table-global**。
3. **密集 hairline 网格，不是卡片**；颜色只作 low-chrome 强调（从 select 字段来 / 渲成标签胶囊）；容器浮在灰底面上；4 档行高用户控密度。
4. **≤2 次点击、零向导**（飞书明说「两次点击」律）——正好等于 CTRL 的 one-shot 哲学。
5. **AI 建表已是标配**：NL → 生成 schema（表+字段+关系+建议视图）→ 预览 → 精修。**要打赢的共同短板**：Airtable Omni / Notion AI 只能「建」不能「改」、建不了视图——**CTRL 的 Irisy「改现有表 + 视图感知对话」（对标 Teable）就是差异化**。

## 2. 分歧 → CTRL 取舍

| 轴 | Airtable | 飞书 / Teable | Notion | **CTRL 取** |
|---|---|---|---|---|
| **表**住哪 | 顶部 tab | **左树**（视图嵌套表下）| 侧栏 page | **左树** —— CTRL 已有左 rail，要装**两范式**（表+电子表格）+ 仪表盘，表数 >7 顶部 tab 会溢出；飞书「web 导航 spine」是北极星 |
| **视图**住哪 | 左侧栏 | **嵌套在表下**（飞书）| 顶部 tab | **嵌套在表下**（智能表格）；**Univer sheet = 底部 tab 保留原生** |
| AI 入口 | 角落 Omni | NL 伙伴 + AI 字段 | slash Build | **右侧常驻 Irisy 面板 + 视图感知**（Teable docked chat 是精确参照）|

## 3. 推荐 IA — 三区外壳

**A. 左 rail = spine（飞书 web 导航模型）** —— 单棵可折叠树，不是三段扁平：
- 每个 **base/collection** 是顶节点；其下**表 + 电子表格是兄弟叶子，只用图标区分**（网格图标=智能表格，sheet 图标=Univer）——统一一个列表，因为对用户「一个装数据的东西」是一个概念。
- **智能表格**下**视图嵌套**（飞书式，二级共享图标）；**Univer workbook 下不在 rail 嵌 sheet**——让 Univer **自带底部 sheet-tab** 管 sheet 导航（压掉再自绘是跟工具较劲）。→ 干净解决两范式：**表/workbook 在树里统一；视图为智能表格嵌套，sheet-tab 为电子表格留底部**。
- `+` 两级：base 节点（→ 新表 / 新电子表格 / 导入 / **Irisy 建**）+ 表旁（→ 新视图）。
- rail 可折叠（Airtable「让位给数据」）。

**B. 中区 = 工具栏 + 网格** —— 按范式换顶部 chrome，左 rail + 右面板不变：
- **智能表格**：两区工具栏（飞书 split）——**左组 = 视图塑形**（Group · Sort「这个视图怎么显示」）**右组 = 动作**（Hide-fields · Filter · Color · Row-height · Search · Add-record），**跨视图类型顺序一致**，一条 hairline 分隔工具栏与网格。每按钮 = popover、≤2 击、view-scoped。交互规格照抄 **Teable**（Filter→Group→Sort 顺序、递归 AND/OR 可嵌套 filter、多级 group「Add subgroup」）。密集 hairline 网格、灰容器面、颜色仅从 select 字段。
- **Univer 电子表格**：**不自造工具栏**——host Univer 自带 ribbon（`ribbonType:'collapsed'|'simple'` 配 CTRL 密度、`menu` 隐掉不要的命令），`createUniver({theme,darkMode})` 配壳（已做 teal 主题）。

**C. 右 = Irisy 视图感知面板（Teable docked 上下文对话）** —— 常驻可折叠，非独立页：
- Irisy **读当前视图的 filter/sort/group**、在该上下文操作。覆盖 create→edit 全生命周期（打赢 Omni/Notion 只能建）：**Build**（NL→表+字段+关系+建议视图）、**Edit** 现有 schema/数据、**AI 字段捷径**式行内富化（classify/extract/summarize/translate 作字段配置，飞书模型）。
- Irisy 触发的动作经 `registerComponent` + `IMenuButtonItem` 注入 Univer 的 `RibbonStartGroup` —— 助手也能伸进电子表格。

**D. 创建 / 空态** —— 三张 tile：**Blank · Template · Build with Irisy**（趋同建表菜单）。one-shot（一个 `+` 一个菜单，无多步向导）。导入（CSV/Excel）在同一个 `+` 下。

## 4. 切片（dev-loop + 视觉验证）

| 片 | 内容 | 验收 |
|---|---|---|
| **T1 左树 spine** | 三段扁平 → 单棵折叠树；表+电子表格兄弟叶子（图标分）；智能表格视图嵌套；`+` 两级 | 视觉：树形导航、两范式一列、视图嵌套 |
| **T2 两区工具栏** | 智能表格顶部换飞书 split 工具栏（左塑形/右动作），popover 化，Teable 交互规格 | 点每个 popover ≤2 击、view-scoped 生效 |
| **T3 Univer chrome 收敛** | `ribbonType` 调密度、`menu` 隐冗余、避免双 chrome | Univer 面不显得「异质 Office」 |
| **T4 右 Irisy 视图感知** | Irisy 面板读 active view 上下文；Build/Edit 入口 | Irisy 知道「你在看哪个视图/过滤」 |
| **T5 空态三 tile** | Blank / Template / Build with Irisy | 新用户从空到有一张表 one-shot |

## 5. 红线

- **零 bespoke 造轮子**：智能表格网格/视图用既有 `SmartTableViewer`；Univer 面用 Univer 自带 chrome——**只重排外壳（树/工具栏布局），不重写渲染引擎**。
- **one-shot**：任何创建/操作 ≤2 击、无向导（飞书两次点击律 = CTRL 哲学）。
- **plain-text**：表 = vault markdown（frontmatter schema）；电子表格 = `.sheet.md`（Univer snapshot）。vim test 不破。
- **两范式各用对工具**：树里统一，但视图（智能表格）与 sheet-tab（Univer）不强行合并——各归各的原生位。
- 锁点不动：5 primitives / gate / 既有 viewer。

## 6. 顺序
T1（左树，最大观感提升）→ T2（两区工具栏）→ T3（Univer 收敛）→ T4（Irisy 视图感知）→ T5（空态）。每片 Playwright 视觉验证。

## 6.5 多 sheet base 修正（bao 2026-07-03「智能表格应该包括多sheet」）

**根因**：T1 把 base→sheet→view 三层压成一层——每个 smart-table 文件当扁平叶子，缺了「base = 多数据表容器」这层。真正的多维表格（飞书 Bitable）= **base ⊃ 多个数据表(sheets) ⊃ 每表多视图**。而 Univer 那边 `.sheet.md` 已经是多 sheet workbook，反而 smart-table 缺 sheet 层 —— 不对称。

**落地（bao 选：文件夹 = base）**：
- `tables/<base>/<sheet>.md` = base 内的一张数据表(sheet)；`tables/<name>.md` = 扁平单 sheet base（向后兼容）；`tables/<name>.sheet.md` = Univer workbook base。
- lib：`listBases()` 把 `tables/` 归成 base；`createBase()`（建文件夹 + 首表）、`createSheetInBase()`（base 内加数据表）。
- UI：**左树列 bases**（不是 tables）；打开 smart base → `BaseView` 顶部 **sheet tabs**（数据表）+ 当前表的 `SmartTableViewer`（含 T2 视图/工具栏）；`+` 加数据表；Univer base → `UniverSheetViewer`（自带底部 sheet tab）。
- 关联在 base 文件夹内按 path 链接（既有 link/lookup/rollup 复用）。
- 三级导航清晰：**树(base) → 中部 tabs(sheets) → 视图切换(views)**，对齐飞书 + Univer。
- 验收：`tables/crm/`（deals + contacts）打开 → 见 [Deals][Contacts] 顶部 tab，各有自己的视图。tsc + 191 tests + build 绿。

## 7. 一手来源（抄作业的作业本）
- 飞书 Bitable：woshipm 5636346 / 5935411 / 5791246、feishu.cn/product/base、volcengine 7577300984067457034
- Airtable：support.airtable.com tables-overview / views / omni-ai、airtable.com/guides
- Notion：notion.com/help full-page-vs-inline / using-database-views / create-a-database
- Teable：help.teable.ai basic/table·view / toolbar filter·sort·group、teable.ai、github teableio/teable
- Univer：docs.univer.ai preset-sheets-core / features/core / ui/themes
