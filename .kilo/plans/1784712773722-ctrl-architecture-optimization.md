# CTRL 主程序 / 可下载资源边界与通信协议计划

> **文档角色**：非权威实施计划。架构权威仅属于 `vault/ctrl/adrs/`；本计划不能修改或替代 accepted ADR。
>
> **状态**：REWORKED / ADR-010 v10 已对齐，等待实现。
>
> **服务目标**：`vault/ctrl/GOAL.md` Track 1（通信 endpoint specification + typed bus），并为 Irisy 五能力域提供稳定的主程序/资源边界。

## 0. 结论

1. 用户只下载安装一个 CTRL 主程序。主程序包含所有通用 runtime、通信协议实现、治理、安全、更新和通用渲染能力。
2. 功能包、MCP server、Skills、模板、Schema、知识库种子和目录数据作为资源按需下载；资源不能要求修改 CTRL，也不能携带 pack-specific 前端组件。
3. 通信采用“统一语义窄腰 + 按接缝选择传输”，不是一个协议统吃全部场景。
4. MCP 负责工具/插件边界；WebSocket 与 Tauri Channels 负责实时流；ACP 只用于外部 coding agent；protobuf 只用于跨设备腿。
5. **不采用 AsyncAPI。** MCP `tools/list`/JSON Schema 已覆盖工具端点，流端点由 typed event schema、版本和 WS/Channel binding 清单物化即可。AsyncAPI 不参与 runtime，也不作为生成 artifact。
6. **不引入 executable pack UI。** 不建设 iframe host、MCP Apps `ui://`、pack JavaScript/WASM、MessageChannel bridge 或 pack-specific React component。功能包 UI 继续由 smart-table、viewer registry、FeaturePackScene 和通用表单/输出视图组成。

### 0.1 权威对齐（已完成）

bao 已确认第 5 条目标方向，`ADR-010 communication § endpoint-spec v10` 已按 `vault/ctrl/adrs/PROCESS.md` 原地修订：AsyncAPI 退役，替代为 MCP/§14/Rust typed schemas 与 WS/Tauri Channel binding registry 生成的版本化 endpoint artifacts。八缝传输、§14 三动词、`:17873` gate 和两信任域保持不变。

后续实现必须引用 v10，并继续保持 ADR 与代码同步；本计划仍不是 architecture authority。

## 1. 主程序 vs 可下载资源

判断规则：**所有资源都由同一套通用主程序读取、验证、安装、投影、执行和渲染；新增资源不得新增 CTRL 代码路径。** 这直接服从 `ADR-002 substrate §7.4 v34` 的 manifest=data/runtime=generic，以及 `§7.5 v41/v48` 的 zero-bespoke frontend。

| 能力/资产 | 进入 installer（主程序） | 按需下载（资源） | 理由与边界 |
|---|---:|---:|---|
| Tauri 原生 shell、窗口、热键、tray | ✓ | — | L0 产品入口，必须稳定存在 |
| Rust kernel 与 Actor/Capability/Event/Channel/Effect | ✓ | — | 五 primitive 是 architecture lock |
| `:17873` gate、MCP server/host、权限/审计/review | ✓ | — | 跨信任域统一治理，资源不能自带或绕过 |
| Tauri IPC、Tauri Channels、WS client/server、ACP client、WebRTC/mesh adapters | ✓ | — | 通信实现属于主程序；资源只声明/消费能力 |
| 单一 PWA、viewer registry、smart-table、FeaturePackScene、通用表单/HTML/代码/文档 viewer | ✓ | — | 按内容类型渲染，不按 pack 身份写组件 |
| keychain、sandbox、签名验证、安装/卸载、updater/rollback | ✓ | — | 信任与生命周期必须由主程序统一控制 |
| registry client、manifest parser、provision/auth engine、projection engine | ✓ | — | 通用资源运行时；不能每个 pack 一套 installer |
| 功能包 manifest 与声明式 workspace 配置 | — | ✓ | 数据，不是 CTRL 实现分支 |
| MCP server / connector service | — | ✓ | 可执行能力资源；独立进程，经主程序 host/gate/sandbox 管理 |
| Skills、persona、templates、schemas、viewer metadata | — | ✓ | 纯文本/结构化资源，可投影、可审计、可替换 |
| KB/content seeds、示例、pack docs | — | ✓ | 保持 Markdown/YAML/TOML/JSON 可读与 vim test |
| provider/model catalogue cache、registry catalogue | 离线 floor/读取逻辑 ✓ | 最新数据 ✓ | 主程序可离线工作，在线数据只是可刷新镜像 |
| Hermes 等可更新的外部 agent/runtime asset | launcher/adapter ✓ | pinned asset ✓ | 主程序拥有集成协议；外部二进制可独立更新 |
| pack-specific HTML/CSS/JS/WASM、iframe app、React component | — | **禁止** | 与 ADR-002 §7.5 zero-bespoke 冲突；需要它说明设计未通用化 |
| 用户内容 | — | 用户本地文件，不是下载包 | 本地文件是真相；云端只能镜像 |

