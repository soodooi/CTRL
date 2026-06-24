---
adr_id: 010
module: communication
title: CTRL communication architecture — 统一窄腰 (§14 契约 + :17873 治理 + MCP 插件协议) over 多元传输
version: 6
status: accepted
last_updated: 2026-06-24
deciders: [bao, zeus]
sections:
  - { id: positioning,       source: new-2026-06-22, note: "定位:CTRL = 普通用户的通用平台,不是 Claude Code 壳。协议服务平台/能力市场,coding 只是一类能力。" }
  - { id: diagnosis,         source: new-2026-06-22, note: "混乱真因 = P1 双表面 + P3 §14 没盖全,不是协议太多。" }
  - { id: waist,             source: new-2026-06-22, note: "北极星:统一窄腰(契约+治理+插件协议)+ 多元传输。质疑「一个框架统吃」= CORBA/SOAP/ESB 反模式。" }
  - { id: contract,          source: ref-002-§14, note: "契约面 = §14 三动词 describe/query/produce over Source;subscribe = query{watch} 投影(ADR-002 §14.7 v32),非第四动词。实现细则真相仍在 ADR-002 §14;本 ADR 统领。" }
  - { id: trust-domains,     source: new-2026-06-22-v3, amended: v5-2026-06-23, note: "两信任域:内核域(channel/event 不经 gate)vs 跨域(必经 :17873)。v5 实装锚点:SC1/2/3 已落地(audit.rs TrustDomain+ledger / visibility.rs intent 投影 / projector.rs stamp / mcp_server.rs gate 强制)。事实源 comms-architecture-permanent.md + comms-interface-spec.md。" }
  - { id: governance,        source: ref-002-§mcp-bus, note: "治理面 = :17873 gate 单一收口(权限/审计/可见性)。真相在 ADR-002 § mcp-bus;本 ADR 定其在通讯架构中的枢纽地位。" }
  - { id: plugin,            source: new-2026-06-22, note: "插件协议 = MCP。能力插件 = MCP server,与 gate 同构;平台/市场底座。" }
  - { id: transports,        source: new-2026-06-22, amended: v5-2026-06-23, note: "8 条缝多元传输选型表。v5:③⑥ ST-SS 弃用→Tauri Channels+WS(SC6 实施);⑧ 远程桌面转独立能力模块(对标 ToDesk/RustDesk)。" }
  - { id: internal-external, source: new-2026-06-22, amended: v5-2026-06-23, note: "内部自研轻量(Tauri/actor/CBOR)/ 外部拥抱标准(MCP/ACP/A2A/AG-UI)。v5 调研修正:二进制流帧走 Channels 原生,protobuf 仅 scope 跨设备腿;单一 wire 横跨本机+跨设备=未验证赌注。" }
  - { id: future,            source: new-2026-06-22, note: "WASM 插件 / A2A peer / AG-UI 对齐 / Beelay·Keyhive 均叠加在窄腰上,不替代。" }
  - { id: endpoint-spec,     source: new-2026-06-24-v6, note: "端点 spec = 形式化机器可读契约,不自造 IDL:wire 标准点名(工具=MCP JSON-RPC+JSON Schema / 流=AsyncAPI / 跨设备=protobuf);权威端点 spec = MCP tools/list schema 导出 artifact + §14 describe schema;catalog 从 schema 生成不爬源。补「协议无物化端点 spec」欠账。" }
