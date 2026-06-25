---
title: CTRL 通讯协议接口规范 — 从业务架构逐缝长出
kind: spec
status: superseded
superseded_by: "010-communication.md (ADR-010 v6 §transports/§endpoint-spec) + [[comms-system-design]] (执行图 §2 全量端点分类)"
supersede_note: "2026-06-24 真相源对账:8 缝契约 + wire 选型已收编进 ADR-010 v6;保留作 per-seam 2026 对标背书的 provenance。"
created_at: 2026-06-23
research_backed: deep-research 2026-06-23(108 agent / 26 一手源 / 23 断言过 3 票对抗验证)
owner: bao
author: claude (通讯重构)
purpose: 把 ADR-010 窄腰原则 + master-plan 业务架构,落成逐缝可实施的接口契约(谁↔谁/信任域/传输/契约/类型落点/状态),每缝带 2026 行业对标背书
governing: 010-communication.md
derives_from:
  - "[[master-plan]]"            # §二·五 模块版图 + §二·六 业务→通讯映射
  - 010-communication.md         # 窄腰 + 8 缝传输 + 两信任域
  - "[[comms-architecture-permanent]]"  # 四维正交骨架 + 降级契约
related:
  - 002-substrate.md             # §14 三动词实现细则 + § wire + § crypto + § mcp-bus
  - "[[GOAL]]"
---

# CTRL 通讯协议接口规范

> ⚠️ **SUPERSEDED(2026-06-24 真相源对账)** — 8 缝契约 + wire 选型已收编进 **`010-communication.md`(ADR-010 v6 §transports + §endpoint-spec)**;全量端点分类 + 迁移图见 **`[[comms-system-design]]`**。本文保留作 **per-seam 2026 行业对标背书的 provenance**。读通讯 → ADR-010 v6 + comms-system-design,不读本文。

> **本文角色**:ADR-010 是「总纲」(为什么这样),`comms-architecture-permanent.md` 是「骨架」(四维/窄腰),**本文是「接口规范」** —— 每条通讯缝的可实施契约(怎么调)。
> **方法**:不套协议模板。从 master-plan §二·六 业务全景 → 业务流要走的缝 → 每缝一个接口契约。业务长出通讯,不是反过来。

---

## 0. 两条总规(所有缝先服从)

### 0.1 信任域类型边界(谁能不经 gate)
```
内核域 (trusted)   actor↔actor    → InternalMsg  → channel/event   → 不过 gate
跨域   (untrusted) 一切跨信任边界 → GateRequest  → :17873          → 鉴权+审计+可见性
```
- `InternalMsg ⊥ GateRequest` 类型上不可互转 —— 编译器挡「内核自调误经 gate」(SC1)+「跨域调用绕开 gate」(后门)。
- 跨信任边界 = 外部 agent / Irisy→工具 / connector→第三方 / PWA→写操作 / 跨设备 peer。

### 0.2 契约面(能力语义,与传输无关)
能力 = §14 Source,动词集**冻结在三个**(真相源 ADR-002 §14):
- `describe` — 自报字段/算子/record|stream 形态/`watchable`/降级行为(防 AI 幻觉)
- `query` — 读快照(并行);`watch:true` 修饰 → 订阅实时流(= subscribe,非第四动词)
- `produce` — 写/动作(串行,过 review gate)

> **规范铁律**:新能力一律「实现一个 Source × 三动词」→ 多传输自动暴露。**停止再加细粒度 Tauri command / MCP tool**(消双表面)。

---

## 1. 业务架构 → 通讯缝 全景(模块 × 缝)

业务模块(master-plan §二·五)实际要走的缝:

| 业务模块 | 用到的缝 | 信任域 |
|---|---|---|
| CTRL shell / intent | ① PWA↔kernel | 跨域(PWA 写)/ 内核域(读降级) |
| Irisy(内置助手) | ⑤ Irisy↔脑(hermes ACP) · ④ Irisy→工具(gate) · ⑥ 流回前端 | 跨域 |
| 个人知识库 / Notes(同一 vault 两个面) | ① PWA↔kernel(query/produce vault Source) | 跨域(写)/ 内核域(读) |
| Smart-table(beachhead) | ① PWA↔kernel(§14 三动词) · ⑥ AI 列流 | 跨域 |
| Coding | ⑦ 外部 coding agent(MCP 喂 + ACP 驱动) · ⑥ terminal 流 | 跨域 |
| 能力市场 / Mcp pool | ③ 插件↔kernel(MCP over gate) | 跨域 |
| **远程桌面**(新主力) | ⑧ 跨设备(ctrl-wire + WebRTC + E2EE) | 跨域(peer 不可信) |
| 内核内部(scheduler/sourcing/effect) | ② 模块↔模块(actor) | 内核域 |

