# CTRL — 当前开发目标 (single active goal)

> 唯一在跑的目标,锚定所有工作。由 `goal` skill 管理。
> Plain markdown,local 是 truth,bao 拥有这个文件。

## Status: ACTIVE

## 目标 (Goal)

**落地 §14 统一操作接口 (Unified Operation Interface) + 智能表格,并接到 PWA 前端。**

bao 连续多轮指挥,从「智能表格(对标飞书多维表格)」演进出一条架构主线(ADR-002 substrate §14):
**所有 content-type 功能点(md / html / 智能表格 / pdf / 连接器 / 笔记 / 注册表)经 :17873 gate 用一个统一接口 `describe` / `query` / `produce` 操作**——`query`(读,并行,kernel service over `QuerySource`)/ `produce`(写,串行,过 review gate)/ `describe`(类型层=语义层,防幻觉)。读≠写(GraphQL/Plan9/agentic-AI 三方证据)。smart-table = 首个实现,KB/registry/provider 跟进,Irisy 用同一套方式操作任何源,新功能包实现 `QuerySource` 即免费可用。

governing ADR = **ADR-002 substrate §14**(v29)+ **ADR-003 frontend §6.5**(v16)。事实源 = `vault/ctrl/research-ai-data-platforms.md` + `research-unified-operation-interface.md` + `research-feishu-bitable.md`。

(原目标「Irisy 回复正确性测试覆盖 SC1-13」已被本 §14 feature 线取代 —— 那条线的角色是「我建测试」,本线 bao 改为「按架构全量做」feature 实装;独立 checker 复审时指出 GOAL.md 旧了,故此替换。Irisy 测试矩阵 `irisy-test-matrix.md` 保留备查。)

## 成功标准 (Success criteria — 可验证)

**已达成(分支 `feat/unified-query`,11 commit,kernel 180 测试绿,code-reviewer PASS)**
1. ✅ `kernel/query.rs`:`QuerySource` trait + 共享 `run_query`(类型感知 filter/sort/group + 未知字段拒绝防幻觉)。
2. ✅ 4 个 RecordSource 全走同一契约:smart-table / KB(`notes.*`)/ mcp registry(`registry.*`)/ provider catalogue(`providers.*`)。
3. ✅ smart-table 完整 produce 面:`describe` `query` `update_cell` `append_row` `add_view` + `run_ai_column`(同步 + 异步 job 三件套 start/status/cancel)。
4. ✅ `complete_row` provider drain 用 fake Provider 测通(闭合 reviewer「真实路径仅 compile 证明」缺口)。
5. ✅ smart-table schema 真实 `vault::read`/`write` YAML round-trip(修了单测掩盖的 on-disk bug)。
6. ✅ ADR-002 §14 + ADR-003 §6.5(v16)与实装对齐(diverge 项 honestly 标注)。

**进行中 / 下一步**
7. PR 合 `feat/unified-query` → main(squash)。
8. **PWA 前端消费 query gate 工具**:`ctrl-web` 渲染 `query` 结果(filter/sort/group UI)+ describe 驱动的字段/算子 + AI 列(`run_ai_column` start→poll status→展示)动作。这是 §14 从「内核 gate 工具」到「用户能用」的最后一段。
9. (可选,deferred,已在 ADR 记录)Semaphore 并发 / `row_id` 行身份原语 / produce review gate(ADR-006 §4)。

## 非目标 / 范围外 (Non-goals)

- 不做可视化 workflow editor(撞「不做清单」;确定性多步编排是 §6.5.6 的 A/B/C 待 bao 拍)。
- ~~不做关系型外键(关联/Lookup/Rollup)~~ **(SUPERSEDED 2026-06-21: 走路线 C / ADR-002 §14 v30 做真关系型 —— SQLite 派生索引算 Reference/Lookup/Rollup, 计算列 query-time 派生、绝不写回 markdown, vim test 守住, plain-text 取舍化解。已落地 Slice 4a 引擎 + 4b 类型层。)**
- 不在本目标内重构 Irisy 架构 / 不动 ADR-005 persona-shell。
- review gate 全系统实装属 ADR-006 §4,不在本切片(produce 暂随 `vault::write`)。

## 进展日志 (Progress log — append-only)

