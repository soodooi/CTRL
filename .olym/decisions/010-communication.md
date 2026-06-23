---
adr_id: 010
module: communication
title: CTRL communication architecture — 统一窄腰 (§14 契约 + :17873 治理 + MCP 插件协议) over 多元传输
version: 3
status: accepted
last_updated: 2026-06-22
deciders: [bao, zeus]
sections:
  - { id: positioning,       source: new-2026-06-22, note: "定位:CTRL = 普通用户的通用平台,不是 Claude Code 壳。协议服务平台/能力市场,coding 只是一类能力。" }
  - { id: diagnosis,         source: new-2026-06-22, note: "混乱真因 = P1 双表面 + P3 §14 没盖全,不是协议太多。" }
  - { id: waist,             source: new-2026-06-22, note: "北极星:统一窄腰(契约+治理+插件协议)+ 多元传输。质疑「一个框架统吃」= CORBA/SOAP/ESB 反模式。" }
  - { id: contract,          source: ref-002-§14, note: "契约面 = §14 三动词 describe/query/produce over Source;subscribe = query{watch} 投影(ADR-002 §14.7 v32),非第四动词。实现细则真相仍在 ADR-002 §14;本 ADR 统领。" }
  - { id: trust-domains,     source: new-2026-06-22-v3, note: "两信任域:内核域(channel/event 不经 gate)vs 跨域(必经 :17873);ST-SS 字节旁路但授权回 gate 补审计盲区。事实源 comms-architecture-permanent.md。" }
  - { id: governance,        source: ref-002-§mcp-bus, note: "治理面 = :17873 gate 单一收口(权限/审计/可见性)。真相在 ADR-002 § mcp-bus;本 ADR 定其在通讯架构中的枢纽地位。" }
  - { id: plugin,            source: new-2026-06-22, note: "插件协议 = MCP。能力插件 = MCP server,与 gate 同构;平台/市场底座。" }
  - { id: transports,        source: new-2026-06-22, note: "8 条缝多元传输选型表(每缝物理上对的协议)。" }
  - { id: internal-external, source: new-2026-06-22, note: "内部自研轻量(Tauri/actor/CBOR)/ 外部拥抱标准(MCP/ACP/A2A/AG-UI)。" }
  - { id: future,            source: new-2026-06-22, note: "WASM 插件 / A2A peer / AG-UI 对齐 / Beelay·Keyhive 均叠加在窄腰上,不替代。" }