> 8 缝编号沿用 ADR-010 §transports,本文给每缝补**接口契约**。

---

## 2. 逐缝接口规范

### 缝 ① 前端 ↔ 后端(PWA ↔ kernel)
- **谁↔谁**:ctrl-web(PWA)↔ kernel(同进程 desktop / 跨进程 mobile)
- **信任域**:**跨域**(PWA 写操作必经 gate);**读可降级内核域**(gate 挂时只读 query 直通,本地是 truth —— ADR-010 §E)
- **传输**:Tauri IPC(桌面)+ WS+token(浏览器/mobile)
- **契约**:§14 三动词(`describe`/`query`/`produce` over Source);**不再加 ad-hoc command**
- **类型落点**:Rust 当权威源,`tauri-specta`/`ts-rs` 自动导出 TS(消前后端漂移,Roadmap 4)
- **状态**:§14 query/produce 已接(SC8 前端铁证);134 Tauri command 收敛进三动词 = 进行中(收敛不推倒,棘轮 lint)
- **对标(调研✓)**:`tauri-specta`/`ts-rs`「Rust 权威源 → 自动导出 TS」是正路(无需跨语言 IDL);本机 RPC 走 Tauri invoke 正确。

### 缝 ② 模块 ↔ 模块(内核域 actor)
- **谁↔谁**:kernel actor 之间(scheduler / sourcing / vault_watch / effect executor …)
- **信任域**:**内核域**(`InternalMsg`,不过 gate)
- **传输**:tokio actor + bounded mpsc/broadcast(CQRS 读写分离);spine 5 primitive 之 `channel`/`event`
- **契约**:`InternalMsg` enum(类型化消息);失败隔离(Erlang/OTP),零治理开销
- **类型落点**:`kernel/channel.rs` + `kernel/event.rs`(不动 spine 定义)
- **状态**:primitive 在;EffectExecutor dispatch 未 wire(P6,长期)
- **对标(调研✓)**:**kameo**(Rust actor)实证选型 —— OTP 式 supervision(OneForOne/OneForAll/RestForOne)+ panic 隔离(一 actor 崩不拖垮系统)+ bounded/unbounded mailbox + 背压(默认 bounded 64),正好匹配 CTRL bounded mpsc/broadcast + circuit breaker。

### 缝 ③ 能力插件 ↔ kernel(MCP over gate)
- **谁↔谁**:能力插件(= 一个 MCP server,本地 stdio / 远程 Streamable HTTP)↔ kernel(当 MCP host)
- **信任域**:**跨域**(第三方插件不可信 → 扫描/hash-pin/验签/沙箱)
- **传输**:MCP(行业收敛标准,LF 中立);经 :17873 gate 发现+审计
- **契约**:MCP `tools/list`=describe · `resources/read`=query · `tools/call`=produce(同构映射,零新增)
- **类型落点**:`kernel/mcp_host.rs` + `kernel/mcp_server.rs`(gate)+ 能力 manifest(markdown+JSON frontmatter)
- **状态**:gate + 58 MCP tool 在用;能力市场 4 块安全(扫描/hash-pin/验签/沙箱)= 中期(mcp-capability-marketplace 切片)
- **对标(调研✓)**:**VS Code = 反面教材** —— 扩展与编辑器同权限、**无运行时沙箱**,安全靠 registry 端扫描/blocklist(必要但不足);CTRL 的 gate 中介 + hash-pin/验签更稳。**MCPS 提案**(emerging,未批准):签名工具定义防 tool-poisoning(CVE-2025-6514 CVSS 9.6)+ ECDSA P-256 Agent Passport + L0-L4 分级信任 —— 支撑验签/分级方向。⚠️ 运行时进程沙箱(WASM/seccomp/landlock)仍 open。

