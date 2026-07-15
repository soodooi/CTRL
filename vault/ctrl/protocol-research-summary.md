---
title: 通讯协议研究成果总览(2026-06-22 session)— 与项目/目标结合
kind: summary
status: done
created_at: 2026-06-22
owner: bao
author: zeus (通讯协议)
purpose: 把本 session 散落的协议研究成果整理归位,理清每份文档的权威性/去留,并接回 GOAL.md 主目标
related:
  - 010-communication.md
  - "[[research-protocol-2026]]"
  - "[[protocol-opensource-strategy]]"
  - "[[GOAL]]"
---

# 通讯协议研究成果总览

> bao 2026-06-22:「把这次研究成果好好整理,与项目结合、与目标结合,放在该放的地方。」
> 本文是这次协议研究的**单一入口**:三条权威结论 + 文档地图 + 草稿去留 + 与主目标的关系。
> 性质提醒:本 session 的协议研究是 GOAL.md 主目标(§14+智能表格+SC8)之外的 **valuable 旁支**,成果在此归位,不再继续吃产品时间(见 [[GOAL]] 2026-06-22 进展日志)。

## 三条权威结论(这次研究的净产出)

1. **CTRL 通讯架构 = 统一窄腰 + 多元传输**(权威源 = ADR-010)。
   窄腰三件:**§14 四动词契约**(describe/query/subscribe/produce)+ **`:17873` gate 治理**(权限/审计/可见性)+ **MCP 插件协议**。传输按 8 条缝物理本质多元(Tauri IPC / actor / ST-SS / MCP / ACP / mesh),**不追求「一个框架统吃」**(那是 CORBA/SOAP/ESB 反模式)。

2. **§14 不开源成标准**(权威源 = protocol-opensource-strategy + research-protocol-2026 补充)。
   §14 想占的层(agent↔数据操作 + 读写分离 + 写治理 + 语义层 + local-first)2026 已被 MCP + GraphQL + Cube 语义层 + AI-governance 框架 + Obsidian-MCP 生态填满(Apollo MCP Server 已做「mutation 需批准」、Fast.io 已做风险分级治理、rodneydyer 已做 local-first MCP for PKM)。**§14 留作 CTRL 内部架构;护城河 = 产品(普通用户 local-first AI 平台 + 能力市场),不是协议。** 要影响力则做 MCP 生态最佳 local-first 公民(好想法作 MCP extension 贡献回去,官方有 extension 机制)。

3. **5/8 缝协议选型 + 3 处校准**(权威源 = ADR-010 § transports + Roadmap)。
   ① 插件接入=MCP / ② 第三方=MCP / ③ Irisy↔前端流=ST-SS **向 AG-UI 对齐** / ④ 驱动 coding agent=**ACP**(有据采用,Registry 28+) / ⑤ mesh=现栈 **+ 跟踪 Beelay/Keyhive**。MCP 2026 增量(MCP Apps sandboxed-iframe UI、Streamable HTTP `Mcp-Method/Name` headers 利好 gate)已记。

## 文档地图(该放的地方 + 权威性)

| 文档 | 位置 | 是什么 | 权威性 |
|---|---|---|---|
| **ADR-010 communication** | `vault/ctrl/adrs/` | 通讯总纲(窄腰+8缝+内外哲学)| ★ **唯一真相源**(module ADR) |
| **research-protocol-2026.md** | `vault/ctrl/` | 协议选型 2026 事实(竞品/MCP增量/local-first)| 事实根基(deep-research) |
| **protocol-opensource-strategy.md** | `vault/ctrl/` | 开源战略(竞品打法 + §14 不开源否定结论)| 战略结论 |
| **本文 protocol-research-summary.md** | `vault/ctrl/` | 单一入口/导航 | 总览 |
| comms-protocol-refactor.md | `vault/ctrl/` | 早期探索草稿(三层现状盘点)| ⬇ **已吸收进 ADR-010 § diagnosis** |
| unified-protocol-pipelines.md | `vault/ctrl/` | 早期探索草稿(四动词管线)| ⬇ **已吸收进 ADR-010 § contract + Roadmap** |
| irisy-coding-companion.md | `vault/ctrl/` | Irisy coding 伴侣职能清单(另一旁支)| 协议部分(①②③通道)入 ADR-010 seam④;职能清单**留作 Irisy coding 模块未来设计参考**,不属本主目标 |

> 三份早期草稿是探索轨迹,**保留不删**(记录怎么想到的),但权威结论已上移到 ADR-010 + 两份研究文档。未来读协议决策只需读 ADR-010 + 本总览。

## 与主目标的结合(GOAL.md = §14 + 智能表格 + 接 PWA 前端 SC8)

- **§14 被这次研究巩固**:ADR-010 把它确立为「窄腰契约」—— 正是智能表格(及所有 content-type 源)经 gate 操作的统一接口。研究反而强化了主目标的地基。
- **下一步不变 = SC8**:PWA 前端消费 §14 query gate(filter/sort/group UI + describe 驱动字段/算子 + AI 列 start→poll→展示)+ 轨1 Grist parity + 轨2 关系型索引。
- **旁支沉淀,不阻塞主线**(记在 ADR-010 Roadmap,需要时再做):§14 加 `subscribe` 第四动词 / ST-SS 向 AG-UI 对齐 / mesh 跟踪 Beelay-Keyhive / §14 不开源(已结论)。

## 与项目架构的结合

- **ADR 体系**:communication 是第 8 个 module ADR(7→8,INDEX/PROCESS 已更新,Process v0.3);008/009 retired 占号故顺延 010。
- **§14 在产品里的角色**:智能表格(首个实现)→ KB/registry/provider(已是源)→ Irisy 用同一套操作任何源 → 新能力包实现 Source 即免费可用。这条「窄腰 → 能力市场」链是 CTRL「普通用户通用平台」的技术骨架。
- **不动的锁点**:spine 5 primitive 不变;134 Tauri + 58 MCP 收敛不推倒;plain-text/vim-test 不破。

## 可选的进一步整理(待 bao 定)

- 三份早期草稿(comms-protocol-refactor / unified-protocol-pipelines / irisy-coding-companion)若确认不再需要探索轨迹,可删除(它们 untracked,内容已吸收)。**建议保留 irisy-coding-companion**(Irisy coding 模块未来要用),其余两份可删。
