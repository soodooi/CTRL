# CTRL 能力平台与 Irisy 消费架构 — 主程序边界驱动实施计划

> **文档角色**：非权威实施计划。`vault/ctrl/GOAL.md` 是活跃目标，`vault/ctrl/adrs/` 是唯一架构权威。
>
> **状态**：REWORKED / 已按 ADR-001、ADR-002、ADR-003、ADR-005、ADR-010 收敛概念边界。
>
> **核心原则**：Irisy 是用户入口、品牌人格、角色上下文、能力消费者和治理 UX；CTRL Kernel 是能力平台。两条 Brain 路径消费 MCP、API、Skills 三个能力面：跨域执行只有 `:17873` 这一条 gate wire，API 能力通过该 gate 上的 MCP tools 暴露，Skills 当前通过 gate 工具供 Brain 读取和组合；结果统一落回本地真相或形成受治理的外部 Effect，并按内容类型渲染。

## 1. 目标与成功标准

本计划直接服务 GOAL 成功标准 1（Track 0 治理）。保留 accepted 的**五个 Irisy 能力域**作为异构的规划/审查镜头：

| Irisy 能力规划/审查域 | CTRL 主程序提供 | 可下载资源提供 | 用户表面 |
|---|---|---|---|
| md 文档管理 | §14 text/record runtime、Notes/index、通用 Markdown/smart-table viewer | schemas、templates、Skills、KB/content seeds | Notes/KB workspace |
| html | §14 produce、viewer registry、通用安全 HTML viewer | HTML 内容或结构化 artifact，不含可执行 UI runtime | morphing output / generic viewer |
| coding | projection、gate、MCP 接入；ACP 仅按 accepted roadmap 分阶段接入 | CLI assets、Skills、pack creator templates | Coding workspace |
| 通讯 | `:17873`、MCP host/server、typed bus、IPC/Channels/WS；mesh 属阶段性基础设施 | MCP server declarations 与 connector services | Irisy/tool stream/connections |
| L1/L2 | 单一 PWA、L1/L2/module binding、role context | pack metadata、persona/KB declarations | capability navigation |

这五个域异构：md/html 是内容与工作区，coding 是使用场景，通讯是平台基础设施，L1/L2 是呈现结构。它们不替代 owning module ADR，不建立新的实现 owner，也不是 MCP/API/Skills 三个能力面的平级替代分类。

成功标准：

1. Irisy 通过两条 Brain 路径消费同一 CTRL 能力平台；
2. MCP、API、Skills 保持为三个能力面，同时保留五能力域作为规划/审查镜头；
3. 所有跨信任域的工具调用、订阅、写操作和 external Effect 都经 `:17873`；内核域内部 Actor/Channel/Event 通信不经 gate；API 能力只通过 gate MCP tools 暴露，不新增 raw API 执行入口；
4. 新资源不修改 CTRL Rust/TypeScript，不携带通信、权限或 UI runtime；
5. 前端只按内容类型和通用 workspace 渲染，不存在 pack-specific executable UI；
6. 用户内容先写本地，云同步只作异步镜像；Provider API 和显式 governed external Effect 可以同步远程调用。远端不可用时，本地内容和只读能力保持可用，Provider 返回 typed degraded/error result，external write/Effect 按 owning contract 保持 pending 或 fail closed，绝不绕过 gate 或误报成功；仅在 contract 明确允许 replay 时排队；
7. 每个 Track 有 compiler/test/harness/UI/governance 的 fresh evidence。

详细 installer/resource 表和八缝矩阵见同目录 `1784712773722-ctrl-architecture-optimization.md`。该文档同样是非权威计划，不替代 ADR。

## 2. Irisy 系统能力模型

### 2.1 六层模型

```text
1. 用户入口
   Irisy 对话、Ctrl-key、persona、role context

2. 意图与作用域
   intent + role(persona, packs, KB)
   只发现和投影当前任务需要的能力

3. 两条 Brain 路径
   ├─ Bundled Hermes
   └─ 用户选择的 BYO CLI
   Irisy 不实现第三套 agent loop

4. 三个能力面
   ├─ MCP：工具、connector、外部系统
   ├─ API / Provider：text/image/audio/embed 等模型能力
   └─ Skills：Agent 可读的方法、约束与组合知识

5. 统一执行与治理
   ├─ :17873 gate
   ├─ authentication / visibility / review / audit
   └─ describe / query / produce + Effect lifecycle

6. 本地真相与结果呈现
   ├─ Markdown / smart-table / HTML / code / image / PDF
   ├─ content-type viewer / generic workspace
   └─ local-first write + transparency drill-down
```

标准数据流：

