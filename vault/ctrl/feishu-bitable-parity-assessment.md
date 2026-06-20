# 飞书 Bitable 对标 — 完整功能清单 × CTRL 可实现性评估

> bao 2026-06-20:「对标了飞书吗?有哪些功能清单,哪些可以实现?」本文件 = 穷尽飞书多维表格(Bitable,**不是** Sheets 电子表格)功能,逐条评估 CTRL 在 **plain-text(markdown=truth)** 与 **SQLite(结构化)** 两种数据层下的可实现性 + 开源复用。
> 调研源:飞书官方 API 文档(open.larksuite.com,27 ui_type 逐字核对)+ 第三方正文(sspai/woshipm)+ Teable/undb 源码精读 + glide-data-grid(MIT)能力评估。

---

## 0. 一句话结论(必须 bao 拍的根本决策)

**飞书 Bitable 的灵魂 = 关系型(关联 / Lookup / Rollup / 跨表公式)。调研证明:这一层在纯 markdown 下做不到**(每次关联查询 = 遍历文件树 O(n²) I/O,无事务保证双向同步,无外键导致悬空指针,数万行不可用)。**要真正对标飞书 Bitable,必须引入结构化存储(SQLite)。** 这冲突 CLAUDE.md 钦定的「本地 markdown = truth, vim test」。

→ 两条路线(详见 §4),只有 bao 能选:
- **路线 A(守哲学)**:plain-text 不变 → 只能做「轻量单表智能表格」,关系型用 `[[wikilink]]` 软链,**对标不了 Bitable 的灵魂**。
- **路线 B(SQLite)**:markdown 存 schema/视图(可读)+ SQLite 存行数据/关联/计算 → **真正对标 Bitable**,但 markdown 从 truth 降为「schema 真相 + 数据镜像」。

---

## 1. 字段类型(飞书 27 ui_type)

| 飞书字段 | plain-text 可行 | SQLite 可行 | CTRL 现状 | 开源复用 |
|---|---|---|---|---|
| 文本/多行/数字/单选/多选/日期/复选框 | ✅ | ✅ | ✅ 已做 | — |
| 评分/进度/货币/邮箱/电话/超链接 | ✅(渲染) | ✅ | ✅ 已做(本轮) | glide cell |
| 附件 | ⚠️(指向 vault 文件) | ✅ | ⬜ | glide Image cell |
| 人员/群组/创建人/修改人 | ⚠️(单人弱) | ✅ | ⬜ | — |
| 创建时间/修改时间/自动编号 | ⚠️(需写回) | ✅ | ⬜ | — |
| 地理位置/条码 | ⚠️ | ✅ | ⬜ | glide Custom cell |
| **单向/双向关联** | ❌ 难(无 FK/事务) | ✅ | ⬜ | Teable LinkField |
| **查找引用 Lookup** | ❌ O(n·m) I/O | ✅ SQL JOIN | ⬜ | Teable LookupField |
| **公式**(100+ 函数) | ⚠️ 单行可,跨表难 | ✅ SQL 编译 | ⬜ | ANTLR + Teable |
| 按钮(触发自动化) | ⚠️ | ✅ | ⬜ | — |
| AI 字段捷径 | ✅(经 gate) | ✅ | ✅ 已做(本轮) | — |

## 2. 视图(飞书 6 种 + 视图级属性)

| 飞书视图 | plain-text | SQLite | CTRL 现状 | 开源 |
|---|---|---|---|---|
| 表格 Grid | ✅ | ✅ | 🟡 HTML 表(应换 canvas) | **glide-data-grid** |
| 看板 Kanban(拖拽改值) | ✅ | ✅ | ✅ 已做(本轮) | 自建 |
| 画廊 Gallery | ✅ | ✅ | ✅ 已做(本轮) | 自建 |
| 日历 Calendar | ✅ | ✅ | 🟡 agenda 版 | 自建 |
| 甘特 Gantt | ⚠️ | ✅ | ⬜ | 自建 |
| 表单 Form(对外收集) | ⚠️ | ✅ | ⬜ | 自建 |
| 筛选/排序/**多级分组**/隐藏/冻结/行高 | ✅(视图态) | ✅ | 🟡 单级 | glide freeze/width |

> **网格交互**(键盘导航/框选/复制粘贴/拖拽填充/调列宽行高/数万行虚拟滚动)= 飞书「像 Excel」的关键,CTRL 现在的 HTML 表完全没有。**glide-data-grid(MIT, canvas, 百万行)正好补这块**,且 `getCellContent` 回调天然适配「本地是 truth」。但它只给网格层(~30-40%),看板/日历/行分组/关系字段仍要自建。