### 1.1 资源契约

资源可以：

- 声明 MCP server、§14 Source、actions、Skills、templates、schemas、KB 和 smart-table workspace；
- 提供独立进程的 connector/service，由主程序统一验证、启动、隔离和接入 gate；
- 通过结构化结果选择主程序已有 viewer；
- 被安装、卸载、升级、回滚和离线使用。

资源不可以：

- 实现或替换 `:17873`、WS、Tauri Channels、ACP、WebRTC 等主程序协议；
- 携带能在 PWA 主 realm 或 iframe 中执行的 UI 代码；
- 调用 raw Tauri command、读取 gate bearer、访问 keychain 或绕过 review；
- 为某个 pack 要求 Rust/TypeScript `if pack_id` 分支；
- 把云端变成主程序运行依赖。

## 2. 通信窄腰

所有接缝共享三项，不共享同一种 wire：

1. **语义**：`describe / query / produce`，订阅是 `query{watch}`；
2. **治理**：跨信任域经 `:17873` 完成鉴权、可见性、审计和 review；
3. **插件**：能力插件统一为 MCP server。

传输只解决不同物理边界的问题。内部低开销、外部用行业标准、跨设备才使用稳定跨机 schema；禁止为了“统一”把 MCP、protobuf 或任一 IDL 塞进所有接缝。

## 3. 八条接缝协议组合矩阵

| # | 接缝 | 主程序协议组合 | 为什么是最佳组合 | 端点/类型物化 |
|---|---|---|---|---|
| ① | 前端 ↔ 后端 | 桌面 Tauri IPC；浏览器 token-authenticated WS | 桌面同进程走原生 IPC，浏览器需要可认证网络桥；两者共用语义，不强行共用 wire | Rust 为类型源并导出 TS；命令/事件 catalog 版本化 |
| ② | 模块 ↔ 模块 | Tokio actor + bounded `mpsc`/`broadcast`（CQRS） | 内核两端都由 CTRL 控制，actor/channel 提供背压与故障隔离；经 gate 或 MCP 反而增加开销 | typed `InternalMsg`/handler types；编译期检查 |
| ③ | Irisy ↔ 前端流 | Tauri Channels + 最简 WS；event vocabulary 向 AG-UI 对齐 | Channels 适合桌面原生二进制流，WS 覆盖浏览器；只对齐事件词汇，不引入另一 runtime | versioned event JSON Schema + Channel/WS binding 清单 |
| ④ | 能力插件接入 | MCP server → `:17873` gate | MCP 已提供工具发现、JSON-RPC 和 JSON Schema，且与插件市场/多语言进程天然同构 | `tools/list` input/output schema 导出 artifact |
| ⑤ | 第三方 app | 官方 MCP server 接入 CTRL；CTRL 作为 MCP server 对外 | 同一开放标准覆盖双向集成，避免为每个 SaaS 建专有 connector wire | MCP schema + caller/intent/gate policy |
| ⑥ | `query{watch}` 流底座 | Tauri Channels + WS；订阅授权/审计回 `:17873` | 热字节不穿 gate，session 建立与撤销仍被治理；本地断网可降级到最后快照 | watch request/schema、event schema、binding/version/degraded contract |
| ⑦ | 外部 coding agent | MCP 喂能力 + ACP 驱动 agent | MCP 负责工具，ACP 负责 agent session/turn/diff/permission；职责互补，不让 CTRL复制 agent loop | MCP `tools/list` + ACP 标准消息 schema |
| ⑧ | 跨设备 mesh / 独立远控 | WebRTC + Olm/Automerge/CBOR，跟踪 Beelay/Keyhive；远控为 ctrl-wire protobuf over WebRTC + content-blind relay | 跨机需要 E2EE、CRDT 一致性和稳定 schema；protobuf 仅在这条腿合理，远控与语义同步分轨 | protobuf 仅远控/跨机 wire；mesh capability/version metadata |

### 3.1 AsyncAPI 为什么移除

AsyncAPI 在这里仅是“描述流”的第二套文档/IDL，并不承载流。CTRL 已有：

- MCP `tools/list` + JSON Schema：工具端点事实源；
- typed Rust events / generated TS types：事件类型事实源；
- WS 与 Tauri Channel adapters：真实 transport；
- `query{watch}` + gate subscription ledger：授权、审计、撤销与降级语义。

因此再维护 AsyncAPI 会产生第二份 schema/binding 真相和 drift 风险。替代方案不是“不要 endpoint spec”，而是从真实类型与 adapter registry 生成一个较窄的版本化通信 catalog：

```text
endpoint-catalog/
  mcp-tools.json          <- tools/list JSON Schema
  source-describe.json    <- §14 describe schema
  events.schema.json      <- typed external event schemas
  stream-bindings.json    <- event × WS/Tauri Channel × auth/version/degradation
  cross-device/*.proto    <- 仅缝⑧
```

