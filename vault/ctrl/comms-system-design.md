---
title: CTRL 通讯系统设计 + 迁移图(governing execution map)
kind: design
created_at: 2026-06-24
owner: bao
author: claude
status: governing
purpose: 把散在 5 处的通讯设计收敛成一张完整图 —— 目标终态(一张图)+ 全量端点分类(不漏)+ 依赖排序迁移序列(每步可验证)。系统设计先行,之后每个切片 = 执行本图第 N 步。
consolidates:                       # 本图收编这些的「执行视图」;它们各自仍是真相源
  - 010-communication.md            # 决策 SSOT(窄腰/两信任域/wire 标准/§ endpoint-spec)
  - 002-substrate.md                # §14 实现真相 + § mcp-bus + § projection + § crypto
  - "[[comms-interface-spec]]"      # 8 缝接口契约 + 对标
  - "[[endpoint-catalog]]"          # 端点 inventory(auto-gen)
  - "[[GOAL]]"                      # SC1-7 当前活跃切片
related:
  - "[[capability-pack-map]]"       # 功能包三层(① 原生 ② 内置 ③ 外部 connector)
---

# CTRL 通讯系统设计 + 迁移图

> 读法:这是**执行图**(目标终态 + 全量分类 + 迁移序列)。决策为什么这么定 → ADR-010;实现细则 → ADR-002 §14。本图保证**每个端点都有归属**、**每步可验证**。

## 0. 一句话 + 一张图

**统一的是「规矩」(§14 三动词语义 + gate 治理),不是「通道」(每缝走最适合的标准 wire)。每个能力实现一次 = 一个 §14 source,经 gate 用 MCP 暴露,前端经 gate 调,不再各写一套。**

```
                       ┌─────────────────────────────────────────────┐
   语义契约(SSOT,自创) │  §14 = describe / query / produce            │  实现一次/源
                       └─────────────────────────────────────────────┘
                                         │ 一个 source 实现一次,自动多面暴露
        ┌────────────────────────────────┼────────────────────────────────┐
   wire(标准,分缝):  MCP(工具)            AsyncAPI(流)            protobuf(跨设备)
        │  JSON-RPC+JSON Schema           over WS/Tauri Channels    over WebRTC + E2EE
        │  tools/list = 端点 spec          (缝①⑥)                  (缝⑧,独立目标)
        │  (缝③④⑤⑦)
        ▼
   ╔═════════════════════════════════════════════════════════════════════════╗
   ║  :17873 gate(治理,自创)= 鉴权 + 审计 ledger + 可见性裁剪 + 写 review     ║
   ║  ── 唯一跨域收口 ── 内核域 actor↔actor(InternalMsg)不经此 ──             ║
   ╚═════════════════════════════════════════════════════════════════════════╝
        ▲ MCP/HTTP(外部 agent/Irisy/BYO-CLI)   ▲ gate_invoke(前端,in-process)
        │                                       │  ← 终态:前端经 gate 调能力,
   AI / 外部                                     │     不再各写 Tauri command
                                                前端 PWA
```

**自创只两块**(无标准覆盖,正当):§14 语义 SSOT + :17873 gate。**其余全标准**(MCP/AsyncAPI/protobuf/JSON Schema)。**红线:不自造 wire/IDL。**

## 1. 目标终态(每类能力的归宿)

| 能力类 | 终态形态 | wire | 经 gate? | 前端怎么调 |
|---|---|---|---|---|
| **数据源**(vault/smart-table/notes/kv/embeddings/skills/providers/registry) | **§14 source**(describe/query/produce) | MCP 工具 | ✅ | `gate_invoke`(in-process) |
| **Effect**(subprocess/LLM 流/AI 列/OCR/image) | **§14 produce → Effect**(§14.9 OperationHandle) | MCP + 流 | ✅ | `gate_invoke` + 流订阅 |
| **流**(Irisy 回复/终端/进度) | `query{watch}` 投影 | **AsyncAPI** over WS/Channels | 授权回 gate | WS 订阅 |
| **外部 connector**(飞书/CRM…) | 挂载的 MCP source | MCP | ✅ | `gate_invoke` |
| **app-shell**(窗口/托盘/生命周期/agent 启停/keychain/config) | **Tauri command,合法 only**(非 §14,非双表面) | Tauri IPC | ❌(内核域/本地) | `invoke`(直接) |
| **跨设备/远程桌面** | ctrl-wire | **protobuf** over WebRTC | 授权回 gate | 独立模块 |