### 缝 ④ Irisy / 外部 agent → CTRL 工具(gate 回流)
- **谁↔谁**:Irisy(脑=hermes)的工具调用 + 外部 agent(claude 等)的回流 → :17873
- **信任域**:**跨域**(`GateRequest` 带 caller identity)
- **传输**:MCP over :17873(Irisy 工具穿 gate passthrough;外部 agent 经 `.mcp.json` 发现)
- **契约**:`GateRequest { caller, intent, tool, args }` → gate 鉴权 → 可见性裁剪 → dispatch → 审计 ledger 记一条(caller/tool/args-hash/outcome/ts)
- **治理面**(护城河):
  - **审计 ledger**(SC2,已落 `kernel/audit.rs` + `audit_calls` 表)—— 只存 args sha256,守数据主权
  - **可见性裁剪**(SC3,TODO):按 `(caller, intent)` 投影可见工具子集 = intent-scoped projection(既 UX 不灌爆 context,又安全最小暴露面)
  - **caller 细分**(SC3 前置):现恒 `"external"` → 细分 claude / hermes / external-agent
- **类型落点**:`kernel/mcp_server.rs` `dispatch_tool` + `kernel/audit.rs`
- **状态**:审计已落;可见性裁剪 + caller 细分 = **下一步**
- **对标(调研✓)**:**Apollo MCP Server**(GA 2025-10)= gateway 式 MCP 治理生产实证 —— 站现有 API 前当受控 gateway(零后端改动)+ persisted-operation allowlist(只暴露预批准操作)+「flexible reads / controlled writes(mutation 需显式批准)」,1:1 映射 CTRL query 读 / produce 写 + 风险分级 gate。**确认 gate 方向**。

### 缝 ⑤ Irisy ↔ 脑(hermes)
- **谁↔谁**:Irisy(app 内助手前端)↔ Hermes Agent(NousResearch,CTRL bundle+启动,dashboard :17890)
- **信任域**:**跨域**(脑的工具调用穿 :17873)
- **传输**:ACP stdio JSON-RPC(工具调用穿 MCP passthrough 回 gate)
- **契约**:ACP turn(提议-批准:diff/permission/流式)
- **类型落点**:`commands/hermes_acp.rs`
- **状态**:在用;hermes 不退役
- **对标(调研✓)**:**ACP Registry 2026-01-28 上线**(Zed + JetBrains 内建)= ACP-over-stdio(JSON-RPC)确立为 2026 agent-client 标准;Claude Code/Codex/Copilot/OpenCode/Gemini 均注册。确认 ACP-stdio 选型。⚠️ 各 CLI adapter 状态随版本变(2026-01 上线很新),锁 ADR 前复检。

### 缝 ⑥ 实时流(kernel → PWA live · subscribe)
- **谁↔谁**:kernel(query{watch} 增量 / terminal 输出 / AI 列进度 / agent thinking)→ PWA
- **信任域**:**跨域**(字节走快路不阻塞,但**授权+审计元数据登记回 :17873** —— gate 看得见/可撤销/脱敏每个 live 订阅,ADR-010 § trust-domains)
- **传输**:**Tauri Channels(桌面,有序二进制流)+ WS+token(mobile)** —— **取代 ST-SS CBOR**(§3 裁决 2 修正:底座是 Channels,不是 ctrl-wire)
- **契约**:`query` + `watch:true`(= subscribe 投影,非第四动词);`describe` 自报 `watchable` + stream 形态;丢源降级末次快照 + `degraded` 标记
- **类型落点**:`Channel<T>` kernel 推送侧 + 前端 channel 消费(消 ST-SS)
- **状态**:现为 ST-SS(`stss_bridge.rs` 等)→ **SC6 换 Tauri Channels**;前端流不回归(视觉验证)
- **对标(调研✓)**:**AG-UI** = 2026 agent→UI 流事实标准(AWS Bedrock AgentCore Mar GA / Google/MS/Oracle),且 **transport-pluralistic**(SSE+WS+webhooks)→ 验证「窄腰多传输」、**反对锁单一 wire**;Tauri 官方 **Channels** 即流原语(Event system 不适合高吞吐/二进制)。**机会**:三动词 query{watch} 映射 AG-UI events → CTRL 成 AG-UI 兼容 producer。