changelog:
  - v3 2026-06-22: **与 ADR-002 §14.7 v32 对齐 + 新增 § trust-domains (永久架构定稿,事实源 `vault/ctrl/comms-architecture-permanent.md`).** 三处:(1) **subscribe 从「第四动词」改为「`query{watch}` 投影」** —— v2 把 subscribe 写成第四动词,与 ADR-002 §14.7 v32 的定稿冲突(§14.7: subscribe 不是新动词,是 query 的 watch 修饰,无流语义的源 registry/providers 天然不实现 = ISP)。动词集冻结在**三个** describe/query/produce;GraphQL Subscription 本质也是「按事件重跑的 query」,payload 走同一套 field-selection,故收编为 watch 修饰而非平级动词。(2) **NEW § trust-domains** —— 两个信任域:内核域(actor↔actor 走 channel/event,**不经 gate**,Erlang/OTP 零治理)vs 跨域(外部 agent/Irisy→工具/connector→第三方/PWA→写,**必经 :17873**);「内核自调也经 gate」是反模式,砍;用类型编码信任域让编译器挡误用。(3) **ST-SS 授权回笼补审计盲区** —— 流字节走 :17872 旁路 gate(性能),但 watch 订阅的**授权+审计元数据登记回 :17873**,gate 看得见/可撤销/脱敏每个 live 订阅。降级(connector 掉线→末次快照+degraded 标记)为契约一等公民,describe 自报。NOT 改 spine 5 primitive;NOT 推倒(收敛式)。
  - v2 2026-06-22: **调研校准 (deep-research workflow, 事实源 `vault/ctrl/research-protocol-2026.md`).** 多源(官方为主)印证 + 3 处与时俱进校准:(1) **MCP 已是 2026 行业收敛标准 + Linux Foundation Agentic AI Foundation 治理中立 (2025-12-09) + 2026 spec 长出 registry/auth/streaming** → 强化 § plugin / § governance(押在中立标准上,gate/市场发现/流可搭 MCP 演进)。(2) **seam ③ Irisy↔前端流**:AG-UI 是 agent↔UI 事实标准(17 typed events,LangGraph/CrewAI/CopilotKit 生态)→ ST-SS 从「自研够用」升为「**向 AG-UI event 词汇对齐**(token/tool-call/state-snapshot-delta)」,未来第三方 agent 框架流进 CTRL 前端时免费兼容。(3) **seam ④ 驱动 coding agent**:ACP 已成熟标准(Apache,JSON-RPC/stdio,ACP Registry 28+ agents 含 `claude --acp`/`codex acp`/`gemini-cli --acp`,跨编辑器采用)→ 从「future 假设」升为「**有据采用,一个 ACP client 驱动所有 BYO-CLI**」。(4) **seam ⑧ mesh**:Ink&Switch **Beelay + Keyhive**(Automerge 官方下一代 E2EE + capability sync,可跑任何机密传输)= 手搓 Olm 的 2026 继任者 → 列为演进跟踪项(现栈能跑,Automerge 已锁则迁移成本低)。
  - v1 2026-06-22: **NEW module ADR — 通讯协议架构 (bao 钦定「写新 ADR 重新整理思路」+ 方向校准「CTRL 是通用平台不是 Claude Code 壳」).** 把散落在 002 §14/§mcp-bus/§projection、001 §primitives、003 §6.5 的通讯决策抬成一个 cross-cutting module。核心:**统一窄腰(§14 四动词契约 + :17873 gate 治理 + MCP 插件协议)+ 多元传输**;质疑「一个框架统吃」为反模式(narrow-waist / CORBA·SOAP·ESB 教训 / MCP·A2A·ACP·AG-UI 官方「互补不竞争」)。新增 `subscribe` 第四动词(ST-SS 归位为其传输),实现细则待 002 §14 v32。「驱动外部 coding agent」从中心降为第⑦条外部缝(ACP,阶段 5)。号码:008/009 已 retired 占用,顺延 010。NOT 改 spine 5 primitive。
related:
  - .olym/decisions/001-spine.md       # § primitives (Channel/Event) + § layers + § byo-cli-driver
  - .olym/decisions/002-substrate.md   # §14 unified-operation-interface (契约真相源) + § mcp-bus (gate) + § projection + § crypto (mesh)
  - .olym/decisions/003-frontend.md    # §6.5 smart-table = §14 首个实现
  - vault/ctrl/research-protocol-2026.md  # 2026 竞品/协议深度调研(本 ADR 事实源)
---

# ADR-010 — communication(通讯协议架构)

> Cross-cutting module. 通讯决策原先散在 001/002/003 多个 §;本 ADR 把它们统一成一张「统管全局的规划图」(bao「系统设计先行」)。契约/治理的**实现真相**仍归 002 §14 / § mcp-bus / § crypto;本 ADR 是**总纲**(窄腰原则 + 传输选型 + 内外哲学),并引用它们,避免双真相源漂移(见 § Relationship)。2026 协议事实根基 = `vault/ctrl/research-protocol-2026.md`(deep-research,多源印证)。

## Context

bao 2026-06-22:「认真重构通讯协议」+「很多协议很乱,是否该统一在一个框架之下」+「写新 ADR 重新整理思路」+「调研充分:竞品、最新协议、与业务结合」。

**定位校准(决定一切取舍)**:CTRL **不是** 模仿 Claude Code 的壳,**不是** 驱动 coding agent 的工具。Claude 能调 MCP/CLI 只证明 CTRL 也具备这些底层能力 —— CTRL 的本质是**另一个商业模型 + 业务架构:为普通用户打造的通用平台**(按 Ctrl → 意图 → 1-3 能力模块;能力 = 可安装插件市场;Irisy 是 pipe;卖 substrate + 平台 + 工具,不卖模型)。

真实代码盘点:通讯分三层 —— L1 请求-响应(134 Tauri command + 58 MCP tool @:17873)/ L2 事件流(ST-SS = CBOR Cell/Op @:17872)/ L3 §14 四动词(4 source 已落地)+ mesh(WebRTC+Olm+Automerge+CBOR)+ cloud(outbound WSS)+ Irisy(OpenAI /v1 provider + 工具穿 gate + ST-SS,无自有协议)。

