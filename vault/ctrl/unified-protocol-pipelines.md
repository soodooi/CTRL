---
title: 统一通讯协议 — 能力管线驱动的泛化开发
kind: design
status: draft
created_at: 2026-06-22
owner: bao
related:
  - "[[GOAL]]"
  - "[[irisy-coding-companion]]"
  - research-unified-operation-interface.md
---

# 统一通讯协议 — 用 Irisy 能力管线驱动 §14 泛化

> bao 2026-06-22:Irisy 该有能力清单(助理/知识库/coding/智能表格…),**一条一条实现+测试**,
> **用这些管线来整理通讯协议的泛化开发需求**。不空设计协议,用真实能力 ground 它。

## 协议目标(全项目,不只 Irisy)

§14 从「smart-table 查询」提升成**整个 CTRL 的统一通讯协议**:所有模块/源、两个 brain
(Irisy via CLI/PTV + claude via MCP)、一切数据交互,都经**四动词 + `:17873` gate**:

- `describe` — 源声明:支持哪些动词 + 数据形态(record/stream)+ 字段/算子(防幻觉,语义层)
- `query` — 读**快照**(一次性、并行):表格行/笔记/registry/终端"最近 N"
- `subscribe` — 订阅**实时流**(新增第 4 动词 = ST-SS 收编):终端 stdout/事件/token/vault 变化
- `produce` — 写/动作(串行、过 review gate):改 cell/发命令/装配

读分两支(`query` 快照 + `subscribe` 流)= GraphQL query/subscription/mutation 三分(ADR 已引证据)。
ST-SS 不被取代,**归位成 `subscribe` 的传输层**。

## 能力清单 × 四动词矩阵(✅有 ·⏳待规范 ·—不需要)

| 能力(管线) | 形态 | describe | query | subscribe | produce | 现状 |
|-----------|------|:--:|:--:|:--:|:--:|------|
| **智能表格** smart-table | record | ✅ | ✅ | — | ✅ cell/row/ai_column | §14 首个,已实现+测过(基线) |
| **知识库** KB/notes | record+变化 | ✅ | ✅ | ⏳ vault 变化流 | ⏳ vault_write 规范化 | query 有,produce/subscribe 待 |
| **mcp registry** | record | ✅ | ✅ | — | ⏳ install/uninstall | query 有,produce 待 |
| **provider catalogue** | record | ✅ | ✅ | — | ⏳ set_active | query 有,produce 待 |
| **coding 终端** | **stream**+动作 | ⏳ | ⏳ 最近输出 | ⏳ **实时 stdout(ST-SS)** | ⏳ run_command 过 gate | P0 临时通道,**首个 stream 源** |
| **助理** assistant/Irisy chat | **stream**+动作 | ⏳ | ⏳ 历史 | ⏳ **token 流** | ⏳ 发消息 | 走 transport,待规范 |

(「等等」可扩展:连接器 connectors / feature packs / env 凭证 / mesh 同步 — 同样实现需要的动词即接入)

## 逐条实现 + 测试顺序(每条一个 PR,绿了再下一条)

> 顺序原则:先用 record 能力**补全 produce**(协议读写闭环),再用 stream 能力**驱动 subscribe**(协议泛化的真正难点)。

1. **smart-table** ✅ — 基线,四动词里 describe/query/produce 已实现+测试。subscribe 暂不需要。
2. **KB/notes** — 补 `produce`(vault_write 规范进 §14)+ 测试。验证 record produce 复用。
3. **registry / provider** — 补 `produce`(install / set_active)+ 测试。验证 produce 对"动作型"源。
4. **coding 终端**(★关键)— 实现 describe + query(最近输出)+ **subscribe(收编 ST-SS 实时流)** + produce(run_command 过 gate=提议-批准)+ 测试。**这条驱动 subscribe 动词诞生。**
5. **助理 chat** — describe + query(历史)+ **subscribe(token 流)** + produce(发消息)+ 测试。验证 subscribe 对第二类 stream 源,确认通用。

## 协议泛化需求(从管线反推 — 每条能力暴露什么)

| ID | 需求 | 由哪条管线暴露 |
|----|------|--------------|
| N1 | `describe` 要能声明"支持哪些动词 + record/stream 形态" | coding / assistant |
| N2 | **新增 `subscribe` 动词**(读实时流) | coding(stdout) / assistant(token) / KB(变化) |
| N3 | `subscribe` 底层 = **ST-SS 收编**(WS bridge + cancel 复用) | coding |
| N4 | `produce` 的 review gate 对 **stream 动作(命令) vs record 写(cell)** 语义一致 | coding vs smart-table |
| N5 | `query` 快照语义对 **stream 源**(给"最近 N",不是全量) | coding |
| N6 | `produce` 对"动作型"源(install/set_active/发消息)而非纯数据写 | registry/provider/assistant |

## 待 bao 拍

- 顺序对吗?是否先从 **②KB produce** 起步(最小、纯 record、验证 produce 复用),还是直接上 **④coding**(关键但要造 subscribe)?
- `subscribe` 动词进 ADR-002 §14 amendment(bump version),我先写 ADR 再按管线逐条实现+测试?