changelog:
  - v6 2026-06-24: **NEW § endpoint-spec — 端点 spec 形式化 + wire 标准点名(补「协议无物化端点 spec」欠账).** bao 质疑「完整通讯协议难道不含端点?有没有规范?是没按规范走还是不会建?」—— 调研核实(OpenAPI/AsyncAPI/gRPC-protobuf/GraphQL-SDL/MCP 均形式化定义端点;MCP 2026 spec 的 tool inputSchema/outputSchema = JSON Schema 2020-12)后诚实定性:**CTRL wire 层按 MCP 走了(54 工具经 rmcp 宏自带 JSON Schema),但从没把端点 spec 物化成版本化 artifact;§14 停在散文;流/command 面零形式化;端点清单靠爬 Rust 源(= 症状:spec 不是 artifact)**。三处 amend:(1) **NEW § endpoint-spec** —— 协议 = 语义契约 SSOT + 每缝标准 wire + 治理门;**wire 标准点名**:工具调用=MCP(JSON-RPC + JSON Schema,`tools/list` = 端点 spec)/ 流=AsyncAPI describe over WS·Channels / 跨设备=protobuf over WebRTC;**绝不自造 wire/IDL**(CORBA/SOAP/ESB 死因);**权威端点 spec = MCP `tools/list` JSON Schema 导出 artifact + §14 `describe` schema**,catalog 从 schema 生成不爬源;§14.10 版本协商→gate 按 protocol_version 路由(spec 有,实装待)。(2) **§ internal-external 补**:三 wire 标准映射 8 缝 + 「标准 ~90% / 自创 ~10%(只 §14 SSOT + gate 治理,无标准覆盖故正当)」配比。(3) **§ transports 表加 wire 标准列**。事实源:本轮 WebSearch(OpenAPI/AsyncAPI/MCP spec)+ `vault/ctrl/endpoint-catalog.md`(auto-gen 清单暴露 39 bespoke + 31 双表面)。NOT 改三动词集;NOT 自造协议;收敛不推倒。
  - v5 2026-06-23: **实装对齐 + ST-SS 弃用决策入册(通讯重构 SC1-3 已落地 + 调研修正).** 五处 amend,与运行真相对齐(CLAUDE.md「ADR 跟实装不允许漂移」):(1) **§ trust-domains 实装锚点** — 两信任域类型脊 + gate 治理面已落地:`kernel/audit.rs`(`TrustDomain{Internal,External}` + sha256 args-hash 守数据主权只存 hash + `record_call` 审计 ledger,SC1/SC2)· `kernel/visibility.rs`(intent-scoped 工具投影,SC3)· `kernel/projector.rs`(BYO-CLI `.mcp.json` stamp `X-Ctrl-Caller`+`X-Ctrl-Intent`,SC3 闭环)· gate `mcp_server.rs`(`request_header` 读 caller/intent、`list_tools` 裁剪、`call_tool` 记真实 caller + 拒越域 outcome=denied)。诚实缺口:`InternalMsg ⊥ GateRequest` 编译期隔离仍是运行时 tag(SC1 完整体待)。(2) **§G 可见性裁剪 = 已落地**(原 v4 标「治理半成品 TODO」→ 现实装 caller 细分 + intent 投影 + projector 默认 stamp,默认 scope 排除 `net`/`mcp` 守数据主权护城河,env `CTRL_BYO_INTENT` 逃生舱)。(3) **§ transports ③⑥ ST-SS 弃用**(bao 钦定)— ST-SS 是单向语义广播(设计上 no input plane / no remote viewing,做不了多端远程控制);本机 kernel→PWA 流底座改 **Tauri Channels(原生二进制)+ 最简 WS**,非 ctrl-wire;AG-UI 从「词汇对齐」升「producer 兼容机会」。实施 = SC6(Roadmap),决策已定故入册。(4) **§ transports ⑧ + § internal-external 调研修正** — 二进制流帧走 Tauri Channels 原生路径,**protobuf 仅 scope 跨设备腿**;「单一 wire 横跨本机 IPC + 跨设备 P2P」= 零先例未验证赌注 → 正解 = **三动词语义契约 = SSOT + wire framing 按传输适配**。(5) **远程桌面转正为独立能力模块** — 对标 ToDesk/RustDesk(ctrl-wire protobuf over WebRTC + content-blind relay),⑧ 缝留口,远控腿待专项调研(独立目标,不阻塞本重构)。事实源 `vault/ctrl/comms-interface-spec.md` §4。NOT 改 spine 5 primitive;NOT 改三动词集;收敛不推倒。
  - v4 2026-06-22: **§ deepening — 批判性自审补四点 D/E/G/H (事实源 `vault/ctrl/comms-architecture-permanent.md` §10).** 窄腰骨架不动,补四个总纲级洞:(D) **跨源组合归上层** —— 关联/Lookup/Rollup 在上层 (Irisy/feature pack) 用 DataLoader 模式 (N 次单源 query + 内存 join),守「禁跨 D1 JOIN」+ Source 单一职责,与 ADR-002 v30 关系型字段切片对齐。(E) **gate 自身降级 + 背压** —— gate 故障时只读本地 query 降到内核域待遇直通 (本地是 truth),write/effect 必须等 gate;bounded queue + circuit breaker 防堆积。(G) **可见性裁剪 × intent-scoped projection** —— gate 按 (caller, intent) 投影可见子集 = 「按 Ctrl → 意图 → 1-3 能力模块」的实现,补 TODO 的治理半成品 (capability-based 最小暴露面)。(H) **mesh 跨设备三动词成立性** —— mesh = 传输+一致性层非腰外世界,三动词投影到 CRDT:跨设备 query=最终一致快照、produce=Automerge change 本地立即生效+异步合并 peer、degradation=LocalWins,Beelay/Keyhive capability sync 对接 gate capability-token。配套契约层 A/B/C/F 进 ADR-002 §14 v33 (§14.8-§14.11)。NOT 改动词集;NOT 改 spine 5 primitive (启用 Effect)。
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

