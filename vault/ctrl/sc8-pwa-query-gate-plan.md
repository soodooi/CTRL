# SC8 — PWA 经 :17873 query gate 消费(规划)

> GOAL.md SC8。把内核统一 query 引擎(ADR-002 §14 `run_query` over `QuerySource`)接到 PWA,
> 让 filter/sort/group 走内核一套引擎(Irisy + PWA + 外部 brain 同一接口),`describe` 驱动字段/算子(防幻觉)。

## 现状(已在 main)

- 内核 `kernel/query.rs`:`QuerySource` trait(`describe()` + `rows()` + `query()`)+ 共享 `run_query`(校验→filter→sort→group→limit,AND 语义,单 `group_by`)。
- `vault_smart_table::SmartTable` impl `QuerySource`。
- MCP gate(`mcp_server.rs` :17873):`smart_table.describe` / `.query` / `.update_cell` / `.append_row` / `.add_view` / `.run_ai_column*` —— **给外部 brain(Claude Code 等)**。
- PWA 现状:`SmartTableViewer` 直读 vault(`vault_read`)→ `smartTableFromParts` → **TS 端 `queryTable`(`smart-table-query.ts`)客户端查询**。TS 引擎支持 OR + 多级 group(比内核 `run_query` 多)。
- 唯一已暴露的 smart_table tauri command = `smart_table_run_ai_column`。

## 差距

PWA 跑的是 **独立的 TS 查询引擎**,不是内核 `run_query`。§14 要一套引擎。但内核 `QueryRequest` 只有 AND + 单 group,PWA 有 OR + 多级 group —— 直接路由会回退我刚建的特性。

## 切片计划(每片单独 PR + review)

### Slice 1(本 PR)——gate 读接口到达 PWA(地基,零回退)
1. tauri command `smart_table_describe(path) -> Describe`(`commands/vault.rs`,镜像 MCP handler)。
2. tauri command `smart_table_query(path, request) -> QueryResult`。
3. `commands/mod.rs` invoke_handler 注册两者。
4. `kernel.ts`:`describeSmartTable(path)` / `querySmartTable(path, request)` + 类型。
5. 验证:cargo build + 内核 describe/query 命令单测;TS 绑定 mock-invoke 单测。
6. **不动 UI 查询路径**(不回退 OR/多级 group);UI 消费留 slice 2。

### Slice 2(下一 PR)——UI 消费 + 引擎对齐
- 内核 `QueryRequest` 加 `conjunction: And|Or`(default And)+ OR filter 分支;`group_by` 保持 `Option`(PWA 第二级 group 暂客户端)。更新 MCP 工具 + 测试(加字段带 default,向后兼容)。
- `SmartTableView` 用 `describe` 驱动 filter 字段 + 算子下拉(替换硬编码 `OPERATORS_BY_TYPE`/`typeOf`),内核不在时优雅降级到 TS map(local-first:云/内核不在仍可用)。
- 把结构化查询结果集走内核 `smart_table_query`(异步 + loading 态),search/第二级 group/density 留作 view-only 客户端糖。

### Slice 3(可选)——produce 经 gate
- `update_cell` / `append_row` 也走 gate command(目前 PWA 直写 vault)。等 ADR-006 §4 review gate。

## 红线

- 不回退 #123 已建特性(OR/多级 group/8 视图)。
- local-first:内核不在 → 降级客户端查询,不 hard fail。
- 全英文代码、plain-text round-trip、push 前 pre-push 绿。