**关键终态机制 = `gate_invoke`**:前端调能力**不再各写一个 Tauri command**,而是经**一个**通用桥 `gate_invoke(tool, args)` → gate(**loopback HTTP**,非 in-process —— rmcp dispatch 需真 RequestContext/Peer,构造不干净;loopback 走真 gate = 治理一致非旁路)。这符合两信任域(**PWA 写 = 跨域,必经 gate**),且让 31 个 per-capability Tauri command **退面**。app-shell command 不走这条(它们是内核域/本地控制,合法保留)。
> **已落地(2026-06-24,`gate_invoke` 桥)**:`commands/gate.rs`,真 gate loopback,caller=`pwa`,审计已验证(e2e 测 audit_count↑)。**诚实缺口**:① pwa 路径只发 caller 不发 `X-Ctrl-Intent` → SC3 可见性裁剪对它**暂不生效**(得 SC1/2 审计+鉴权,未受 intent 裁剪;受信前端姿态,需最小权限时再 thread intent)② 每次调用一个 initialize+call 握手(2 loopback 往返),量大再做 session 复用 ③ **前端尚未迁到它、未退任何 command**(ratchet 仍 31)—— 退面 + 视觉验证 = 真机 app 闸的后续 flip。

## 2. 全量端点分类(188 = 54 MCP 工具 + 134 command,不漏)

> 这是迁移**范围**的真相:只有「数据源/Effect」是 §14 迁移目标;app-shell 合法保留;双表面只在能力类。

### A. 数据源 → §14 source(迁移目标,含 31 双表面大头)
- `vault::*`(28 command + 27 MCP 工具,**双表面**)→ **§14 vault source**:read/list/search/backlinks/tags/graph = `query`(含 `query{semantic}` 收 embeddings);write/rename/move/delete/create_folder/set_starred = `produce`。
- `smart_table::*`(3 双表面 + 9 MCP)→ **§14 smart-table source**(已是;query 核心刚收敛 `aa9dd11`)。
- `storage::*`(10:localstorage+cache)+ MCP `kv_*` → **§14 kv source**。
- `memory::*`(3:read_log/query/append)→ **§14 event-log source**。
- `vault_embeddings::*`(5)→ 收进 vault source 的 `query{semantic}` + reembed=produce/effect。
- `skills::*`(2)+ providers/registry(MCP §14 已只读)→ **§14 source**(skills/providers/registry query)。

### B. Effect → §14 produce-as-Effect(§14.9,第五 primitive)
- `code_space::*`(6:cs_spawn/stdin/signal/resize/kill/list)= subprocess Effect。
- `image_generate` / `screenshot`(OCR)/ `draft_run` / `smart_table_run_ai_column` = Effect。
- `chat_stream` / `irisy_chat_stream` = LLM 流 Effect(+ 缝⑥流)。

### C. 流 → AsyncAPI(缝⑥,SC6)
- `stss::*`(4:subscribe/publish/list_streams/get_bridge_token)→ **退役**,改 WS/Channels + AsyncAPI spec。

### D. app-shell / 生命周期 → Tauri command 合法保留(非 §14,非双表面)
- `system::*`(10:窗口/托盘/hide/grow/ollama)· `agents::*`(7:install/launch/stop/connect)· `hermes_acp::*`(2:ACP session,缝⑤)· `keychain::*`(3)· `config::*`(4)· `provider*::*`(9:provider 注册/catalog)· `kernel::*`(12:mcp install/run/manifest — mcp-bus 管理)· `git::*`(5)· `draft/workshop::*`(10:mcp-creator 创作流)· `irisy*::*`(synth/init)· `obsidian::*`(4:connector 生命周期)· `updater`。
- **这些没有 MCP 孪生 = 不是双表面**,§14 化它们 = 过度工程。**保留。**