真实代码盘点(v1 写时快照;v5 起 ST-SS 弃用,流改 Tauri Channels + WS):通讯分三层 —— L1 请求-响应(134 Tauri command + 58 MCP tool @:17873)/ L2 事件流(ST-SS = CBOR Cell/Op @:17872)/ L3 §14 四动词(4 source 已落地)+ mesh(WebRTC+Olm+Automerge+CBOR)+ cloud(outbound WSS)+ Irisy(OpenAI /v1 provider + 工具穿 gate + ST-SS,无自有协议)。

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
   流 Channels+WS(向 AG-UI 对齐;ST-SS 弃用 v5)· 插件/连接器/对外 MCP · 外部 coding agent ACP · 跨设备 mesh
```
**CTRL 已有这个窄腰**(§14 + gate),只是没收紧。重构 = 收紧窄腰 + 渐进收编,**不推倒**(134+58 在用)。

### § contract — 契约面(§14 三动词,subscribe = query{watch} 投影)
唯一「能力语义」真相,与传输无关,**动词集冻结在三个**:`describe`(自报字段+算子+record/stream 形态 + 降级行为,防幻觉)/ `query`(读快照,并行;`watch:true` 修饰 → 订阅实时流,传输 = Tauri Channels + WS,v5 起;原 ST-SS 弃用)/ `produce`(写/动作,串行,过 review gate)。

**subscribe 不是第四动词**(ADR-002 §14.7 v32):它是 `query` 的 `watch` 投影 —— 源解析快照后 gate 推增量。理由 = ISP:无流语义的源(registry/providers)`describe` 报 `watchable:false`,天然不实现,不被迫写空实现/panic。GraphQL Subscription 本质也是「按事件重跑的 query」,payload 走同一套 field-selection,故 CTRL 收编为 watch 修饰而非平级动词(语义维度 vs 传输维度正交)。**实现细则真相归 ADR-002 §14**。

### § governance — 治理面(:17873 gate)
所有跨边界调用(普通用户操作 / Irisy 调用 / 外部 agent 回流 / 插件调用)收口于 gate = 权限 + 审计 + 可见性 = 普通用户敢用的安全保证 + 商业审计基础 + 护城河。真相在 ADR-002 § mcp-bus。**调研印证**:MCP 2026 长出 enterprise auth + server registry,gate 可搭其演进(`research-protocol-2026.md` §一)。

### § trust-domains — 两个信任域、一条 gate(v3 新增)
gate 只守**跨域**,不守全部 —— 这是 v2 没切清的边界(把「所有调用经 gate」写成笼统收口,会让内核自调也付治理成本 + 单点,或被迫开 internal bypass = 带后门的收口)。

- **内核域(trusted)**:actor↔actor 走 `channel`/`event`(ADR-001 § primitives),**不经 gate** —— Erlang/OTP 模型,进程内消息、失败隔离、零治理开销。
- **跨域(untrusted)**:任何跨信任边界(外部 agent / Irisy→工具 / connector→第三方 / PWA→写操作)**必经 :17873** 鉴权+审计+可见性。
- **内核自调经 gate = 反模式,砍**。用类型系统编码信任域(内核域走 channel 类型,跨域走 gate 类型),让编译器挡误用。
- **跨域流授权回笼**(补 v2 审计盲区):watch 订阅的流字节走旁路不阻塞,但 **session 授权 + 审计元数据登记回 :17873** —— gate 看得见/可撤销/脱敏每个 live 订阅,即便不在热字节路径上。(注:v5 起流底座从 ST-SS 改 Tauri Channels + WS,见 § transports;授权回笼原则不变,只换传输。)
- **降级是契约一等公民**:watch 丢源(connector 掉线)→ 降级到末次快照 + `degraded` 标记,不 hard-fail;`describe` 自报降级行为(local-first:本地 truth / 云 mirror / 拔网可用)。

#### 实装锚点(v5,通讯重构 SC1-3 已落地)

本节原则已落地为代码,ADR↔实装对齐(CLAUDE.md「ADR 跟实装不允许漂移」):

| 块 | 代码落点 | SC |
|---|---|---|
| 两信任域类型 + 数据主权 hash | `kernel/audit.rs` — `TrustDomain {Internal,External}` + `hash_args`(sha256,只存 hash 不存全量 args)+ `normalize_caller`(`X-Ctrl-Caller` 净化 `[a-z0-9._-]`≤64) | SC1 |
| gate 审计 ledger | `persistence.rs` `audit_calls` 表 + `record_call`;gate `call_tool` best-effort 记每个跨域调用(caller/tool/args-hash/outcome/ts,内核自调不记;ledger 写失败只 warn 不阻断) | SC2 |
| intent 可见性裁剪 | `kernel/visibility.rs` — `tool_domain` 域分类器 + `Intent`(按 `X-Ctrl-Intent` 逗号域投影,缺省 unscoped,`system` 常驻);gate `list_tools` scoped 时过滤 + `call_tool` 拒越域(outcome `denied`,隐藏的也不可调) | SC3 |
| 外部 CLI 默认受裁 | `kernel/projector.rs` — BYO-CLI `.mcp.json` 的 `headers` stamp `X-Ctrl-Caller: byo-cli` + `X-Ctrl-Intent: <默认 scope>`(排除 `net` 外泄面 / `mcp` 透传;env `CTRL_BYO_INTENT` 逃生舱) | SC3 |

**诚实缺口**:`InternalMsg ⊥ GateRequest` 的**编译期**隔离尚未做 —— 现为运行时 `TrustDomain` tag(gate 记录 + caller 细分),编译器强制「内核自调误经 gate」是 SC1 完整体,待后续。真机 `:17873` curl smoke 待 app build(in-process reqwest→真 axum listener 的 `intent_header_scopes_tools_list` e2e 已覆盖 header→Parts→context 穿线)。

> 完整四维正交框架(What/How/Who/When-broken)+ 窄腰沙漏图 + 读写物理分离(QuerySource 读 / produce 写)的代码校准:`vault/ctrl/comms-architecture-permanent.md`。每缝接口契约 + 对标背书:`vault/ctrl/comms-interface-spec.md`。

### § plugin — 插件协议(MCP)
**能力插件 = 一个 MCP server**(本地 stdio / 远程 Streamable HTTP),内核当 host 经 gate 发现 + 审计。**调研强化**:MCP 是 2026 行业收敛标准(Claude/ChatGPT/VS Code/Goose 全讲 MCP),且 2025-12-09 捐入 **Linux Foundation Agentic AI Foundation**(厂商中立)。与 gate **零新增同构**、进程隔离沙箱、语言无关、生态最大。**平台 + 能力市场底座**。

### § transports — 8 条缝传输选型
| # | 接缝 | 最终协议 | 2026 调研判断 | 现用/未来 |
|---|---|---|---|---|
| ① | 前端 ↔ 后端 | Tauri IPC(桌面)+ WS+token(浏览器),tauri-specta 自动导出 TS 类型 | 双壳同源 | 现用 |
| ② | 模块 ↔ 模块 | tokio actor(ractor/kameo)+ bounded mpsc/broadcast(CQRS) | 松耦合+可审计 | 现用 |
| ③ | Irisy ↔ 前端流 | **Tauri Channels(原生二进制)+ 最简 WS;ST-SS 弃用(v5)** | bao 钦定 ST-SS 全量停用(单向语义广播,no input plane,做不了多端远控);流底座改 Channels 原生二进制路径,词汇向 **AG-UI**(producer 兼容机会,17 events)对齐 | SC6 实施;弃用决策已定 |
| ④ | 能力插件接入 | **MCP server**(经 gate) | 行业收敛 + LF 中立 + registry | 现用 |
| ⑤ | 第三方 app | **MCP**(连入官方 server / CTRL 当 MCP server 对外) | SaaS 出官方 MCP 成主流 | 现用 |
| ⑥ | 流底座 | **Tauri Channels + WS** = `query{watch}` 的传输(授权回 :17873);ST-SS 弃用(v5) | watch 投影落地,非新动词;Channels 原生二进制,授权回笼原则不变只换传输 | SC6 |
| ⑦ | 外部 coding agent | MCP 喂养(已通)+ **ACP 驱动** | ACP 已成熟标准,Registry 28+,一个 client 驱动所有 BYO-CLI(`claude --acp` 等) | 阶段 5 |
| ⑧ | 跨设备 mesh + **远程桌面(独立能力模块)** | WebRTC + Olm + Automerge + CBOR **→ 跟踪 Beelay/Keyhive**;远控线 = ctrl-wire protobuf over WebRTC + content-blind relay | Beelay/Keyhive(Ink&Switch)= Automerge 官方下一代 E2EE+capability sync,胜过手搓 Olm;**远程桌面对标 ToDesk/RustDesk = 独立能力模块,本通讯重构只留口,远控腿待专项调研** | 现用现栈;远程桌面=独立目标 |

> **v5 修正(调研)**:二进制流帧走 Tauri Channels 原生路径(非 ctrl-wire),**protobuf 仅 scope 跨设备腿(⑧)**;「单一 wire 横跨本机 IPC + 跨设备 P2P」**零先例 = 未验证赌注** → 正解 = **三动词语义契约 = SSOT(有先例),wire framing 按传输适配**。事实源 `vault/ctrl/comms-interface-spec.md` §1·§4。

> **v6 wire 标准(点名,见 § endpoint-spec)**:工具缝③④⑤⑦ = **MCP**(JSON-RPC + JSON Schema,`tools/list` = 端点 spec)· 流缝①⑥ = **AsyncAPI** describe over WS/Channels · 跨设备⑧ = **protobuf**。端点 spec = MCP schema 导出 artifact,不自造 IDL,catalog 从 schema 生成不爬源。

### § internal-external — 内外协议哲学不同,别混
- **内部**(①②⑥)= 自研轻量(两端自控、local-first、vim-test);类型安全交给「Rust 当权威源自动导出」,不交给跨语言 IDL;**不引入重 codegen(Protobuf/gRPC/Cap'n Proto)做内部流**。二进制流帧走 **Tauri Channels 原生路径**(v5 调研:无一手背书 protobuf 作内部流 SSOT;Channels 已原生二进制)。
- **外部**(③④⑤⑦)= 拥抱标准(要跟别人家 agent/SaaS 互通)。
- **跨设备腿(⑧)= protobuf 唯一 scope** —— 只有跨设备 ctrl-wire 才需要稳定跨进程/跨机 schema,protobuf 限定在这条腿,不外溢到本机 IPC。
- 混了就是债:给内部套 MCP = 过度工程;给外部继续自研 = 闭门造车。
- 注:③ 横跨内外 —— 内部用 **Channels + WS**(v5 起,原 ST-SS 弃用),词汇向 **AG-UI 标准对齐**,兼得轻量与未来互通。
- **反赌注(v5)**:「单一 wire 横跨本机 IPC + 跨设备 P2P」= 零先例,不赌 —— **统一的是三动词语义契约(SSOT,有先例),wire framing 按传输各自适配**。

### § endpoint-spec — 端点 spec 形式化 + wire 标准点名(v6 新增)

> bao 质疑(2026-06-24):「完整通讯协议难道不含端点?有没有规范?是没按规范走还是不会建?」—— 戳中真欠账。调研核实(OpenAPI/AsyncAPI/gRPC-protobuf/GraphQL-SDL/MCP 都**形式化定义端点**;MCP 2026 spec 的 tool inputSchema/outputSchema = **JSON Schema 2020-12**)。

**诚实定性**:CTRL **wire 层按 MCP 走了**(54 gate 工具经 rmcp `#[tool]` 宏自带 JSON Schema,`tools/list` 返回 name+description+inputSchema),**但**:① 端点 spec 从没**物化**成版本化 artifact(埋在 Rust 宏);② §14 停在**散文**(ADR 里架构思路,非形式化 IDL);③ 流缝 / 134 Tauri command 面**零形式化**;④ 端点清单靠**爬 Rust 源**拼(`endpoint-catalog.md`)= 症状:spec 不是 artifact。

