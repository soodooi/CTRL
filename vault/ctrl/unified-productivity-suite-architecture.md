---
title: CTRL 本地生产力套件 — 统一 §14 系统架构图 (governing)
kind: plan
created_at: 2026-07-02
owner: bao
author: claude
purpose: bao「你架构弄清楚了吗？是在建立整套系统吗？…好，做」—— 停止逐端点手写(accretion)，把整套生产力套件当一个统一 §14 系统设计
serves: CTRL = 本地 AI-native 飞书生产力核心 (Bitable/Sheets/Docs/Task/Calendar/Drive) 一次建成, 加产品=加数据不加代码
related:
  - 002-substrate.md          # §14 describe/query/produce
  - "[[feishu-endpoint-parity-map.md]]"  # A 桶 = 要建的产品
  - "[[smart-table-grist-parity-plan.md]]"
  - "[[capability-pack-map.md]]"
---

# 统一 §14 系统架构 — 一次建成整套生产力套件

> **诚实起点**（bao 2026-07-02 戳破）：我此前在 smart-table 一个产品上**逐端点手写** produce 工具（add_field/delete_row/batch…~10 个）= accretion，不是「建系统」。照此加 Sheets/Docs 会把每操作**再手写一遍**。这张图 = 把写侧统一，让整套套件共享一套 §14，**加产品 = 实现两个 trait + 声明形状，零新 gate 工具**。

## 1. 病灶：读侧已系统化，写侧碎片化

| 侧 | 现状 | 系统化? |
|---|---|---|
| **读 describe/query** | `QuerySource` trait(`query.rs`)：describe()+rows()→共享 `run_query`。native + 连接器都实现它 | ✅ **一个 trait,加源零引擎代码** |
| **写 produce** | native = ~10 个 bespoke gate 工具(smart_table_add_field/delete_row/batch_*/create/add_view…)直接调 SmartTable 方法;连接器 = 另一套通用 `source_produce`(manifest 驱动) | ❌ **一操作一工具 + 两套做法不一致** |

读侧证明了正确形态：**一个 trait + 共享引擎 → 加源零代码**。写侧要照抄这个形态。

## 2. 统一写侧 = `RecordSink` trait + 一个 `produce` 动词（镜像 QuerySource）

**核心决策**：produce 从「N 个 bespoke 工具」收敛成 **`§14 三动词`字面成立 —— describe / query / produce 各一个 gate 动词**，produce 带一个**类型化 op union**，dispatch 到源的 `RecordSink`。

```
// 写侧的 op 全集(编译期固定,反幻觉 §14.1;非自由字符串)
enum ProduceOp {
  SetCell { row, field, value },
  UpsertRows { rows: Vec<Row> },          // append/batch-append 归一
  DeleteRows { indices: Vec<usize> },     // delete/batch-delete 归一
  AddField { key, label, type, options?, relation? },   // relation? = Reference/Lookup/Rollup 声明
  UpdateField { key, label?, type?, options? },
  DeleteField { key },
  CreateSource { name, fields },          // 建表/建 sheet/建 doc
  AddView { ... } / DropView { name },
  // Effect 类(§14.9 Write vs Effect)另走 Effect primitive, 不在此
}

trait RecordSink {                        // 写侧 = QuerySource 的镜像
  fn supported_ops(&self) -> Vec<OpKind>; // 源声明它支持哪些(describe 广告出去)
  fn produce(&mut self, op: ProduceOp) -> Result<Feedback, ProduceError>;
}
```

**gate 只需 3 个 §14 动词**（对任意源）：`source_describe` / `source_query` / `source_produce(source_ref, op)`。native vault 源(path 寻址)+ 连接器(source_id 寻址)+ 未来 Sheets/Docs 全走这 3 个。**§14「三动词」从口号变字面。**

## 3. 加产品 = 加数据不加代码

