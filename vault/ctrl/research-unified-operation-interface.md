# 统一操作接口 — 对标研究 (GraphQL / Unix·Plan9 / agentic-AI)

> CTRL「统一操作接口 describe/query/produce」的**研究事实源**。决策落 `ADR-002 substrate §14 (v29)`;本文件只记**别人的事实 + 评估依据**。
> 缘起 (bao 2026-06-19):"md/html/智能表格/pdf 都是功能点,输入输出都走 query 会不会更好?你网上调研评估一下"。
> 联网核实 2026-06-19。

---

## 1. 问题

要不要给 CTRL 一条**统一 I/O 总线**:所有内容类型(md/html/表格/pdf/连接器)= 功能点,**输入输出都走一个 query**?分两半评估:① 统一接口罩异构内容,成不成?② 读和写(输入/输出)该不该是同一个动词?

## 2. 证据 (三方独立,收敛)

### 2.1 GraphQL — 最统一的 query 接口,却故意分 query / mutation
- **query = 读,mutation = 写**,是两类操作,刻意分开。
- 技术理由:**query 字段并行执行;mutation 字段串行执行**(写必须排序防竞态,读不用)。
- 设计理由:mutation 显式标"我会改数据"(意图信号 + 副作用),即使 query 技术上也能改数据,也分开以表意图。
- → **结论:连最统一的系统都不把读写合成一个动词。** 来源:[GraphQL Mutations](https://graphql.org/learn/mutations/)

### 2.2 Unix / Plan9 "一切皆文件" — 统一的威力与代价
- **威力**:统一句柄(read/write/list)罩磁盘/设备/进程/网络;同一套工具通吃;组合靠 namespace 不靠 API 集成 → 可用性 + 可组合性大涨。
- **代价/失败模式**:
  - 不是啥都能塞进 open/read/write —— **sockets、进程本就不是文件**,要 ioctl 等逃生口。
  - **丢类型系统**:`/net` vs `/proc` vs 磁盘文件长一样,**没有类型系统**判断哪个是哪个,全靠约定。
- → **结论:纯统一会丢类型;要保住一个 schema/类型层。** 来源:[Plan9 everything-is-a-file](https://mattrickard.com/plan9-everything-is-a-file) · [Wikipedia](https://en.wikipedia.org/wiki/Everything_is_a_file)

### 2.3 agentic-AI 论文 (2026) — 把"一切皆文件"用到 AI agent,直接对口
- 主张给 agent **一个统一 I/O 抽象**(read/write/list),省得学几十套工具 spec → **工具更可靠、更可组合、新资源即插即用**(对 LLM brain 尤其值)。
- 但**保持读写分开**(沿用 Unix 语义)。
- **保留一个 type/schema 层**:"维持语法统一的同时,防止语义结构完全丢失"。
- 承认局限:异构(流式/事务不干净映射)、语义丢失(把复杂操作压进 read/write 会藏掉副作用/约束)、类型安全风险。
- → **结论:统一语法 + 保留 schema 层 + 读写分开——三条都要。** 来源:[arXiv 2601.11672](https://arxiv.org/pdf/2601.11672)

## 3. 评估结论 (落 ADR-002 §14)

| 子问题 | 结论 | 依据 |
|---|---|---|
| 统一接口罩异构内容? | **是,更好** —— 一个接口 → Irisy 少学动词、少选错、工作流可组合 | Unix/Plan9 + agentic-AI 论文 |
| 输入输出同一个 query? | **否** —— 读写分开:写要串行 + 意图 + 副作用门 | GraphQL query≠mutation + Unix + AI 论文(三方一致) |
| 怎么不塌成万能糊? | **保留 describe 类型层**,算子由源自报 | "一切皆文件"丢类型的教训 + GraphQL schema + AI 论文保 schema |
| CTRL 特有理由 | 写**必须**与读分开,否则**没法门控写**(写过 review gate) | memory `local-ai-frontend`(write-ops need review gate)+ ADR-006 §4 / ADR-003 §8.2-E |

**最终架构 = 一个统一接口 = `describe`(类型层) + `query`(读,并行不过门) + `produce`(写,串行过门)**,源分 RecordSource/TextSource/BlobSource,算子由 describe 自报。**统一在接口、分化在 describe;不是啥都 query。** smart-table = 首个实现。

## 4. 对 bao 原命题的回应

"输入输出都走 query" —— **方向对了一大半**:统一接口确实更好(采纳)。但**"都走一个 query 动词"那一点,三方证据一致反对**:读写分动词,否则丢掉写门控 + 排序。修正为 **describe / query / produce 一个接口三动词**。
