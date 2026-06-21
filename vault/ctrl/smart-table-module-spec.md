# 智能表格 module — 边界图 + 完成判据(真相源)

> 目的:把"无休止逐个加功能"收敛成"一个有边界、有刻度、可升级的模块"。
> 进度从此对着本清单读,不再开放式扩张。bao 拥有本文件。
> 关联:`project-ctrl-modular-intent-platform`(每个能力 = 可安装 module)、
> `architecture-byo-cli-driver.md`(§14 三动词)、`sc8-pwa-query-gate-plan.md`。

---

## 0. 一句话定位

智能表格 = CTRL 的**第一个 content-type module**:声明处理「frontmatter 带 `schema:` 的 `.md`」,
注册自己的 viewer(8 视图)+ 内核 `QuerySource` + 一组 `:17873` gate 工具。
对标飞书多维表格的「数据 + 视图 + 派生」面,**不**做协作/自动化/重权限(CTRL non-goal)。

模块化平台承诺:它该是「注册表里的一项」,intent 唤起时才 render,scale 活在注册表不在 shell。

---

## 1. 模块边界(拥有 / 不拥有)

**拥有(module 内）**
- 数据格式:`.md` + YAML frontmatter `schema:` + pipe-table body(plain-text=truth,vim test)。
- viewer 注册:by content-type(`schema:` 存在)→ SmartTableViewer。
- 内核 `QuerySource` 实现:`vault_smart_table::SmartTable`。
- gate 工具(6 动词,见 §3)。
- 派生计算:公式引擎、关联/Lookup/Rollup、聚合、图表/时间轴布局(全前端纯函数,只读派生)。

**不拥有(平台 / 别处)**
- viewer registry 机制本身(平台层)。
- `:17873` gate(kernel,平台层;module 只注册工具)。
- LLM provider(provider router;AI 列只是调用方)。
- 多 content-type 路由(平台 intent 层)。
- 同步/mesh/keychain(substrate)。

---

## 2. 完成判据清单(= 进度刻度)

口径 A = 飞书「数据 CRUD + 视图 + 派生」核心面。口径 B = 含协作/自动化/权限的全功能。

### ✅ 已完成(可验证:tsc + vitest + Playwright 实拍)
| 能力 | 判据 |
|---|---|
| 24 字段类型 | text/multiline/number/currency/rating/progress/date/checkbox/tags/select/url/email/phone/link/lookup/rollup/formula/attachment/user/percent/duration/auto_number/created_at/modified_at |
| 8 视图 | grid/kanban/gallery/calendar/form/summary/chart/timeline,ViewKind round-trip 对称 |
| 查询 | 筛选(AND/OR)+ 多级排序 + 多级分组 + 搜索;**走内核统一引擎**(SC8) |
| 条件格式 | 每列 color 规则,frontmatter flat round-trip |
| 行操作 | 拖拽排序 / 复制 / 批删 / 字段显隐 / 密度 / 冻结列 |
| 关系 | link / Lookup / Rollup(基于 `id` 行身份) |
| 派生 | 公式引擎(自写 parser)、AI 列(同步+异步 job) |
| 入口 | 模板(5)、CSV 导入、记录卡 |
| §14 | describe/query/produce 三动词;PWA+Irisy+外部 brain 一套引擎 |

**口径 A ≈ 85–90%。**

### ⬜ 未做(明确范围内、但暂缓)
- 编辑历史 UI(git 天然,缺 UI 投影)。
- attachment 真实上传(现仅存路径)。
- 视图配置持久化到 frontmatter(filters/density/隐藏字段;现 view-local)。
- describe 驱动 UI 下拉(现硬编码 `OPERATORS_BY_TYPE`;SC8 slice 2a)。

### 🚫 Non-goal(CTRL 有意不做)
- 自动化触发器/动作(撞「不做清单」,Coze/n8n 已做)。
- 行/列/视图级权限(单人模式弱)。
- 实时协同光标/OT。
- Open API / webhook 对外(gate 已是 MCP API,不再造第二套)。

**口径 B ≈ 60%,但缺口大半是 non-goal。**

---

## 3. 内核契约(升级靠它不变 —— 稳定接口)

ADR-002 §14 三动词,这是「后续如何升级」的答案:**契约稳,上面随便加/换**。

- `describe` → 类型层(fields/types/operators),防幻觉。
- `query` → 读(并行,`run_query`:校验→filter[and/or]→sort→group[多级]→limit)。
- `produce` → 写(update_cell / append_row / add_view / run_ai_column),串行,未来过 review gate(ADR-006 §4)。

`QuerySource` trait 实现者:`SmartTable` ✅、`NotesSource` ✅;registry/provider 直接用 `run_query`。
**新 content-type 实现 `QuerySource` 即免费获得统一 query + Irisy 可操作。**

`id` 行身份(每行稳定 nanoid,系统列,round-trip):关联/Lookup/Rollup + 内核↔PWA 行映射的地基。

---

## 4. 架构现状与债

- **数据/内核层:完整自洽**。plain-text=truth、一套引擎、三动词、id 身份。干净,可作为别的 content-type module 的模板。
- **UI 层:有债**。`SmartTableView.tsx` **1177 行**= 上帝组件(query bar + 8 视图调度 + 字段编辑器 + 记录卡 + 内核路由)。是"架构不完整"的可闻信号。
  - 收敛目标:拆成 `<QueryBar>` / `<ViewSwitch>` / `<FieldEditor>` / `<RecordCard>` / `useTableQuery()` hook(内核路由+降级),View 主组件只做编排。
- **module 化债**:现在是"内联在 viewer registry 的一坨",没有 manifest 边界。收成 module = 一个声明(content-type + viewer + QuerySource + tools)。

---

## 5. 升级路径(两个维度)

1. **功能升级(模块内)**:新字段类型 = `CellType` union + `baseCellType` + grid 渲染分支 + 内核 `CellType::parse` 镜像;新视图 = `ViewKind` + 注册 + 渲染。都是注册表加项,不动 shell。
2. **上游跟随**:借鉴源 Grist(Apache 2.0)+ provenance 机制已建。真正可升级性来自**内核三动词契约稳定 + 视图插件式**——底座不变,借鉴/替换上层实现不影响调用方。

---

## 6. 收敛 roadmap(从"功能堆"到"一个 module")

1. **本文件**(边界图 + 判据)— 进度有刻度,停止开放式扩张。← 现在
2. UI 收敛重构:SmartTableView 1177 行拆分(见 §4)。
3. 正式 module 化:抽出 manifest 声明(content-type + viewer + QuerySource + tools),让它在注册表里是清晰一项。
4. 收尾未做项里值得的(视图持久化 / describe 驱动 UI),其余按 ⬜/🚫 冻结。
5. 合并 #123 + SC8 → main。

> 判据:当「智能表格」能作为注册表中一个可声明、可装卸的 content-type module 被 intent 唤起,
> 且 UI 无上帝组件、内核契约文档化——则本模块「架构完整」。当前卡在第 2-3 步。
