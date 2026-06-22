# 智能表格关系型灵魂 — SQLite 派生索引实现设计 (Track 2 governing)

> 归属: ADR-002 §14 v30 路线 C (SQLite 派生索引, markdown 仍 truth)。ADR-003 §6.5 companion。**不是**新 spine primitive (5 锁) —— kernel service + index store, 挂 Capability primitive 下。
> 状态: 待实施设计, 已切片可 `cargo test` 逐片验证。基于真实代码勘察 (kernel agent, 2026-06-21)。

## 0. 沿用的既有模式 (不重造)

| 要复制的模式 | 来源 (file:line) |
|---|---|
| `Connection` + `Mutex`, `open` 时 `ensure_schema`, 建父目录, `IndexError` 枚举 (Io/Db/Poisoned), `default_index_path() → ~/.ctrl/state/*.db` | `vault_index.rs:40-84,191-199,28-36` |
| 派生存储教条: vault 文件是 truth, db 可重建, db 可 `sqlite3` 直查 | `vault_index.rs:1-19` |
| `mtime_ms` + `content_hash` 陈旧门控跳过无操作, `cached_meta()` | `vault_embeddings.rs:89-103,149-163,251-261` |
| `INSERT ... ON CONFLICT DO UPDATE` upsert | `vault_embeddings.rs:127-137` |
| watch → 相对路径, 跳过 `.ctrl/`/`.git/`, 环形缓冲前端轮询 | `vault_watch.rs:136-173,111-134` |
| `QuerySource` trait (describe/rows/query), `run_query` filter→sort→group→limit, `FieldSpec`/`CellType`/`Operator` 固定枚举 | `query.rs:175-277,36-148` |
| `SmartTable::{parse,serialize_body,append_row,update_cell}`, pipe 转义 round-trip, 双形态 schema parse | `vault_smart_table.rs:20-83,264-289` |
| produce 路径 = read-fresh → mutate → `serialize_body` → `vault::write`, 每路径 `vault_write_lock`; AI 列 merge-by-snapshot (行身份=行快照非位置 index) | `mcp_server.rs:563-608,700-713`; `ai_column.rs:145` |

**不可破坏的硬契约**: `query.rs` QuerySource 语义、`smart_table.*` gate 工具 wire 形状、markdown round-trip、vim test。索引**纯附加且可选** —— 每个读路径在索引缺失/陈旧/markdown 丢失时降级到现有内存 `run_query`。

## A. SQLite 索引 schema

**决策: 一个共享 db, 按表文件路径 keying 的通用长表 (EAV) + 类型化值旁列 + 关联 junction。** 拒绝「每表一张物理 SQLite 表」(用户自定义可变 schema → 运行时 DDL/迁移脆弱/表爆炸); FTS5/embeddings 先例就是「一 db、一逻辑表按 path keying」。

新文件 `src-tauri/src/kernel/smart_table_index.rs`, 新 db `~/.ctrl/state/smart-table-index.db`。

```sql
CREATE TABLE IF NOT EXISTS st_tables (
    table_id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, title TEXT,
    schema_json TEXT NOT NULL, mtime_ms INTEGER NOT NULL,
    content_hash TEXT NOT NULL, indexed_at_ms INTEGER NOT NULL );
CREATE TABLE IF NOT EXISTS st_rows (
    table_id TEXT NOT NULL, row_id TEXT NOT NULL, row_ord INTEGER NOT NULL,
    PRIMARY KEY (table_id, row_id) );
CREATE INDEX IF NOT EXISTS st_rows_ord ON st_rows(table_id, row_ord);
CREATE TABLE IF NOT EXISTS st_cells (
    table_id TEXT NOT NULL, row_id TEXT NOT NULL, field_key TEXT NOT NULL,
    value_text TEXT NOT NULL DEFAULT '', value_num REAL, value_date TEXT,
    PRIMARY KEY (table_id, row_id, field_key) );
CREATE INDEX IF NOT EXISTS st_cells_field ON st_cells(table_id, field_key);
CREATE INDEX IF NOT EXISTS st_cells_num ON st_cells(table_id, field_key, value_num);
CREATE INDEX IF NOT EXISTS st_cells_date ON st_cells(table_id, field_key, value_date);
CREATE TABLE IF NOT EXISTS st_refs (
    src_table_id TEXT NOT NULL, src_row_id TEXT NOT NULL, src_field TEXT NOT NULL,
    dst_table_id TEXT NOT NULL, dst_row_id TEXT, dst_raw TEXT NOT NULL,
    PRIMARY KEY (src_table_id, src_row_id, src_field, dst_raw) );
CREATE INDEX IF NOT EXISTS st_refs_dst ON st_refs(dst_table_id, dst_row_id);
CREATE INDEX IF NOT EXISTS st_refs_src ON st_refs(src_table_id, src_row_id, src_field);
```