### 缝 ⑦ 外部 coding agent(BYO-CLI driver)
- **谁↔谁**:CTRL ↔ 用户自选本地 CLI(Claude Code 旗舰 / opencode 未接)
- **信任域**:**跨域**(CLI 是独立 agent,CTRL 不 supervise)
- **传输**:**MCP 喂养**(projection:`.mcp.json`/`SKILL.md`/`AGENTS.md` 物化进 CLI 落点,已通)+ **ACP 驱动**(阶段 5,`claude --acp`,提议-批准)
- **契约**:projection = 让 brain 看见资产;调用回流经 :17873 gate(= 缝④)
- **类型落点**:`kernel/projector.rs`(已落项目级 `~/Documents/CTRL/.mcp.json`)
- **状态**:projection 在用;ACP 驱动 = 阶段 5
- **对标(调研✓)**:`acp-bridge` 已驱动 OpenCode/Codex/Claude/Gemini(同缝⑤ ACP Registry)。「仅 OpenCode 原生」说法被对抗验证**驳回**(Gemini 亦原生实验 `--experimental-acp`);per-CLI adapter 状态随版本变,不固定。

### 缝 ⑧ 跨设备(远程桌面 + sync mesh)★ 新主力
- **谁↔谁**:sharer ↔ viewer(远程桌面)/ device ↔ device(sync mesh)
- **信任域**:**跨域**(peer 不可信 → E2EE 必须;穿不透 NAT 才用 **content-blind relay**,区别于 ToDesk 过中心服务器)
- **传输**:WebRTC DataChannel(webrtc-rs)+ 信令中继(CF Worker `*.workers.dev`)+ **vodozemac Olm 1:1 包裹每字节**
- **线协议**:**ctrl-wire**(protobuf SSOT,clean-room 仿 RustDesk schema)—— 顶层 `Message` envelope:
  - 会话:`Hello`(能力协商)/ `Login`(9 位 room-id + Argon2id 密码 + Curve25519)/ `PeerInfo`
  - 媒体:`VideoFrame`(H264/265/VP9/AV1)/ `AudioFrame`
  - 输入:`KeyEvent` / `MouseEvent` / `SwitchDisplay`
  - 副信道:`FileAction`/`FileResponse` / `Clipboard` / `Misc`
- **§14 在 mesh 的成立性**(ADR-010 §H):跨设备 `query` = 查远程 Source(最终一致快照);跨设备 `produce` = 投影成 CRDT op(Automerge change,本地立即生效+异步合并);`describe.degradation = LocalWins`
- **类型落点**(worktree `feat/remote-window-share-spike`):`packages/ctrl-wire`(proto)+ `kernel/remote_transport`(webrtc+信令)+ `remote_session` + `screen_capture`/`video_codec`/`audio_capture` + `input_inject` + `clipboard_sync` + `file_transfer` + `worker/ctrl-relay-spike`(信令)+ `share-host.tsx`/`share-receiver.tsx`
- **状态**:**spike 已成形(6875 行,在 worktree `feat/remote-window-share-spike` 未并 main)**;mesh sync = Beelay/Keyhive 演进跟踪
- **对标(调研✓ 半 / 半未覆盖)**:
  - **sync mesh ✓**:**Beelay**(Automerge org,配 Ink&Switch **Keyhive**)= transport-agnostic + **content-blind**(只同步 E2EE 密文,server 看不到明文)+ RPC over CRDT → 背书 CTRL content-blind relay + E2EE + 数据主权;**Keyhive** = convergent capabilities(网络无关、离线可用的 grant/revoke)+ BeeKEM CGKA(MLS TreeKEM 衍生)→ 背书 capability-scoping。⚠️ 两者均 **pre-alpha / 未审计**(「DO NOT use in production」)→ 维持「跟踪」不依赖,自栈(Olm/Automerge)先行。
  - **远程桌面 ⚠️ 未覆盖**:RustDesk wire / WebRTC vs 自研 / vodozemac Olm 远控 E2EE / NAT 穿透 —— 本轮无存活断言,**需专项 follow-up**(§4)。

---

## 3. 线协议层裁决(deep-research 背书,2026-06-23)

> 整理时我先给的裁决「ctrl-wire = 唯一线协议 SSOT 横跨内部+远控」被深度调研 **否定/修正**(108 agent / 26 一手源 / 23 断言过 3 票对抗验证)。以下是有外部依据的版本。原裁决留作反例。