- 2026-06-20 **目标替换**(原 Irisy 回复正确性测试 → §14 统一操作接口 feature 实装)。理由:bao 连续多轮指挥从「智能表格对标飞书」→「§14 修改架构」→「按架构全量做」,独立 reviewer 复审指出 GOAL.md 旧了。当前状态:`feat/unified-query` 11 commit、kernel 180 测试绿、reviewer PASS、ADR 对齐。下一步 = PR + PWA 前端消费(SC8)。
- 2026-06-21 **对标基线校准 (bao 钦定): 智能表格前端先对标 Grist (getgrist.com) 做功能一致, 再叠加飞书 Bitable 的 AI 智能表格能力。** 现状盘点 (真实代码 + `/table-lab` 视觉验证): 字段类型 25 种、8 视图 (Grid 已用 glide-data-grid)、filter/sort/group/隐藏/冻结/密度、AI 列、link/lookup/rollup/formula、条件格式、CSV 导入 —— route A 基本做完, `feishu-bitable-parity-assessment.md` 已过时。
  - **Grist 对标差距** (按 Grist 灵魂排序): ① Creator Panel 右侧三栏配置面板 ② Linked widgets / "Select By" 一页多 widget 联动 ③ Summary tables 作数据源 ④ Reference display-column + `$Ref.Field` 解引用 ⑤ trigger formula ⑥ 列宽/行高/换行 ⑦ DateTime/Integer 类型。Access rules / Raw data 多为 non-goal (单人)。
  - **增量 1 已落地** (working tree, 未提交): **Creator Panel 三栏布局** —— `SmartTableView` return 重构成 `tableShell > [tableMain, creatorPanel]`, 点列头/+Field 在常驻右面板配置该列 (复用 `SmartTableFieldEditor`, 不重造), 面板可折叠。tsc 绿 + vitest 136 绿 + `/table-lab` 视觉验证 + code-reviewer PASS。验证工具发现: `/table-lab` 路由能 headless 渲染智能表格 (不依赖 kernel), 是后续视觉验证入口 (浏览器 dev 模式连不上 :17872 WS bridge — 需 token, 只 Tauri invoke 可得)。
  - **下一步**: 增量 2 = Creator Panel 加 "Table" tab (把 filter/sort/group/fields 弹出菜单收进面板) + 面板内字段编辑器竖向排版打磨; 之后按差距清单推进 (DateTime 类型 / 列宽行高 / Reference 显示列)。
