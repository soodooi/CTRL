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
- 不做关系型外键(关联/Lookup/Rollup)—— 用 `[[wikilink]]`+backlink 软关联(plain-text 取舍)。
- 不在本目标内重构 Irisy 架构 / 不动 ADR-005 persona-shell。
- review gate 全系统实装属 ADR-006 §4,不在本切片(produce 暂随 `vault::write`)。

## 进展日志 (Progress log — append-only)

- 2026-06-20 **目标替换**(原 Irisy 回复正确性测试 → §14 统一操作接口 feature 实装)。理由:bao 连续多轮指挥从「智能表格对标飞书」→「§14 修改架构」→「按架构全量做」,独立 reviewer 复审指出 GOAL.md 旧了。当前状态:`feat/unified-query` 11 commit、kernel 180 测试绿、reviewer PASS、ADR 对齐。下一步 = PR + PWA 前端消费(SC8)。
- 2026-06-21 **对标基线校准 (bao 钦定): 智能表格前端先对标 Grist (getgrist.com) 做功能一致, 再叠加飞书 Bitable 的 AI 智能表格能力。** 现状盘点 (真实代码 + `/table-lab` 视觉验证): 字段类型 25 种、8 视图 (Grid 已用 glide-data-grid)、filter/sort/group/隐藏/冻结/密度、AI 列、link/lookup/rollup/formula、条件格式、CSV 导入 —— route A 基本做完, `feishu-bitable-parity-assessment.md` 已过时。
  - **Grist 对标差距** (按 Grist 灵魂排序): ① Creator Panel 右侧三栏配置面板 ② Linked widgets / "Select By" 一页多 widget 联动 ③ Summary tables 作数据源 ④ Reference display-column + `$Ref.Field` 解引用 ⑤ trigger formula ⑥ 列宽/行高/换行 ⑦ DateTime/Integer 类型。Access rules / Raw data 多为 non-goal (单人)。
  - **增量 1 已落地** (working tree, 未提交): **Creator Panel 三栏布局** —— `SmartTableView` return 重构成 `tableShell > [tableMain, creatorPanel]`, 点列头/+Field 在常驻右面板配置该列 (复用 `SmartTableFieldEditor`, 不重造), 面板可折叠。tsc 绿 + vitest 136 绿 + `/table-lab` 视觉验证 + code-reviewer PASS。验证工具发现: `/table-lab` 路由能 headless 渲染智能表格 (不依赖 kernel), 是后续视觉验证入口 (浏览器 dev 模式连不上 :17872 WS bridge — 需 token, 只 Tauri invoke 可得)。
  - **下一步**: 增量 2 = Creator Panel 加 "Table" tab (把 filter/sort/group/fields 弹出菜单收进面板) + 面板内字段编辑器竖向排版打磨; 之后按差距清单推进 (DateTime 类型 / 列宽行高 / Reference 显示列)。