### 裁决 1(修正,反转原裁决):语义契约 = SSOT,wire framing 按传输适配 —— 不把 protobuf 强加本机流
- **调研结论**:**无任何一手资料背书「protobuf 作内部流 SSOT」**。Tauri **Channels**(非 Event system)原生支持有序二进制流(官方原语,用于 download progress / child process output / WebSocket message);Event system「不为低延迟/高吞吐设计、payload 恒 JSON 字符串、不适合大消息」(Tauri v2 官方文档,3-0 验证)。
- 先例(**AG-UI / Beelay 都明确 transport-agnostic**)支持的是「**同一语义契约**跨多传输复用」,**不是**「同一二进制 wire 格式横跨进程边界 + 网络边界」—— 后者**零先例**(调研专项查证,absence-of-precedent 本身是信号)。
- **裁决**:
  - **SSOT = 三动词语义契约**(describe/query/produce + query{watch}),跨传输复用 —— 这才是有先例的窄腰。
  - **本机流(缝⑥ kernel→PWA)= Tauri Channels 二进制**,不套 protobuf(避免过度工程;Channels 已交付有序二进制)。
  - **跨设备(缝⑧)= ctrl-wire protobuf over WebRTC** —— 这里 protobuf 名正言顺(跨设备 schema 稳定 + clean-room RustDesk)。
  - **kernel↔subprocess delta** = 按 schema 演进需要选 protobuf 或轻量 framing,不强制。
- 「protobuf 管帧 ≠ gRPC 管 RPC service」区分 **成立**(调研确认),但**不等于**「本机就该用 protobuf」。vim-test 守的是 vault=plain-text **存储**,与 wire **传输**正交 —— 这条原判断不变。
- **对 ADR-010**:§ internal-external **维持原则**(内部不引重 codegen),无需推翻;补一句「二进制流帧用 Tauri Channels 原生路径,protobuf 仅 scope 跨设备腿」。

### 裁决 2:ST-SS 退役 = 确认;但流底座是 Tauri Channels,不是 ctrl-wire
- ST-SS 全量弃用(master-plan §C 已定,不变)。`subscribe = query{watch}` **语义不变**。
- **替代底座修正**:从「ST-SS CBOR」换成 **Tauri Channels 二进制(桌面)+ WS+token(mobile)**,**不是** ctrl-wire 流帧。
  - 弃用清单:`stss_bridge.rs` / `subprocess_stss_adapter.rs` / `commands/stss.rs` / `packages/ctrl-stss` 移除或停用。
- **AG-UI 对齐机会(open question,跟踪)**:AG-UI = 2026 agent→UI 流事实标准(AWS Bedrock AgentCore Mar 2026 GA / Google/MS/Oracle 采用),且 transport-pluralistic。CTRL 三动词 + query{watch} **可否映射 AG-UI events** → 让 CTRL 成 **AG-UI 兼容 producer**,骑标准而非造私有帧。留作设计原则,接第三方 agent 框架时免费兼容。
- **对 ADR-010**:§transports ③⑥ 删 ST-SS,流底座改「Tauri Channels + WS」(非 ctrl-wire);AG-UI 从「词汇对齐」升级为「producer 兼容机会」。

### ★ 缝⑧ 远程桌面腿:本轮调研未覆盖,需专项 follow-up
- **诚实缺口**:RustDesk wire protocol 结构 / WebRTC vs 自研传输 / vodozemac Olm E2EE 远控 / NAT 穿透 + content-blind relay —— **本轮无存活断言覆盖**(预算 drop 4 + 未抓到一手)。
- 本规范只确认方向:**跨设备 = WebRTC + E2EE + protobuf 线协议 + content-blind relay**(Beelay/Keyhive 背书 content-blind + capability-scoping)。clean-room 仿 RustDesk 协议**前需专项调研**(见 §4 follow-up)。远程桌面是独立能力模块(GOAL non-goal),不阻塞本目标。

---

## 4. 落地次序(接口规范 → 实施,守 dev-loop 收敛)

> 与 GOAL.md SC1-SC7 对齐;本文是「规范」,GOAL 是「当前活跃切片」。

1. **缝④ 治理面补齐**(SC2 已落审计;**下一步 SC3** = caller 细分 + 可见性裁剪 intent-scoped projection)— 调研背书 Apollo gateway 模式
2. **缝①② 类型边界硬化**(SC1 完整体 = `InternalMsg ⊥ GateRequest` 编译期隔离;SC5 = 136 command 收敛策略 + 棘轮 lint)
3. **缝⑥ ST-SS → Tauri Channels**(SC6;**修正**:底座 Channels 非 ctrl-wire;前端流不回归,视觉验证)
4. **缝⑧ 远控转正**(worktree spike → 并 main,独立能力模块;**前置 = 远程桌面专项调研**,见下;本目标只留口)
5. **ADR-010 amendment**(SC7,见下方清单,与实装 + 调研对齐)