- 2026-06-21 **整体规划 + 路线确认 + 两轨并行推进** (bao「不要一个一个, 整体架构想清楚」+「两轨并行」)。整体规划图落 `smart-table-grist-parity-plan.md` (对标 Grist 主 + 飞书 AI 叠加, 三轨, 逐项进度)。**数据层路线确认 = 第三条 SQLite 派生索引** (bao 2026-06-21 reconfirm; 早在 ADR-002 §14 v30 已锁, 零 churn)。Track 2 完整实现设计落 `smart-table-relational-index-design.md` (5 切片 + DDL + index-backed RecordSource + 关系字段计算 + vim test 守护)。分支 `feat/smart-table-grist-parity` 已累积:
  - `66ca041` 轨1增量1: Creator Panel 三栏布局。
  - `728c469` 轨1增量2: filter/sort/group/fields 收进 Creator Panel 双 tab (Table/Column), 查询栏清爽。
  - `d8a7c50` **轨2 Slice 1**: kernel `smart_table_index.rs` SQLite 派生索引 store (st_tables/st_rows/st_cells EAV + value_num/value_date 派生列 + reindex_table/remove_table/is_fresh), 仿 vault_index.rs 教条, markdown 永远 truth, 纯附加零行为改动。cargo test 5/5 + 全量 kernel 绿 + checker PASS。
  - 全部三块均 tsc/cargo + 测试 + 视觉(前端)/单测(kernel) + 独立 code-reviewer PASS。
  - `4307045` **轨2 Slice 2**: `query_indexed` index-backed query —— number(gt/lt/gte/lte)/date(比较) 在 AND 下推 SQL 剪枝 + 同一个 run_query 权威过滤, **parity 不变式** (13-case 矩阵测 index 路径 ≡ 内存 run_query 字节级一致, 含未知字段拒绝)。number eq/date within/OR 故意不下推。参数绑定无注入。cargo 7/7 + checker PASS。
  - `cd59b4e` **轨2 Slice 3**: 索引接进 :17873 gate —— `SmartTable::query_via_index` (大表>500行走 index, 小表/无索引/任何索引错误降级 run_query) + `reindex_into` 写穿透 (produce 写 markdown 后刷新) + router st_index best-effort 打开。**markdown 永远赢**: 读时 content-hash freshness 检查 + 陈旧懒重建 + 故障降级; 异步 AI job/外部 vim 编辑靠读时 hash 漂移自愈。cargo 13/13 (vault_smart_table) + 全量 kernel 绿 + checker PASS。(注: 真实 :17873 curl smoke 待重建 app; handler 是已测 query_via_index 的薄接线。)
  - **轨2 索引地基完成 (Slice 1-3/5)**: store + index-backed query (parity) + gate 接线。
  - `0f4423d` **轨2 Slice 4a**: 关系引擎核心 (跨表 JOIN) —— st_refs 边表 + `index_references` (解析 link token, 按目标 display 字段解析 dst_row_id, 匹配不到=dangling NULL) + `compute_lookup` (沿边取目标字段, 多目标拼接, 跳 dangling) + `compute_rollup` (count/sum/avg/min/max over 关联 value_num)。**纯派生只读, 不写 markdown** (守 vim test)。dangling 目标重现可重解析 un-dangle。reindex 删 outgoing 边 + remove 级联 + incoming 置 NULL。SQL 全参数绑定。cargo 10/10 确定性绿 (顺手修了 fresh_index 并行 temp-path 碰撞) + checker 核验生产逻辑 PASS。
  - **轨2 Slice 4b** (committed next): 关系字段类型层 + 写保护 —— frontmatter 解析 reference(table/display)/lookup(via/target)/rollup(via/target/fn) 进 `SmartTable.relations` (对象 + inline flow 两形态), 计算列同时进 fields (可 filter/sort) 和 relations; `smart_table.describe` 广告 relations (Irisy 理解计算列); `is_read_only_field` + update_cell 拒绝写只读计算列 (reference 可写)。cargo 15/15 + checker PASS。
  - **轨2 Slice 4c** (一次性完成push): 查询时注入计算列值 —— `lookup_by_via`/`rollup_by_via` (复用 4a per-row compute + 按 via 单元格值重键, rollup 无重复计数) + `augment_relations` 跨表编排 (索引 source + 每个 Reference 目标表 + index_references, 按 row[via] 注入 lookup/rollup)。vault-backed e2e 测 (deals→contacts 注入 c_email/c_total 全通)。**纯派生不写 markdown**。
  - **轨2 Slice 5** (一次性完成push): 跨表 formula —— `RelationKind::Formula` + 小型安全算术求值器 `eval_formula` (+ - * / () + {field}/bare 引用, 除零/未知字段/解析失败→空白非错误数字, 无任意 eval, 递归下降优先级正确)。augment 在 lookup/rollup 后注入 formula (可引用计算列, e2e 测 half=c_total/2)。is_read_only 含 Formula。
  - **轨2 关系型灵魂 = 完成** (Slice 1-5): store → index-backed query (parity) → gate 接线 → 关系引擎 (Reference/Lookup/Rollup) → 类型层+写保护 → 值注入 → formula。Reference/Lookup/Rollup/Formula 经 :17873 gate 端到端可用, vault-backed 集成测验证, 全程纯派生守 vim test。checker PASS。
  - **轨1 = 4 项完成** (并行 agent): DateTime + Integer 列类型 / 多列 sort (SortKey[] + Creator Panel 有序排序键 UI) / 行高+文本换行 (Wrap text 开关 + glide allowWrapping)。tsc 绿 + vitest (smart-table 全绿) + table-lab 视觉验证。
  - **剩余诚实缺口**: 真实 :17873 curl smoke 未跑 (需重建运行中 app); kernel gate 逻辑由 vault-backed e2e 充分覆盖。前端关系字段的 frontmatter 写入对齐 (ctrl-web 当前客户端自算 relations, kernel 路径独立) 可后续统一。
- 2026-06-22 **协议探索旁支 → 回归主线 (bao「最初目标是不是被遗忘了,重新规划」)。** 本 session 偏离主目标做了一整轮通讯协议探索 (zeus 通讯协议角色), **零产品代码**。诚实定性: 是旁支, 但有沉淀价值, 成果归位、不再继续吃产品时间:
  - **ADR-010 communication** (新 module, 7→8, INDEX/PROCESS 已更新): CTRL 通讯总纲 = **统一窄腰 (§14 契约 + :17873 gate 治理 + MCP 插件) + 多元传输**; 8 缝传输选型; 质疑「一个框架统吃」(narrow-waist/CORBA-SOAP-ESB 教训)。**巩固了 §14 = 窄腰契约的地位** (正是本主目标要接前端的东西)。
  - **§14 开源战略研究 = 否定结论** (`protocol-opensource-strategy.md` + `research-protocol-2026.md`): §14 **不开源成标准** —— 想占的层 (agent↔数据操作 + 读写分离 + 写治理 + 语义层 + local-first) 2026 已被 MCP + GraphQL + Cube 语义层 + AI-governance 框架 + Obsidian-MCP 生态填满 (Apollo MCP Server 已做 mutation-需批准, Fast.io 已做风险分级治理, rodneydyer 已做 local-first MCP for PKM)。§14 无维度独特到拉起标准影响力。**§14 留作内部架构; CTRL 护城河 = 产品 (普通用户 local-first AI 平台 + 能力市场), 不是协议。** 要影响力则做 MCP 生态最佳 local-first 公民 (好想法作 MCP extension 贡献回去, 官方有 extension 机制)。
  - **协议校准沉淀** (ADR-010 Roadmap, 不阻塞主线): ACP 有据采用 (驱动 BYO-CLI, 阶段5) / ST-SS 向 AG-UI event 词汇对齐 (设计原则) / mesh 跟踪 Beelay-Keyhive (Automerge 官方下一代 E2EE+capability sync) / MCP 2026 增量 (MCP Apps sandboxed-iframe UI · Streamable HTTP Mcp-Method/Name headers 利好 gate)。
  - **重新锚定 (主目标 + Status 不变)**: 回 §14 + 智能表格 + 接 PWA 前端。**下一步 = SC8** (前端消费 §14 query gate: filter/sort/group UI + describe 驱动字段/算子 + AI 列 start→poll→展示) + 轨1 Grist parity 续 + 轨2 关系型索引续。协议探索期间撞 session 用量上限 (reset 4:10am PT), deep-research 后两轮 (§14 独特性/商业护城河) 未跑完, 但单线 WebSearch 已取得否定结论的关键证据。