```text
用户意图
  → Irisy role context
  → Hermes 或 BYO CLI
  → intent-scoped capability discovery
  → Skills 向 Brain 提供方法与约束
  → MCP tools 回到 :17873 gate
  → API / Provider 能力由 gate 上的 MCP tools 调用 Kernel provider router
  → describe / query / produce / Effect
  → 本地文件或受治理的外部动作
  → 通用 Viewer / Workspace
```

这里不存在 raw API 的第二条跨域执行 wire。用户内容持久化先落本地，云同步异步镜像；显式 Provider 调用和 external Effect 可以同步访问远端，但必须受 gate 治理。依赖不可用时，本地内容和只读能力保持可用，Provider 返回 typed degraded/error result，external write/Effect 按 owning contract 保持 pending 或 fail closed；不得绕过 gate、误报成功，且仅在 contract 允许 replay 时排队。

### 2.2 能力与实现所有权

| 系统能力 | Irisy 对用户表现 | 实现权威 |
|---|---|---|
| Agent execution | 理解意图、组合调用、完成任务 | Bundled Hermes 或 BYO CLI；Irisy 不复制 agent loop |
| MCP integration | 发现和调用 MCP 工具 | Kernel `mcp_host.rs` / `mcp_server.rs` / `:17873` |
| Provider routing | 使用 text/image/audio 等模型能力 | Kernel `provider/`；BYOK 与 credential resolution 留在 Kernel |
| Capability composition | 按 Skills 与上下文组合原子动作 | Brain 负责调度，Skills 提供方法，Effect 承载长任务；无独立 workflow engine |
| Communication | 流式输出、工具调用、外部 Agent 与跨设备连接 | Kernel/shell transport adapters；Irisy 只消费 typed interface |
| Governance UX | 展示权限、review、审计和结果 | Irisy/PWA 提供 UX；`:17873` gate 是唯一权限 authority |
| Content rendering | 展示 Notes、table、artifact 和结果 | 单一 PWA 的 viewer registry / generic workspace |

### 2.3 明确禁止的重复

- Irisy 私有 Agent runtime 或第三套 Brain loop；
- Irisy/PWA 私有 MCP host、provider router 或 connector executor；
- 独立 DAG/workflow runtime、wizard engine 或替 Agent 排工具顺序的 supervisor；
- 绕过 `:17873` 的第二套权限、审批或审计系统；
- pack 自带 gate、WebSocket、ACP、协议 bridge 或 executable UI runtime；
- 同一能力同时维护互不派生的 MCP 与 Tauri 两套业务实现。

“工作流能力”在本架构中指 **Agent-guided capability composition**：Skill 教方法，Brain 决定调用顺序，MCP 原子动作以及由 gate MCP tools 暴露的 API 能力经 `:17873` 逐次执行和治理，Effect 管理长任务；不是传统流程编排器，也不建立 raw API ingress。

## 3. 主程序与资源边界

### 3.1 必须属于主程序平台

- Tauri shell、Rust Kernel 和五 primitives；
- `:17873` gate、MCP host/server、provider router、typed EventBus；
- 当前主链的 Tauri IPC/Channels 与 token-authenticated WS；
- keychain、review、audit、sandbox、updater/rollback；
- 单一 PWA、viewer registry、smart-table、FeaturePackScene 和通用 forms/viewers；
- registry/install/provision/auth/projection engines。

ACP、WebRTC、mesh 等 accepted roadmap 适配器在实现时也必须归主程序管理，但它们是**分阶段基础设施**，不得成为当前 Irisy 能力闭环的前置条件。

### 3.2 可以按需下载

- feature-pack manifests、MCP servers/connectors；
- Skills、personas、templates、schemas、KB/content seeds；
- registry/provider/model catalogue 数据；
- 由主程序 adapter 管理的 pinned external agent/runtime assets。

### 3.3 永远不作为资源下载

- pack-specific React components；
- HTML/CSS/JavaScript/WASM executable UI bundles；
- iframe/MCP Apps `ui://` hosts 或 MessageChannel bridge；
- pack 自带 gate、WebSocket、ACP 或其他协议实现；
- secret、gate bearer 或用户内容副本。

该边界服从 ADR-002 §7.4 manifest=data/runtime=generic 与 §7.5 zero-bespoke frontend；本计划不提出反向 amendment。

## 4. Tracks（平台地基到 Irisy 表面）

### Track 0 — 治理与 authority 对齐

**目标**：确认计划与 accepted authority 对齐，再进入实现。