- `value_text` = 原始 markdown 单元格 (truth 形状, vim 一致); `value_num`/`value_date` = **派生**类型投影, 给快速 SQL filter/sort。
- Reference 存 `st_refs` junction (一个 link 单元格可多目标 + 双向, FK 列做不到); 单元格 `value_text` 仍是人写 truth (`[[contacts/acme]], [[contacts/beta]]`), `st_refs` 是解析后可解析的派生。
- **行身份 `row_id`** = `blake3(table_id || canonical_row_text)[..16]` (schema 序 tab-join 原始单元格), 重复内容行加 occurrence 计数器。关系靠**用户写的 link token** 在索引时解析, 不靠 `row_id`; 写回用 merge-by-snapshot (既有 `ai_column` 模式)。`dst_row_id` 解析不到 = NULL (dangling)。

## B. 重建/同步策略

- **写时穿透 (produce, 同步, 权威)**: 每个 `smart_table.*` produce 在 `vault::write` 成功后, 同一临界区内调 `index.reindex_table(path,&table)`。**markdown 先写; 索引更新失败则 log + 标陈旧 —— markdown 已赢。**
- **外部编辑 (vim/Obsidian, 异步, 懒)**: `vault_watch` Modify (path 是已知智能表格 / `tables/**` / 有 `schema:` frontmatter) → 入队标陈旧; 下次 describe/query 时比 `mtime_ms`/`content_hash` 懒重建 (`vault_embeddings.rs:151` cached_meta 模式)。
- **删除**: `remove_table` 级联删 4 表, 并把指向它的 `st_refs.dst_row_id` 置 NULL (变 dangling)。
- **增量 = 表粒度**: `reindex_table` = 一个事务内 `DELETE WHERE table_id=?` 4 表 + 批量插入新解析 SmartTable (千行子毫秒, 不做行级 diff)。
- **全量**: `rebuild_all(vault_root)` 扫 `tables/**` + 带 `schema:` 的 `.md`。
- **跨表 ref 重解析**: 重建表 T 后, 重解析 `dst_table_id=T AND dst_row_id IS NULL` 的 dangling (新出现的目标行 un-dangle), 有界。
- **冲突规则: markdown 永远赢** —— 读前比 mtime/hash, drift 则重建后服务; 文件读不到则降级内存 `run_query`。索引从不直接写 markdown。

## C. RecordSource 可选索引后端

`QuerySource` trait/wire 契约**不变**。加可选加速路径, gate 选择: 小表走内存 (现状), 大表/关系型走 SQL。

```rust
pub trait IndexedRecordSource {
    fn table_id(&self) -> &str;
    fn query_indexed(&self, idx: &SmartTableIndex, req: &QueryRequest, now: NaiveDate)
        -> Option<Result<QueryResult, QueryError>>; // None = 不可索引/陈旧/不支持 → 退回 run_query
}
```

gate 选择 (`mcp_server::smart_table_query` ~`:533`): parse → 若 `index.is_fresh && req 可索引 && rows>THRESHOLD(~500)` 则 `query_indexed`, 否则 `table.query`(现有内存 run_query 不变)。**契约一致**: 同 QueryRequest 入、同 QueryResult 出、同 `QueryError::UnknownField{valid}`; `Within` 等相对日期在 Rust 预展开为日期边界或返 None 退回 —— **一份语义定义, 存疑就退回 run_query**。`CellType::parse → value_num/value_date` 映射复用 `query.rs:46-62`。

## D. 关系字段计算 (新 4 种, 计算非用户输入)

schema 在 frontmatter (truth):
```yaml
- { key: contact, label: Contact, type: reference, table: contacts/people.md, display: name }
- { key: contact_email, label: Email, type: lookup, via: contact, target: email }
- { key: deal_total, label: Deals $, type: rollup, via: deals, target: amount, fn: sum }
- { key: margin, label: Margin, type: formula, expr: "amount - cost" }
```

| 字段 | SQL over 索引 | 写回 markdown |
|---|---|---|
| **Reference** | 单元格原值 (`[[...]]`/id list) 是 truth; 索引解析进 `st_refs`; display = JOIN st_refs→目标表 st_cells WHERE field_key=display | 原 link token 是 truth; display **从不持久化** (query 时算) |
| **Lookup** | via=Reference 字段, target=关联表字段; JOIN st_refs+st_cells | 纯派生, **不写** markdown |
| **Rollup** | fn∈{sum,avg,count,min,max} over 关联行 value_num; GROUP BY src_row_id | 纯派生, 不持久化 |
| **Formula** | v1 小型白名单表达式求值器 (`+-*/()`, 字段引用, Lookup/Rollup 引用), Rust 中对索引解析值求值 (**不**把任意表达式推进 SQL —— 防幻觉+安全, 合 `query.rs:9-11` 固定算子哲学) | 派生, 不持久化 |

**承重选择: 关系/计算列 = query-time 派生, 从不写进 markdown pipe-table。** 只有 Reference 的原始 link token 是磁盘 truth。守 vim test (无陈旧缓存值烂在文件里) + 避免双写一致性问题。`describe` 为计算字段补元数据 (via/target/fn/expr) 让 Irisy 理解, 但只读: 对计算字段 produce 在 gate 被结构化 reject (只有底层 Reference token 可写) —— 保 §14 「query 不变更, produce 过门」。