- 2026-06-22 **全局规划落地 (bao「重新规划目标/竞品/远景/市场,把控全局」)。** 新建 `vault/ctrl/master-plan.md` = 全局把控真相源:远景 (普通用户 local-first 通用 AI 平台,卖 substrate 不卖模型) + 市场竞品定位 (CTRL 真空位 = 把 MCP 生态整合成普通用户平台,在产品层不在协议层) + **目标分层** (近期=本目标 SC8/智能表格 beachhead · 中期=能力市场+gate 治理 · 远景=能力生态) + 全局路线图 + 开发纪律。**目标调整结论: 主目标不改 (SC8 仍是正确近期 beachhead), 只抬进分层大图。** 读 GOAL=当前活跃目标, 读 master-plan=全局地图。接下来: 回 SC8 开发。
- 2026-06-22 **目标审查 (bao「目标和研究一致吗?会不会过时了?符合实际、能落地、循序渐进」)。结论: 架构方向没过时, 但进度记录严重过时——SC8 不是「下一步未做」, 而是已大部分落地。** git 实证: `9016c05 feat(sc8): unified query gate to PWA (#124)` (改 8 个前端文件: kernel.ts +82 / smart-table-gate-bridge / modules/smart-table +52 / viewer-registry) + `9426425 fix(sc8): grouping` + `728c469 Creator Panel filter/sort/group`; 前端代码已有 describe 驱动字段/算子 (`smart-table-query.ts` mirror kernel describe verb)、query gate 消费 (`useTableQuery.ts`)、AI 列 invoke (`kernel.ts:269 smart_table_run_ai_column`)。**研究与目标一致** (ADR-010 巩固 §14=窄腰契约; master-plan 定位智能表格=近期 beachhead; §14 不开源不影响内部落地)——所以**主目标方向不改**, 只是上面的「成功标准 7/8」状态过时, 以本 log 为准。
  - **真正的下一步 (符合实际/循序渐进)**: ① 验证并提交 working tree 未提交的 SC8+轨1 前端进展 (`git status` 有大量 modified: SmartTableCells/FieldEditor/Grid/View/useTableQuery 等); ② 走 dev-loop 确认 SC8 三块完成度 (tsc/vitest/table-lab 视觉) + 补 AI 列 poll-status 三件套展示若缺; ③ SC8 收尾后再二选一: 轨1 Grist parity 剩余差距 (Linked widgets/Summary tables/Reference 显示列) **vs** 进中期能力市场 (master-plan, 先拍 4 个 gate 决策)。不再「以为 SC8 没做而重起炉灶」。
- 2026-06-22 **下一阶段序列确定 (bao「1/2/3 都要做」)。验证坐实近期达成: typecheck EXIT=0 + smart-table 11 文件 67 测试全绿 (§14 query 15 / SC8 gate-bridge 4 / gate 消费 3 / 轨2 formula 6)。** bao 确认三方向都做——但守「一次一活跃目标」, 排成循序渐进序列 (beachhead 先扎实再扩平台):
  - **当前活跃 (最小, 先坐实达成)**: 闭合 SC8 验证缺口 = 真机 `:17873` smoke + `/table-lab` 视觉 e2e + 提交未交的 vault 文档 (master-plan/dev-playbook/mcp-capability-marketplace/protocol-research-summary)。
  - **阶段 B (智能表格 beachhead 完整化)**: 轨1 Grist parity 剩余 (Linked widgets / Summary tables / Reference 显示列) + 飞书 Bitable AI 智能表格叠加。
  - **阶段 C (从能力到平台)**: 中期能力市场 + gate 治理 (先拍 mcp-capability-marketplace 的 4 个 gate 决策 → 7 切片)。
  - 执行用 dev-playbook: 每阶段切 spec → 并行 subagent 实施 → code-reviewer 验证 → dev-loop commit。**开工前先 git/grep 核实真实状态 (本次教训: GOAL 进度会过时)。**