**协议模型(三层,收紧 v1-v5):**

```
① 语义契约 (SSOT,唯一) = §14 describe/query/produce   ← 形式化成 schema,非散文
        │ 实现一次
        ├─ 工具调用  → MCP (JSON-RPC + JSON Schema;tools/list = 端点 spec)   缝③④⑤⑦
        ├─ 实时流    → AsyncAPI describe over WS/Tauri Channels (Cell/Op)     缝①⑥
        └─ 跨设备    → protobuf over WebRTC + E2EE                           缝⑧
        每个跨域调用 ↓
② 治理门 (唯一收口) = :17873 gate:鉴权/审计/可见性裁剪/写审批   ← 护城河,标准里没有
```

**定案:**
1. **wire 标准点名,绝不自造 wire/IDL**(CORBA/SOAP/ESB 死因):工具=**MCP**(JSON-RPC + JSON Schema)/ 流=**AsyncAPI**(event-driven,OpenAPI 描述不了)/ 跨设备=**protobuf**(唯一需稳定跨机 schema 的腿)/ 端点类型=**JSON Schema**。
2. **权威端点 spec = 导出物,不是另写的东西** = MCP **`tools/list` 的 JSON Schema dump**(版本化 artifact)+ **§14 `describe` 的 schema**。**catalog 从此 schema 生成,不再爬源码。**
3. **§14.10 版本协商**(spec 已写)→ gate 按 `protocol_version` 路由/降级(实装待)。
4. **标准 ~90% / 自创 ~10%**:标准 = MCP + AsyncAPI + protobuf + JSON Schema(别自造);自创 = **§14 语义 SSOT + :17873 治理门**——这两块**无现成标准覆盖**(没有标准做「content-type 无关统一操作接口 + 治理门」),自创正当;**红线 = 不自造 wire/IDL**。

