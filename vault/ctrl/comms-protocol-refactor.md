---
title: 全项目通讯协议重构 — 分析与方案
kind: design
status: superseded
superseded_by: "[[comms-architecture-permanent]]"
created_at: 2026-06-22
owner: bao
related:
  - "[[unified-protocol-pipelines]]"
  - "[[irisy-coding-companion]]"
  - "[[GOAL]]"
  - 002-substrate.md
---

# 全项目通讯协议重构 — 分析与方案

> bao 2026-06-22:项目基本完整了,**认真分析研究、重构通讯协议**。
> 本文基于全项目代码盘点(Rust 侧 + 前端侧 + 外部),不空谈。

## 一、现状全景(代码盘点,数字真实)

通讯分**三层 + §14 已 partial 落地**:

### L1 请求-响应(两套表面,部分重叠)
- **Tauri command**(内):**134 条** `#[tauri::command]`(PWA ↔ kernel,同进程 invoke)。前端 `lib/kernel.ts` 75 个封装。
- **MCP tool**(外):**58 个** `#[tool]` 在 `:17873` gate(claude / hermes / 外部 agent 都打这里)。
- **重叠**:同一能力两套面——`vault.write` 既是 Tauri command 又是 MCP tool;vault 一项就 **24 MCP 工具 + 28 Tauri 命令 = 52 个**做 CRUD。

### L2 事件流(一套,正交)
- **ST-SS** `:17872`:WS + CBOR Cell/Op。14 种 Cell(terminal_output / llm_response / agent_thinking / env_status…)+ ~30 种 Op。kernel event_bus / scheduler publish,PWA subscribe。**它不是 RPC,是流总线**,跟 L1 正交。

### L3 §14 四动词(已 partial 落地)
- 已是 §14 source 的:**smart_table / notes / registry / providers**(各有 describe/query/produce 在 gate)。
- 还**没**收编的:vault(52 细粒度)、terminal(走 ST-SS+cs_*)、llm/chat、connector、kv、http。

### 外部 & 内部脑
- **外部已统一于 MCP gate `:17873` + projection**:claude 经 `.mcp.json` 发现 → MCP;projector 投影 `.mcp.json` + `AGENTS.md` 到 `~/Documents/CTRL/`。
- **hermes(Irisy 脑)**:ACP stdio JSON-RPC,但工具调用**穿 `:17873` MCP passthrough**。
- **ACP** 降级 future(仅 hermes 用);**opencode** 未接线。

## 二、问题诊断(碎片化具体在哪)

| # | 问题 | 证据 |
|---|------|------|
| P1 | **同能力双表面**(内 Tauri / 外 MCP),要维护两套、易漂移 | vault.write ×2;134 Tauri ∩ 58 MCP 大量重叠 |
| P2 | **细粒度命令膨胀**,不是 §14 收敛 | vault 52 个命令做 CRUD;134 Tauri 多为 ad-hoc 动词 |
| P3 | **§14 落地不全**,只 4 个 source 是四动词 | vault/terminal/chat/llm 仍专用面 |
| P4 | **subscribe 不是正式动词**,流游离在契约外 | ST-SS 有流,但 `describe` 不声明 stream,query≠订阅 |
| P5 | **三套鉴权 token 分散** | Tauri 内置 / ST-SS token / MCP bearer 各一套 |
| P6 | EffectExecutor 未 wire(kernel 内部 actor) | handle() 返回 Vec<Effect> 但无 dispatch,P2.4 skeleton |

**核心判断**:现状**不是乱,是演进留下的三层 + §14 起步**。真正的债 = **同能力两套表面(P1/P2)+ 契约没盖全(P3/P4)**。

## 三、重构北极星

> **能力 = §14 source,四动词(describe/query/subscribe/produce)覆盖;传输按场景选,契约统一。**

```
   契约层(唯一真相)   §14 四动词 over Source(Record/Stream)
   ─────────────────────────────────────────────────────────
   传输层(可选实现)   内部:Tauri invoke(q/produce)+ ST-SS(subscribe)
                      外部:MCP(:17873, resources/tools/subscribe)
                      脑:  ACP(hermes, 工具穿 MCP)
```

- **一个 source 实现一次,三传输自动暴露** —— 不再内 Tauri / 外 MCP 各写一遍(消 P1)。
- **134 + 58 工具 → N source × 4 动词** —— CRUD 收敛进 produce 的 action(消 P2)。
- **subscribe 转正为第四动词,ST-SS 收编为其内部传输**(消 P4);`describe` 声明 record/stream 形态。
- 采用 **MCP 资源语义**(resources/read=query · resources/subscribe=subscribe · tools/call=produce · list=describe)+ **CQRS 读写分离**(query/command/event)做背书 —— 不自造协议(见 [[unified-protocol-pipelines]] 调研)。
- **鉴权统一**一套 token 框架(消 P5)。

## 四、渐进路径(不推倒重来,收敛)

1. **ADR-002 §14 v31** — 加 `subscribe` 第四动词 + 写明「四动词=契约,Tauri/MCP/ST-SS=传输」+ ST-SS 收编 + MCP/CQRS 背书。
2. **模板** — smart_table(已四动词)= 参照实现。
3. **逐 source 收敛**(= [[unified-protocol-pipelines]] 的能力管线,一条一 PR + 测试):
   - vault(52 → 四动词,CRUD 收进 produce action)
   - terminal(describe/query/**subscribe 收 ST-SS**/produce 过 gate)
   - llm/chat(query 历史 / subscribe token / produce 发消息)
   - connector / kv / http 跟进
4. **ST-SS 转正** = subscribe 内部传输层;`describe` 声明 stream。
5. **新能力一律四动词** — 停止再加细粒度 Tauri command / MCP tool。
6. **鉴权统一** token(P5)。
7. **EffectExecutor wire**(P6,kernel 内部,长期)。

## 五、ST-SS 去留(回答 bao「st-ss 不是去掉了吗」)

**没去掉,还活跃**(stss_bridge.rs + commands/stss.rs + ctrl-stss + 前端 useSubprocessChannel/useCellStream + 我刚做的 CodingTerminal 都在用;无任何退役 ADR)。
**重构后定位**:ST-SS = `subscribe` 的**内部高效传输**(CBOR 流),对外暴露成 MCP subscription。**去掉它反而要重造流机制** —— 留着,但收进 §14 契约伞下,不再是游离的第二套。

## 六、「现在是最好的方案吗」— 诚实结论

**不是。** 现状有 P1(双表面)+ P2(命令膨胀)的实债。但**也不该推倒重来**(134+58 在用)。
**最好 = 渐进收敛到「一契约四动词 + 分层传输」**:契约盖全、传输各尽其能、ST-SS 转正为 subscribe 底座。这是本文方案。

## 待 bao 拍

1. 北极星(一契约四动词 + 分层传输)认可吗?
2. 渐进收敛 vs 更激进(比如内部也强制走 MCP、去 Tauri 双表面)——要多激进?
3. 先写 ADR-002 §14 v31(已 bump version 31),再按能力管线逐 source 收敛?