这套替代形态现由 `ADR-010 communication § endpoint-spec v10` 管辖；本计划只拆解实施，不建立平行 authority。

## 4. 实施顺序

### Phase 0 — 治理先行

- [x] `ADR-010 communication § endpoint-spec v10` 已原地 amendment：移除 AsyncAPI lock，接受 generated catalog，明确 MCP + WS/Channels 的职责边界。
- [x] ADR-002 §7.4/§7.5 保持不变；它们已经提供正确的 generic runtime / zero-bespoke UI 边界。
- [x] ADR-003 只引用既有通用 viewer/smart-table 路径，未新增 UI extension host。

### Phase 1 — 物化协议事实

- 从真实 `tools/list` 导出 MCP endpoint artifact；
- 形式化 §14 `describe` schema；
- 从 typed external events 生成 event JSON Schema；
- 建 transport binding registry，列出 WS/Channel endpoint、auth、version、degraded behavior；
- catalog 只能从上述 artifact 生成，不爬 Rust 源码。

### Phase 2 — typed bus 接入生产流

- 将真实 producer 接入 `InternalMsg`/typed EventBus；
- internal event 不直接跨信任域；
- projection bridge 按 subscription scope/redaction 生成 external event；
- `query{watch}` 在 `:17873` 建立、审计、撤销，热流经 Channels/WS；
- 验证 bounded queue、disconnect、revocation、last-snapshot degradation。

### Phase 3 — 边界棘轮

- 增加检查，禁止 pack-specific frontend imports/components 和 runtime protocol implementations；
- 验证安装一个新 pack 只新增资源，不修改 CTRL Rust/TypeScript；
- 保持离线 floor，验证 registry/云端不可用时主程序仍可工作。

## 5. 验收

- [ ] 有一张经 ADR 对齐的 installer/resource 清单；新 pack 不修改 CTRL 代码。
- [ ] 通信协议 adapters 全属于主程序，pack 只提供声明与 MCP/§14 能力。
- [ ] 八条接缝均有 protocol、理由、endpoint/type 物化方式。
- [x] ADR-010 v10 governed amendment 已完成；accepted authority 不再要求 AsyncAPI。
- [ ] endpoint catalog 从真实 schemas/adapters 生成，不爬源码、不维护第二份手写真相。
- [ ] producer → typed bus → authorized/redacted projection → Tauri Channels/WS 有运行证据。
- [ ] 功能包 UI 全部由 generic smart-table/viewer/form/output surfaces 表达；无 pack HTML/JS/WASM/iframe/component runtime。
- [ ] 本地断网、registry 不可用、connector 掉线均有诚实降级。
- [ ] compiler/typecheck、targeted tests、gate harness、UI smoke 和治理检查通过。

## Appendix A — Ownership reference（非主设计）

| Concern | Owning ADR | 本计划只引用的职责 |
|---|---|---|
| Kernel spine | ADR-001 | 五 primitives、内部 Actor/Event/Channel 边界 |
| Substrate | ADR-002 | §14、`:17873`、MCP host/server、projection、manifest runtime |
| Frontend | ADR-003 | 单一 PWA、viewer registry、smart-table、通用 morphing surface |
| Capability/security | ADR-004 | process sandbox、供应链、安装/更新/回滚 |
| Irisy product | ADR-005 | 产品意图、brain/tool 使用与 review UX |
| Communication | ADR-010 | 两信任域、八条接缝、transport 和 endpoint specification 总纲 |

`pack_sandbox.rs` 只治理 shell/process sandbox；它不是 UI loader 或通信协议 owner。

## Appendix B — ADR dependency and process reference

1. 产品方向由 GOAL 和 bao 决定；计划文件不构成 acceptance。
2. 本次 lock-point 变化已由 `ADR-010 communication § endpoint-spec v10` 接管；后续代码必须引用并实现该 contract。
3. 若实现发现需要改变 ADR-002/003/004/005 的 lock-point，停止并单独请 bao 决策，不能把变化夹带进 ADR-010。
4. 每次 accepted ADR amendment 必须按 PROCESS 同步 body、version、date、changelog、sections、INDEX 和代码引用。
5. 治理验证至少包括：
   - `bash scripts/check-adr-acceptance.sh --soft`
   - `node scripts/check-governance.mjs --worktree`
   - `git diff --check`
6. 发布仍由 `scripts/release.sh` 的 strict Acceptance gate 管理；本计划不启动、承诺或替代发布。

## Appendix C — Explicitly rejected scope

以下内容来自上一版错误分叉，现全部拒绝且不保留为 future roadmap：

- third-party executable UI；
- MCP Apps `ui://` resource host；
- iframe/CSP/MessageChannel extension runtime；
- pack HTML/CSS/JavaScript/WASM；
- per-pack React/component injection；
- executable UI signing、generation pointer、server+UI atomic lifecycle；
- 通过 amendment 反转 ADR-002 §7.5 zero-bespoke frontend。

如未来确有新的产品需求，必须由 bao 提出并重新走 owning ADR 决策；不得从本计划“恢复”。