一个数据产品(Sheets/Docs/Task/Calendar…)接入 =
1. 实现 **`QuerySource`**(describe/rows) over 它的 plain-text 格式;
2. 实现 **`RecordSink`**(supported_ops + produce) over 同一格式;
3. 在**源注册表**登记(按 path 前缀 / 类型识别)。

**零新 gate 工具。** describe 自动广告该产品支持的 op(Irisy 发现能力),produce 自动获得全 CRUD。这才是「建系统」。

## 4. 整套套件 = 一个 §14 系统（产品地图，全共享上面 3 动词）

| 产品 | plain-text 形态 | QuerySource | RecordSink 支持的 op | 现状 |
|---|---|---|---|---|
| **Smart-table/Bitable** | `tables/*.md`(frontmatter schema + pipe table) | ✅ | 全 CRUD + field + view + relation | ✅ RecordSink (slice 1, in-place schema patch) |
| **Sheets** | `.md` 表 / csv | (复用 record) | cell/row/col | ⬜ |
| **Docs** | `.md`(vault) | Text profile | 块级 produce | 🟡 vault 有 |
| **Task** | inline-checkbox `.md` | ✅(task source) | set_cell/upsert_rows/delete_rows(字段 op Unsupported) | ✅ RecordSink (slice 2, self-persist 多 note) |
| **Calendar** | `.md` events | ⬜ | event CRUD | ⬜ |
| **Drive** | vault files | list | file CRUD | 🟡 vault |
| **连接器(Ghostfolio/…)** | 远端 REST | manifest source | manifest-declared produce | ✅ |

## 5. 迁移(不推倒重来,收敛)

同 ghostfolio_*→source_* 的做法:
1. 定义 `ProduceOp` union + `RecordSink` trait + 泛型 `source_produce(source_ref, op)` dispatch(native vault 源按 path 识别 → SmartTable/Task/... 的 RecordSink)。
2. SmartTable 实现 RecordSink(把现有 add_field/delete_row/batch/create/add_view/set_cell 方法收进 produce(op) 分发)。
3. 现有 bespoke `smart_table_*` 工具**退役到泛型 produce**(back-compat 期后删,像 ghostfolio)。
4. 新产品(Sheets/Docs/Calendar)**从一开始就只实现 trait**,不写工具。

## 6. 锁点不变(这是加固 §14,非新方向)
- **5 primitives 不动**;`RecordSink` 挂 Capability primitive 下(同 QuerySource)。
- **三动词加固**:produce 真成一个动词(此前是 N 个),更贴 §14.1「one interface」。
- `:17873` gate + review(produce 全过写审) + secret 不进 LLM + plain-text(markdown 仍 truth,round-trip) + 反幻觉(op 是编译期固定 union 非自由串,承 §14.1)。
- §14.9 Write vs Effect:ProduceOp 只含 Write;Effect 类(发信/POST 远端副作用)走 Effect primitive。

## 7. Build 序（对齐后）
1. **ADR-002 §14.13 amendment**:统一写侧(RecordSink + ProduceOp + 泛型 produce dispatch)。
2. kernel:`ProduceOp` + `RecordSink` trait + `source_produce` 泛型 dispatch(native path 源) + SmartTable 实现 RecordSink。
3. 收敛 smart_table_* bespoke 工具 → 泛型 produce(退役,ratchet 降)。
4. 补全 Bitable 剩余 op(update_field / relation add)——现在是**加一个 OpKind 分支**,不是加工具。
5. 横向:Task/Calendar/Sheets/Docs 各实现两 trait 接入(加数据不加代码)。

## 待 bao 拍
1. **produce 收敛成「一个动词 + 类型化 op union」** vs 保留 N 个 typed 工具但都泛型-over-源?我推**前者**(§14 三动词字面成立 + 加产品零工具),但 LLM 要用 tagged-union op(可行,反幻觉固定集)。
2. **现有 smart_table_* 是否退役到泛型**(像 ghostfolio→source_*)?我推**退役**(消除碎片 + 一个 SSOT)。back-compat 期你定。
3. 对齐后我从 §14.13 amendment + RecordSink trait 开建。