## Decision

### § positioning — 协议服务通用平台,不服务单一 agent
协议是底层,**普通用户永不碰协议**。协议成功标准 = 「任何能力(内置/第三方插件/连接器)以统一方式接入平台,Irisy 用同一套方式操作任何源,新能力实现一个契约即免费可用」。coding 是**第一类**验证此契约的能力,**不是中心**。

### § diagnosis — 混乱真因不是「协议太多」
真因二:**P1** 同能力两套表面(`vault.write` 既 Tauri command 又 MCP tool;134∩58 大量重叠,必漂移)+ **P3** §14 契约只盖 4 source。乱的是「缺统一契约面 + 治理面把线收口」,不是「线太多」。误读为「协议太多」→ 去找「一个框架统吃」= 开错药。

### § waist — 北极星:统一窄腰,多元传输
**质疑「一个框架统吃所有通讯层」= 架构史反复证伪的反模式**:① 互联网是 narrow-waist(只统一 IP,上下多元;RFC 3439)② CORBA/SOAP·WS-\*/ESB 死于中心化复杂度 + 最低公分母 + 厂商绑定 ③ 2026 agent 协议(MCP/A2A/ACP/AG-UI)官方均称「互补、非竞争」(调研多源印证),连 Linux Foundation 都不合并它们。

**得体的统一发生在契约/治理/插件面,不在传输协议**(service mesh control/data plane 分离、API gateway、GraphQL 统一查询面皆此模式)。

```
   统一窄腰(收紧这里 = 消除混乱):
     ① 契约面 = §14 三动词 describe/query/produce over Source(subscribe = query{watch} 投影)
     ② 治理面 = :17873 gate(权限/审计/可见性单一收口;仅守跨域,内核域直连)
     ③ 插件协议 = MCP(能力插件 = MCP server)
   ──────────────────── 上下都挂窄腰 ────────────────────
   多元传输(分层,非混乱):前后端 Tauri IPC/WS · 模块间 actor ·
   流 ST-SS/CBOR(向 AG-UI 对齐)· 插件/连接器/对外 MCP · 外部 coding agent ACP · 跨设备 mesh
```
**CTRL 已有这个窄腰**(§14 + gate),只是没收紧。重构 = 收紧窄腰 + 渐进收编,**不推倒**(134+58 在用)。

### § contract — 契约面(§14 三动词,subscribe = query{watch} 投影)
唯一「能力语义」真相,与传输无关,**动词集冻结在三个**:`describe`(自报字段+算子+record/stream 形态 + 降级行为,防幻觉)/ `query`(读快照,并行;`watch:true` 修饰 → 订阅实时流,ST-SS 为其传输)/ `produce`(写/动作,串行,过 review gate)。

**subscribe 不是第四动词**(ADR-002 §14.7 v32):它是 `query` 的 `watch` 投影 —— 源解析快照后 gate 推增量。理由 = ISP:无流语义的源(registry/providers)`describe` 报 `watchable:false`,天然不实现,不被迫写空实现/panic。GraphQL Subscription 本质也是「按事件重跑的 query」,payload 走同一套 field-selection,故 CTRL 收编为 watch 修饰而非平级动词(语义维度 vs 传输维度正交)。**实现细则真相归 ADR-002 §14**。

### § governance — 治理面(:17873 gate)
所有跨边界调用(普通用户操作 / Irisy 调用 / 外部 agent 回流 / 插件调用)收口于 gate = 权限 + 审计 + 可见性 = 普通用户敢用的安全保证 + 商业审计基础 + 护城河。真相在 ADR-002 § mcp-bus。**调研印证**:MCP 2026 长出 enterprise auth + server registry,gate 可搭其演进(`research-protocol-2026.md` §一)。

### § trust-domains — 两个信任域、一条 gate(v3 新增)
gate 只守**跨域**,不守全部 —— 这是 v2 没切清的边界(把「所有调用经 gate」写成笼统收口,会让内核自调也付治理成本 + 单点,或被迫开 internal bypass = 带后门的收口)。