- GOAL 保持唯一活跃目标；
- ADR-010 endpoint artifacts 以 v10 为准，不恢复 AsyncAPI；
- ADR-002 §7.4/§7.5 不修改，不新增 executable UI 决策；
- 任何 lock-point 变化先停下取得 bao consensus，再按 PROCESS amendment。

### Track 1 — CTRL 通信地基

**定位**：这是 Irisy 消费的 CTRL 平台基础设施，不是 Irisy 私有能力模块。

#### 1A. Endpoint artifacts

- 导出 MCP `tools/list` input/output schemas；
- 形式化 §14 `describe` schema；
- 从 Rust typed external events 生成 JSON Schema/TS types；
- 建 stream binding registry，记录 event、endpoint、transport、auth、version、degradation；
- catalog 只消费生成 artifact，不爬源码；
- replacement 完整后在同一 change 退役旧 `mcp-schema.json` / `endpoint-catalog.md` 路径；
- 不生成或维护 AsyncAPI。

#### 1B. Typed bus production wiring

- 真实 producer 发布 `InternalMsg`，不绕过 typed EventBus；
- actor handler 逐步收窄到正类型；
- internal event 不直接跨出信任域；
- projection bridge 按 subscriber scope/redaction 产生 external event；
- `query{watch}` 经 `:17873` 建立、审计和撤销，热流经 Channels/WS；
- bounded queue、disconnect、revocation、last-snapshot degradation 有测试。

#### 1C. 当前与未来接缝分层

当前 Irisy 闭环必须验证：

1. frontend/backend = Tauri IPC + token WS；
2. module/module = Actor + bounded Channel/Event；
3. Irisy/frontend stream = Tauri Channels + WS；
4. capability ingress/egress = MCP through gate；
5. provider calls = Kernel provider router；
6. watch authorization = `:17873`，payload = Channels/WS。

分阶段验证，不阻塞当前闭环：

7. BYO coding agent 的 ACP enhancement；
8. WebRTC/mesh 与跨设备 protobuf 腿。

**验收**：cargo lib tests、endpoint artifact drift test、`:17873` harness、desktop Channel smoke、browser WS smoke、governance、独立 review。

### Track 2 — Markdown / 文档能力当前切片

**定位**：严格执行 GOAL 已分派的 Track 2 slice，不在本计划中扩成 Notes/PWA 重构。

- 退役五个冗余 Brain-facing 写工具：`smart_table_update_cell`、`smart_table_append_row`、`smart_table_delete_row`、`smart_table_add_field`、`smart_table_create`；
- 以既有 `smart_table_produce` 作为唯一替代写入口，不新建平行 surface；
- 用 Irisy 真机/harness 覆盖上述五类操作的替代路径，并确认 review/gate 行为；
- 在同一 change 将漂移设计文档 `unified-productivity-suite-architecture.md` 明确标记 retired，避免双 authority；
- 用户内容继续是 Markdown/frontmatter，SQLite 只作可重建索引；
- 不把 Notes、PWA produce 收敛或“capability module 三件套”纳入这个 active slice；如需扩展，按 owning ADR 另立切片并由 bao 确认。

**验收**：五个旧工具不再由 Brain 发现/调用，五类操作均通过 `smart_table_produce` 有 fresh Irisy evidence，漂移文档已 retired，governance/diff 检查通过。

### Track 3 — HTML / artifact 通用渲染

- §14 produce 生成本地 artifact；
- viewer registry 按 content type 选择 Markdown/HTML/code/table/image/PDF viewer；
- FeaturePackScene 与 morphing output 复用 generic ViewerHost contract；
- 保留 raw input、transformed artifact、本地 output 的 drill-down；
- HTML viewer 不获得 Tauri、gate bearer、keychain、filesystem 或任意 extension API；
- smart-table workspace 继续作为功能包的通用产品操作面。

**明确不做**：iframe extension host、MCP Apps `ui://`、pack JavaScript/WASM、per-pack component。

### Track 4 — 两条 Brain 路径与能力创作

- Irisy 默认使用 bundled Hermes；
- 用户自己的 CLI 通过 projection 发现 `:17873` MCP gate 与作用域资产，agent loop 始终归用户 CLI；
- Skills 当前通过 gate 的 `list/read` 工具供两条 Brain 路径消费；直接向 BYO CLI 投影 `SKILL.md` 是 accepted target，implementation 属于 future slice；
- 两条路径的工具调用都回到 `:17873` gate；
- ACP 仅作为 accepted roadmap 的增强传输，不形成第三套 Brain runtime；
- pack creator 产出 manifest/Skills/MCP server resource，经 research → confirm → validate → install → smoke；
- 用真实 connector 验证 discover → scaffold → govern → install；
- downloadable pack 不实现 ACP/MCP host、权限系统或前端 runtime。