新模块 `src-tauri/src/kernel/smart_table_relations.rs`: `resolve_references`, `compute_lookup/rollup/formula`, 白名单求值器。

## E. vim test — truth vs 派生 台账

| 磁盘 (markdown) = TRUTH | SQLite = 派生 (可重建/可删) |
|---|---|
| `schema:` frontmatter (含 ref/lookup/rollup/formula **定义**) | `st_tables.schema_json` (副本) |
| 每行原始单元格 (pipe table) | `st_rows` + `st_cells.value_text` |
| Reference 单元格 = 人读 wikilink/id token (vim/Obsidian 可读可跳) | `st_refs` 解析边, dst_row_id 解析 |
| — | value_num/value_date 类型投影 |
| — | Lookup/Rollup/Formula 计算值 (从不上盘) |
| — | 整个 smart-table-index.db |

vim test 过: 计算列不在盘, 但其**输入**在盘 (原始 references + 源行各自文件里), vim 用户能手工重建任何 Lookup/Rollup —— 值是真派生非隐藏 truth。删 db 不丢东西。

## F. 实施切片 (每片 cargo test 收绿)

1. **索引 store + 从 markdown 重建** (不动 query): open/ensure_schema(4 表)/reindex_table/remove_table/is_fresh/count, 暂不做 st_refs。测: reindex 计数 + value_num 填充 + 幂等 + remove 级联 + is_fresh 翻转 (仿 `vault_index.rs:217-283`)。
2. **IndexedRecordSource filter/sort/group, gate 在 THRESHOLD 之上优先**: query_indexed (SQL build + 同验证/错误)。测: 同 QueryRequest 走 run_query 和 query_indexed **结果完全一致** (number-gt/text-contains/date-within/tag-has/multi-sort/group/limit) —— 这条 parity 测是核心安全网; UnknownField 同错误。
3. **写穿透同步 + 懒陈旧重建**: produce 后 reindex; vault_watch Modify→标陈旧→下次读懒重建; 冲突 markdown 赢降级。测: update_cell 后索引即反映; 外部改文件→下次 query 重建; 中途删 db→仍内存降级答。
4. **Reference 边 + Lookup/Rollup**: reindex 填 st_refs; relations.rs lookup/rollup; describe 广告计算字段; 计算列 query 时 join 不持久化; 计算字段 produce reject。测: deals→contacts ref 解析, Lookup 拉 email, Rollup sum(amount) 对手算; dangling 返空不崩; produce 后 markdown body **无**计算列。
5. **跨表 formula + 重解析 + 全量重建工具**: 白名单求值器; 目标重建时 un-dangle; `smart_table.reindex` + rebuild_all。测: formula amount-cost; 补缺失目标行→prior dangling 重解析; rebuild_all 计数等于逐表。

## G. 风险/取舍
- 双向同步漂移 → markdown 永远赢 + is_fresh 门控 + 存疑降级内存; 索引非写目标。
- dangling reference → dst_row_id NULL 一等状态, Lookup/Rollup 返空/identity 不报错, 目标重现时重解析; describe 暴露 dangling 计数。
- 陈旧 → 读时懒 mtime/hash 检 + produce 写穿透, 窗口极小; 可删 db 保证可恢复。
- 并发写 → 已被 per-path `vault_write_lock` 串行 (`mcp_server.rs:568`), reindex 在同临界区, 无撕裂。
- EAV 规模成本 → 复合索引 + table_id 分区 + THRESHOLD; 百万行 glide 只拉窗口 getCellContent。
- formula 安全/幻觉 → 无任意 SQL/eval, 白名单算子镜像 query.rs 固定 Operator; 计算字段 produce reject。
- row_id 编辑不稳 → 内容派生 id 编辑重 key (可接受), 关系按 link token 解析非 row_id; 写回 merge-by-snapshot。
- schema churn → EAV 零 DDL; reindex 每次重 parse schema_json; 删字段的 orphan st_cells 被 delete-then-insert 清。

## 文件地图
- 新: `smart_table_index.rs` (store, 仿 vault_index/embeddings); `smart_table_relations.rs` (ref resolve + lookup/rollup/formula)
- 改: `query.rs` (加 IndexedRecordSource trait + 计算 CellType 变体 parse, **不破坏** QuerySource/run_query); `vault_smart_table.rs` (parse 计算字段 schema 元数据; impl IndexedRecordSource); `mcp_server.rs` (query 索引优先选择; produce 后 reindex `:582,:603,:712`; 计算字段 produce reject; 新 smart_table.reindex); `mod.rs` (注册新模块; vault_watch 标陈旧消费者)
- ADR: amend ADR-002 §14 写入 as-built schema + ADR-003 §6.5 计算字段类型; 按 PROCESS.md bump 版本。