> 完整协议 = 语义契约 SSOT(形式化)+ 三标准 wire 分缝 + 治理门 + **物化端点 spec**。**接口达产品标准 = 端点 spec 物化 + §14 盖全(迁 39 bespoke)+ SC5 消双表面(31 重叠)。** 事实源:WebSearch(OpenAPI/AsyncAPI/MCP spec)+ `vault/ctrl/endpoint-catalog.md` + `vault/ctrl/comms-interface-spec.md`。

### § future — 叠加档(不替代窄腰)
WASM Component Model/Extism(高频·强沙箱不可信插件)· A2A Agent Card(CTRL 当自治 peer agent,对应 share-and-be-shared)· AG-UI 完整采用(若开放第三方 agent 入前端)· **Beelay/Keyhive**(Automerge 原生 E2EE+capability sync,取代手搓 Olm)。均叠加在 MCP/§14 窄腰上。

### § deepening — 批判性自审补四点(v4;事实源 `vault/ctrl/comms-architecture-permanent.md` §10 D/E/G/H)

窄腰骨架不动,补四个 v1-v3 没想透的总纲级洞:

- **§D 跨源组合归上层** — 智能表格对标飞书多维表格要关联/Lookup/Rollup(跨表),但 (1) 禁跨 D1 JOIN (2) Source 契约是单源(自报字段、查自己)。**决策:组合在上层**(Irisy / feature pack)用 **DataLoader 模式**(query 源 A 拿外键 → batch query 源 B → 内存 join),Source 保持单一职责;Lookup/Rollup = feature-pack 层 derived field,不是 Source 原生字段。与 ADR-002 v30「关系型字段落地待后续切片」对齐 —— 此处明确归属,不留洞。对标 GraphQL federation / DataLoader / CQRS read model。
- **§E gate 自身降级 + 背压** — 跨域全压一道 gate = 单点;但「本地是 truth」要求 gate 挂了仍可读。**gate 降级**:故障时只读本地 `query` 临时降到内核域待遇(直通,读不改状态、本地是 truth),**write/effect 必须等 gate**(治理不可旁路)。**背压**:bounded queue + circuit breaker,某源持续失败则熔断,快速返回 `degraded` 而非堆积。与 § trust-domains 一致(gate 降级 = 跨域读在故障期临时获内核域待遇)。对标 API gateway rate-limit / circuit breaker / bulkhead。
- **§G 可见性裁剪 × intent-scoped projection** — ~~gate 可见性是 TODO(全工具对所有 caller 可见)= 治理半成品~~ **已落地(v5,SC3)**。**可见性绑 intent-scoped projection**(ADR-002 § projection):gate 按 `(caller, intent)` 投影可见子集 = 「按 Ctrl → 意图 → 1-3 能力模块」的实现,既是 UX(不灌爆 context)又是安全(最小暴露面 / capability-based)。**实装**:`kernel/visibility.rs`(caller declares `X-Ctrl-Intent` 域集 → gate 投影 + 越域强制拒绝)+ `kernel/projector.rs`(为 BYO-CLI 默认 stamp caller+intent,默认排除 net/mcp 守数据主权)。对标 capability-based security / RBAC scoping / Apollo MCP Server gateway(flexible reads / controlled writes)。
- **§H mesh 跨设备三动词成立性** — 跨设备 query/produce 涉及 CRDT 合并 / E2EE / 最终一致。**判断:mesh 是「传输 + 一致性层」,不是腰外的另一个世界,三动词仍成立、语义投影到 CRDT**:跨设备 `query` = query 远程 Source(经 mesh,最终一致快照);跨设备 `produce` = 投影成 CRDT op(Automerge change),本地立即生效 + 异步合并 peer(=「本地 truth、异步推 peer」);`describe.degradation` 在 mesh 语境 = `LocalWins`;Beelay/Keyhive 的 capability sync 正好对接 gate 的 capability-token 授权。对标 Automerge / local-first(Ink&Switch)。

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
0.5. **两信任域重构(SC1-7,active)** — `GOAL.md` 是 live tracker。**已落地**:SC1 两信任域类型脊(`TrustDomain`)+ SC2 gate 审计 ledger + SC3 caller 细分 + intent 可见性裁剪(`visibility.rs` + projector stamp,外部 CLI 默认受裁)。**待**:SC1 完整体(`InternalMsg ⊥ GateRequest` 编译期隔离)/ SC5(136 command 收敛策略 + 棘轮 lint)/ SC6(ST-SS 弃用 → Channels+WS)/ SC7(本 amendment,已)。详见 § trust-domains 实装锚点。
1. **契约盖全** — `query` 加 `watch` 修饰落地;`describe` 声明 stream 形态 + `watchable` + 降级行为;watch 传输 = Channels+WS(SC6,原 ST-SS 弃用)+ 授权回 :17873(§ trust-domains)+ 词汇向 AG-UI 对齐。
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