> 诚实判断点:`kernel::*`(mcp 管理)、`provider::*`、`config::*` 介于「meta」与「能力」之间 —— registry/providers 的**读**已是 §14(registry_query/providers_query);install/run/set 是 produce/Effect,可后续收 §14,优先级低。

## 3. 迁移图(依赖排序,每阶段一 PR 串 + 可验证 exit + 计量器)

| 阶段 | 内容 | 现状→终态 | 可验证 exit | 计量器 |
|---|---|---|---|---|
| **A 地基** ✅ | gate 治理(SC1/2/3)+ 端点 spec 物化 + 棘轮 lint + ADR-010 v6 | 散 → 收口 | 已落地,测试绿 | — |
| **B 双表面退面**(核心「消双表面」) | ① `gate_invoke(tool,args)` 通用桥(in-process gate dispatch)② 前端 capability 调用迁到它(smart-table-gate-bridge / kernel.ts:`invoke('vault_*')`→`gateInvoke`)③ 退役 31 个 per-capability Tauri command | 31 双表面 → ~0 | 前端真机视觉不回归 + 棘轮基线 31→降 | **ratchet 31→↓** |
| **C §14 盖全**(契约统一) | A 类数据源 bespoke 工具 → describe/query/produce(vault read=query/write=produce + kv/memory/embeddings 收 source);共享核心范式(smart_table 已示范) | 39 bespoke → §14 | parity 测 + describe 自报 | **catalog bespoke 数↓** |
| **D 流形式化**(缝⑥,SC6 Phase 2) | ST-SS 活线 → WS/Channels;`query{watch}` 落地;**AsyncAPI spec** artifact | ST-SS → 标准流 | 前端流(终端/Irisy)视觉不回归 + AsyncAPI 文件存在 | ST-SS 退役 |
| **E 跨设备**(缝⑧) | 远程桌面 protobuf/WebRTC | 无 → 独立模块 | 独立目标,先专项调研 | — |

**顺序逻辑**:B 先于 C —— gate 已暴露这些工具(即便还 bespoke 形状),前端经 `gate_invoke` 即可退面、统一治理(都过 gate = 审计+可见性);§14 盖全(C)是契约优雅化,可在退面后做。D/E 并行可后置。

> **注**:刚做的 smart_table_query 共享核心(`aa9dd11`)= B/C 的预备(一个实现),但真正的 B 是 `gate_invoke` 桥 + 退面(降 ratchet)。

## 4. 现状 vs 终态(对图打勾)

- ✅ **A 地基全完**:两信任域类型 + 审计 ledger + 可见性裁剪 + projector stamp + 端点 spec(mcp-schema)+ 棘轮 + ADR-010 v6。
- 🔨 **B 退面**:未做。`gate_invoke` 桥未建,31 双表面在。(smart_table 已实现收敛一例)
- 🔨 **C §14 盖全**:1/40 模块深(smart-table)。39 bespoke 在。
- ⚠️ **D 流**:Phase 1 删死重 TS 包;活线 + AsyncAPI 未做。
- ⬜ **E 跨设备**:独立目标,未起。

**接口达产品标准 = B + C + D 做完**(E 独立)。

## 5. 不变项 / 红线

- **不自造 wire/IDL**(CORBA/SOAP/ESB 死因)—— 自创只 §14 SSOT + gate。
- **app-shell command 不 §14 化**(窗口/生命周期/keychain 合法 Tauri-only)。
- **棘轮只降不升**(`scripts/ratchet-dual-surface.mjs`,基线随退面降)。
- **端点 spec = 导出物**(`cargo run --bin dump_mcp_schema`),清单从它生成不爬源。
- **plain-text / vim-test / 本地是 truth**;**不动 spine 5 primitive**(Effect 启用非新增);**收敛不推倒**。

## 6. 下一步(执行本图)

**B 退面** 是最高价值(真降 ratchet + 统一治理 + 「前端经 gate」终态落地),但碰前端 + 需真机视觉验证。最小可验证起步 = **建 `gate_invoke` 桥 + 迁一个 capability(smart_table_query,已有共享核心)做范式 + 退它的 Tauri command(基线 31→30)**。