- **内核域(trusted)**:actor↔actor 走 `channel`/`event`(ADR-001 § primitives),**不经 gate** —— Erlang/OTP 模型,进程内消息、失败隔离、零治理开销。
- **跨域(untrusted)**:任何跨信任边界(外部 agent / Irisy→工具 / connector→第三方 / PWA→写操作)**必经 :17873** 鉴权+审计+可见性。
- **内核自调经 gate = 反模式,砍**。用类型系统编码信任域(内核域走 channel 类型,跨域走 gate 类型),让编译器挡误用。
- **ST-SS 字节旁路、授权回笼**(补 v2 审计盲区):watch 订阅的流数据走 :17872 不阻塞,但 **session 授权 + 审计元数据登记回 :17873** —— gate 看得见/可撤销/脱敏每个 live 订阅,即便不在热字节路径上。
- **降级是契约一等公民**:watch 丢源(connector 掉线)→ 降级到末次快照 + `degraded` 标记,不 hard-fail;`describe` 自报降级行为(local-first:本地 truth / 云 mirror / 拔网可用)。

> 完整四维正交框架(What/How/Who/When-broken)+ 窄腰沙漏图 + 读写物理分离(QuerySource 读 / produce 写)的代码校准:`vault/ctrl/comms-architecture-permanent.md`。

### § plugin — 插件协议(MCP)
**能力插件 = 一个 MCP server**(本地 stdio / 远程 Streamable HTTP),内核当 host 经 gate 发现 + 审计。**调研强化**:MCP 是 2026 行业收敛标准(Claude/ChatGPT/VS Code/Goose 全讲 MCP),且 2025-12-09 捐入 **Linux Foundation Agentic AI Foundation**(厂商中立)。与 gate **零新增同构**、进程隔离沙箱、语言无关、生态最大。**平台 + 能力市场底座**。

### § transports — 8 条缝传输选型
| # | 接缝 | 最终协议 | 2026 调研判断 | 现用/未来 |
|---|---|---|---|---|
| ① | 前端 ↔ 后端 | Tauri IPC(桌面)+ WS+token(浏览器),tauri-specta 自动导出 TS 类型 | 双壳同源 | 现用 |
| ② | 模块 ↔ 模块 | tokio actor(ractor/kameo)+ bounded mpsc/broadcast(CQRS) | 松耦合+可审计 | 现用 |
| ③ | Irisy ↔ 前端流 | **ST-SS(CBOR Cell/Op)→ 向 AG-UI event 词汇对齐** | AG-UI = agent↔UI 事实标准(17 events);ST-SS 对齐 = 设计原则,未来接第三方 agent 框架免费兼容 | 现用 ST-SS;对齐 AG-UI |
| ④ | 能力插件接入 | **MCP server**(经 gate) | 行业收敛 + LF 中立 + registry | 现用 |
| ⑤ | 第三方 app | **MCP**(连入官方 server / CTRL 当 MCP server 对外) | SaaS 出官方 MCP 成主流 | 现用 |
| ⑥ | 流底座 | **ST-SS(CBOR)** = `query{watch}` 的传输(授权回 :17873) | watch 投影落地,非新动词 | 阶段 1 |
| ⑦ | 外部 coding agent | MCP 喂养(已通)+ **ACP 驱动** | ACP 已成熟标准,Registry 28+,一个 client 驱动所有 BYO-CLI(`claude --acp` 等) | 阶段 5 |
| ⑧ | 跨设备 mesh | WebRTC + Olm + Automerge + CBOR **→ 跟踪 Beelay/Keyhive** | Beelay/Keyhive(Ink&Switch)= Automerge 官方下一代 E2EE+capability sync,胜过手搓 Olm | 现用现栈;Beelay/Keyhive=演进跟踪 |