### 远程桌面专项 follow-up 调研(缝⑧ 未覆盖半)
clean-room 仿 RustDesk 协议前必跑(本轮 deep-research 未覆盖):RustDesk wire protocol 结构 / WebRTC(webrtc-rs)vs 自研传输 / vodozemac Olm 远控 E2EE 方案 / NAT 穿透 + content-blind relay 信令 / ToDesk 等闭源栈可逆推的设计。**独立目标,不阻塞本通讯重构。**

### ADR-010 amendment 清单(调研修正后,SC7)
| § | 改动 | 依据 |
|---|---|---|
| § internal-external | **维持原则**(内部不引重 codegen);补「二进制流帧走 Tauri Channels 原生路径,protobuf 仅 scope 跨设备腿」 | 调研:无一手背书 protobuf 作内部流 SSOT;Channels 原生二进制 |
| § transports ③⑥ | 删 ST-SS;流底座改 **Tauri Channels + WS**(非 ctrl-wire);AG-UI 从「词汇对齐」升级「producer 兼容机会」 | master-plan §C + 调研 AG-UI transport-pluralistic |
| § transports ⑧ | 远控线协议 = ctrl-wire protobuf over WebRTC + content-blind relay;标注「远程桌面腿待专项调研」 | Beelay/Keyhive content-blind 背书;远控腿未覆盖 |
| § trust-domains | 不变(两信任域 + gate 仅守跨域)— 调研 Apollo 实证 gateway 治理 | Apollo MCP Server |
| § future | 删 ST-SS 相关;Beelay/Keyhive 维持「跟踪不依赖」(pre-alpha) | 调研:pre-alpha/未审计 |
| 新增「单一 wire 横跨本机+跨设备 = 未验证赌注」注 | 明确标 novel bet + fallback = 各传输适配 framing | 调研:零先例 |

---

## 5. 与其他真相源边界(不复制,只引用)

| 真相项 | 真相源 |
|---|---|
| 窄腰原则 / 8 缝选型 / 内外哲学 | ADR-010 |
| 三动词实现细则 / RecordSource / 算子 | ADR-002 §14 |
| :17873 gate 实现 | ADR-002 § mcp-bus |
| ctrl-wire proto schema / mesh 加密 | ADR-002 § wire + § crypto |
| 5 primitive | ADR-001 § primitives(不改) |
| 业务模块版图 / 对标 | master-plan §二·五 |
| 四维正交骨架 / 降级契约 | comms-architecture-permanent.md |

本文只拥有**「业务缝 → 接口契约」的映射**;上述实现真相不复制进本文。

---

## 6. 调研引用源(deep-research 2026-06-23,一手优先)

| 缝/主题 | 一手源 |
|---|---|
| ⑥ AG-UI 标准 + transport-pluralistic | `github.com/ag-ui-protocol/ag-ui` · AWS Bedrock AgentCore AG-UI GA(2026-03) · `docs.ag-ui.com/concepts/architecture` |
| ① Tauri Channels vs Event | `v2.tauri.app/develop/calling-frontend/` · tauri issues #13405/#7127 |
| ② kameo actor | `github.com/tqwewe/kameo` · `docs.rs/kameo` |
| ④ Apollo gateway 治理 | `apollographql.com/docs/apollo-mcp-server` · Apollo MCP 1.0 GA blog |
| ③ VS Code 无沙箱 + MCPS | VS Code extension-runtime-security docs · `github.com/ossf/tac/issues/583`(MCPS)· `datatracker.ietf.org/doc/draft-sharif-mcps-secure-mcp-00` |
| ⑤⑦ ACP Registry | `zed.dev/blog/acp-registry`(2026-01-28)· `blog.jetbrains.com/ai/2026/01/acp-agent-registry/` · `agentclientprotocol.com` |
| ⑧ Beelay/Keyhive sync | `github.com/automerge/beelay/blob/main/docs/protocol.md` · `inkandswitch.com/project/keyhive/` |

> 被对抗验证 **驳回** 的两条(勿引):AG-UI 精确事件数(~16,未证)· 「仅 OpenCode 原生 ACP」(Gemini 亦原生实验)。
> 调研 **未覆盖**:远程桌面腿(RustDesk wire / 远控 E2EE / NAT 穿透)= 缝⑧ 专项 follow-up(§4)。