## 3. 关系型(灵魂)+ 计算

| 飞书能力 | plain-text | SQLite | 说明 |
|---|---|---|---|
| 单向/双向关联(1:1 / 1:n / n:n) | ❌ | ✅ | SQLite: FK 列 + junction 表 + JSONB 展示值(Teable 范式) |
| Lookup(沿关联取值 + 7 聚合) | ❌ | ✅ | SQL JOIN;plain-text 需 O(n·m) 遍历 + 缓存(易失效) |
| Rollup(SUM/AVG/COUNT/MIN/MAX) | ❌ | ✅ | SQL aggregate |
| 公式(单行) | ⚠️ | ✅ | ANTLR 解析 + 依赖追踪;plain-text 单行可,逐条读 I/O |
| 公式(跨表/条件聚合 SUMIF) | ❌ | ✅ | 需 JOIN |
| 双向同步 | ❌ | ✅ | plain-text 无事务,双侧改易不同步 |

## 4. AI / 自动化 / 仪表盘 / 协作 / API

| 模块 | 飞书 | CTRL 可行性 | 现状 |
|---|---|---|---|
| AI 字段捷径(整列 + 自动更新) | ✅ | ✅(经 :17873 gate,已实现) | ✅ 本轮 |
| AI 问数 / AI 生成仪表盘 | ✅ | ✅(Irisy + gate) | ⬜ |
| 自动化(7 触发器 + 动作) | ✅ | ⚠️ **撞「不做清单」**(确定性多步编排) | ❌ non-goal |
| 仪表盘(50+ 图表) | ✅ | ✅(只读派生 + AI 生成) | ⬜ v1.x |
| 记录详情卡 | ✅ | ✅ | ✅ 本轮 |
| 多级分组 / OR 筛选 | ✅ | ✅ | 🟡 单级 |
| 权限(行/列/视图级) | ✅ | ⚠️ 单人模式弱 | ❌ 多数 non-goal |
| 编辑历史 | ✅ | ✅(git 天然 + UI) | 🟡 |
| 导入(CSV/Excel) | ✅ | ✅ | ✅ 本轮(CSV) |
| 导出 | ✅ | ✅(plain-text 本就是文件) | ✅ |
| Open API / Webhook / 嵌入 | ✅ | ✅(:17873 gate 已是 MCP API) | 🟡 gate 有 |

## 5. 两条路线对比(bao 拍板)

| 维度 | 路线 A:守 plain-text | 路线 B:SQLite + markdown 镜像 |
|---|---|---|
| 哲学 | ✅ 不动「markdown=truth, vim test」 | ⚠️ markdown 降为 schema 真相 + 数据镜像 |
| 关系型(关联/Lookup/Rollup) | ❌ 做不了(用 wikilink 软链替代) | ✅ 真正可做 |
| 公式(跨表) | ❌ | ✅ |
| 数据规模 | ❌ 数千行就卡 | ✅ 数万行+ |
| 网格体验(glide-data-grid) | ✅ 可做(网格层不依赖数据层) | ✅ 可做 |
| 字段类型/视图/AI 列/详情卡 | ✅ 已做大半 | ✅ |
| 对标飞书 Bitable | 「轻量智能表格」,**像 ≠ 是** | 「真·多维表格」 |
| vim test | ✅ 守住 | ⚠️ 数据在 SQLite,vim 只读得到 schema/镜像 md |
| 工作量 | 中(在已有基础上加 glide 网格) | 大(内核加 SQLite 表引擎 + 关系/公式 + Visitor 重构) |

## 6. 推荐(供 bao 参考)

**务实推荐:分两阶段,先 A 后按需 B。**
1. **立刻(路线 A 的增量)**:用 **glide-data-grid 换掉 HTML 表** → 一下拿到「像 Excel/Airtable」的网格体验(键盘/复制粘贴/填充/列宽/数万行滚动)。这步**不碰数据层哲学**,ROI 最高,直接让它「看起来是智能表格」。
2. **再定(路线 B 的决策)**:关系型(关联/Lookup/Rollup)是否做 = 是否引入 SQLite。这是动哲学的大决策,建议单开 ADR-002 §14 amendment 评估「SQLite 作为 vault 的查询索引层(markdown 仍是源)」是否能两全——即 markdown 是 truth,SQLite 是派生索引(类似现有 `vault_index.rs` FTS5 的扩展),关系/Lookup 走索引算,写回 markdown。**这可能是守哲学又能对标的第三条路,需进一步设计验证。**

> 关键开源:**glide-data-grid(MIT,网格层,可直接用)** · Teable/undb(AGPL,只参考关系型/Lookup/公式/Visitor 设计,不搬码)。