### § internal-external — 内外协议哲学不同,别混
- **内部**(①②⑥)= 自研轻量(两端自控、local-first、vim-test);类型安全交给「Rust 当权威源自动导出」,不交给跨语言 IDL;**不引入重 codegen(Protobuf/gRPC/Cap'n Proto)**。
- **外部**(③④⑤⑦)= 拥抱标准(要跟别人家 agent/SaaS 互通)。
- 混了就是债:给内部套 MCP = 过度工程;给外部继续自研 = 闭门造车。
- 注:③ 横跨内外 —— 内部用 ST-SS 实现,但**词汇向 AG-UI 标准对齐**,兼得轻量与未来互通。

### § future — 叠加档(不替代窄腰)
WASM Component Model/Extism(高频·强沙箱不可信插件)· A2A Agent Card(CTRL 当自治 peer agent,对应 share-and-be-shared)· AG-UI 完整采用(若开放第三方 agent 入前端)· **Beelay/Keyhive**(Automerge 原生 E2EE+capability sync,取代手搓 Olm)。均叠加在 MCP/§14 窄腰上。

## Acceptance

- [x] 通讯架构有单一「统管全局」总纲(本 ADR),决策不再散在 001/002/003。
- [x] 窄腰三件明确:契约(§14 三动词 describe/query/produce,subscribe = query{watch})+ 治理(:17873 gate,仅守跨域)+ 插件协议(MCP)。
- [x] 8 条缝各有明确最终协议(§ transports)+ 内外哲学分离声明(§ internal-external)。
- [x] 与 002 §14 / § mcp-bus / § crypto 的真相边界写清(§ Relationship),无双真相源。
- [x] 「驱动 Claude Code」定位为第⑦条外部缝、非中心,符合「通用平台」校准。
- [x] 2026 协议选型有深度调研事实根基(`research-protocol-2026.md`,多源 + 对抗验证),3 处校准(AG-UI 对齐 / ACP 有据采用 / Beelay 跟踪)已并入。
- [x] 不改 spine 5 primitive;不推倒 134 Tauri + 58 MCP(收敛式)。

> 实装进度(query{watch} 落地 / 消双表面 / 插件协议落地 / ACP / AG-UI 对齐)属 § Roadmap,**非本 Acceptance 勾选项**(避免阻塞 release.sh;逐阶段以各模块 ADR amendment + 代码验证收口)。

## Roadmap(收敛式,一阶段一 PR + 测试;非 checkbox)

0. **锚定** — 本 ADR(已)+ ADR-002 §14.7 v32(subscribe = query{watch},已 amend)+ comms-architecture-permanent.md(永久设计定稿,已)。
1. **契约盖全** — `query` 加 `watch` 修饰落地;`describe` 声明 stream 形态 + `watchable` + 降级行为;ST-SS 为 watch 传输 + 授权回 :17873(§ trust-domains)+ 词汇向 AG-UI 对齐。
2. **消双表面** — vault 52 命令 → 三动词(读走 query、CRUD 收进 produce action),一个 Source 实现一次 → 三传输自动暴露(派生宏 + 棘轮 lint),parity 测试后旧表面退役。
3. **插件协议确立** — 能力插件 = MCP server 写成平台契约 + 参照实现 + 发现/审计闭环。
4. **类型真相自动化** — tauri-specta/ts-rs 从 Rust 导出 TS,消前后端漂移。
5. **外部驱动** — coding 缝补 ACP(对接 ACP Registry 生态:claude --acp 等;diff/permission/流式 turn = 提议-批准)。
- **Future** — WASM 插件 / A2A peer / AG-UI 完整采用 / Beelay·Keyhive 迁移,按需叠加。

## Relationship to other ADRs(避免漂移)

| 真相项 | 真相源 | 本 ADR 的角色 |
|---|---|---|
| 三动词实现细则(QuerySource 读 / produce 写 / RecordSource / 算子) | **ADR-002 §14** | 引用 + 统领;subscribe = query{watch} 已落 §14.7 v32 |
| :17873 gate 实现 | **ADR-002 § mcp-bus** | 定其枢纽地位 |
| projection(资产投影外部 CLI) | **ADR-002 § projection** | 归入 ⑦ 外部缝语境 |
| mesh 加密/CRDT(Olm/Automerge/WebRTC) | **ADR-002 § crypto** | ⑧ 缝;Beelay/Keyhive 演进跟踪 |
| 5 primitive(Actor/Capability/Event/Channel/Effect) | **ADR-001 § primitives** | 不改;② 缝传输落其上 |
| smart-table = §14 首实现 | **ADR-003 §6.5** | 引为 record source 参照 |
| BYO-CLI driver(驱动外部 CLI) | **ADR-001 § byo-cli-driver** | ⑦ 缝;ACP 是其传输升级 |

本 ADR 只拥有**通讯总纲**(窄腰原则 + 传输选型 + 内外哲学);上述实现真相不复制进本文,只引用。