### Track 5 — L1/L2 与 role context 绑定

**定位**：L1/L2 是产品呈现结构，不是第四个能力面。

- L1 是模块/数据导航，role 是 Irisy 每轮 context；
- role 形态为 `(persona, packs, KB)`，与对话历史正交；
- 绑定使用声明式 metadata，避免按 pack id 写前端分支；
- 通用 viewer/smart-table/workspace 由内容类型决定；
- Settings/Discover 等无 role route 保持纯导航；
- “capability module = surface + source + gate”只作为分析 lens，不升级为 accepted 抽象。

**验收**：tsc、vitest、Playwright L1/L2 + role 切换、gate harness、独立 review。

## 5. 执行顺序

```text
Track 0 authority 对齐
  ├─ Track 2 当前已分派切片：退役五个 bespoke smart-table 写工具 + 漂移文档
  └─ Track 1 当前通信主链 + endpoint artifacts

Track 1/2 地基取得各自 fresh evidence 后：
  → Track 3 generic artifact rendering
  → Track 4 两条 Brain 路径 + pack creation
  → Track 5 navigation/role binding

ACP enhancement 与 mesh/cross-device 各自作为后续独立切片，
不阻塞当前 Irisy → gate → capability → local output 闭环。
```

Track 1 与当前 Track 2 是 Track 0 之后相互独立的地基工作；Track 2 已由 GOAL 分派并处于 in-progress，不等待 Track 1。Track 内使用最小 coherent slice；一次只处理一个 authority owner。Tracks 3–5 等地基取得对应 evidence 后再推进，不能发明协议、执行 runtime 或 UI runtime。

## 6. 全局反偏离清单

每个 slice 开始前检查：

- [ ] 是否直接服务 GOAL 的一个成功标准？
- [ ] 是否读了 owning ADR？
- [ ] 是否区分 Irisy 表现能力与 CTRL 实现所有权？
- [ ] 是否保持两条 Brain 路径，不新增第三套 agent loop？
- [ ] 是否只使用 MCP/API/Skills 三个能力面？
- [ ] 跨域调用是否全部经过唯一 `:17873` gate？
- [ ] 是否把组合留给 Brain + Skills，而非新建 workflow engine？
- [ ] 是否把通信实现留在主程序？
- [ ] 是否只新增 data/config/content/server resource，而不是 CTRL pack-specific code？
- [ ] 是否按内容类型使用 generic viewer/smart-table？
- [ ] 是否意外恢复 AsyncAPI、第二权限系统或双执行面？
- [ ] 是否把 future ACP/mesh 误设成当前闭环 blocker？
- [ ] 是否把非权威计划或 strategy note 当成 architecture truth？
- [ ] 若改变 lock-point，是否先取得 bao consensus 并 amendment ADR？

## 7. 验证循环

每个 Track 均执行：

1. **Anchor**：重读 GOAL 对应 criterion；
2. **Govern**：重读 owning ADR 与 PROCESS；
3. **Design**：先定义 ownership、state flow、endpoint/type；
4. **Implement**：最小 coherent change，non-trivial code 使用正确 ADR citation；
5. **Verify**：affected compiler/typecheck、targeted tests、runtime/gate smoke、必要 UI visual；
6. **Review**：独立 reviewer 对照本计划与 owning ADR；
7. **Confirm**：fresh `git status`/diff，并明确未验证项。

计划/治理检查：

```bash
bash scripts/check-adr-acceptance.sh --soft
node scripts/check-governance.mjs --worktree
git diff --check
```

发布不属于本计划。只有用户重新明确要求、发布前置条件满足并经过 remote production confirmation 后，才恢复 release task。

## Appendix A — Authority map

| Concern | Owner |
|---|---|
| five primitives / Kernel topology | ADR-001 spine |
| §14 / gate / MCP host / projection / pack runtime | ADR-002 substrate |
| single PWA / viewer registry / smart-table / L1-L2 | ADR-003 frontend |
| sandbox / supply chain / updater | ADR-004 cap |
| Irisy product/brain/role intent | ADR-005 irisy |
| trust domains / transports / endpoint specification | ADR-010 communication |

## Appendix B — Ownership summary

```text
Irisy
= 用户入口 + persona + role context + 能力消费 + 治理 UX

Brain
= Hermes 或 BYO CLI 的 agent loop + 工具调度

CTRL Kernel
= MCP host + Provider router + Gate + Protocol adapters + Effect + Audit

Feature packs / Skills
= 可下载的能力定义、知识、模板与 connector resource
```

任何 replacement 成为权威时，必须在同一 governed change 中退休旧 authority；不能保留两套 live truth。