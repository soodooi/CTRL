# Irisy 能力中心 — 主程序边界驱动的实施计划

> **文档角色**：非权威实施计划。`vault/ctrl/GOAL.md` 是活跃目标，`vault/ctrl/adrs/` 是唯一架构权威。
>
> **状态**：REWORKED / ADR-010 v10 已对齐，Track 1 可进入实现。
>
> **核心原则**：Irisy 的五个能力域复用同一个 CTRL 主程序；能力通过可下载资源扩展，但通信、治理和渲染 runtime 永远留在主程序。

## 1. 目标与成功标准

本计划服务于 GOAL 的五个能力域：

| 能力域 | 主程序提供 | 可下载资源提供 | 用户表面 |
|---|---|---|---|
| md 文档管理 | §14 text/record runtime、vault/index、通用 Markdown/smart-table viewer | schemas、templates、Skills、KB/content seeds | Notes/KB workspace |
| html / artifact | §14 produce、viewer registry、通用安全 HTML viewer | HTML 内容或结构化 artifact，**不含可执行 UI runtime** | morphing output / generic viewer |
| coding | projection、gate、MCP/ACP adapters、Code Space surface | CLI/agent assets、Skills、pack creator templates | Coding workspace |
| 通信 | `:17873`、MCP host/server、typed bus、IPC/Channels/WS/ACP/WebRTC adapters | MCP server declarations 与 connector services | Irisy/tool stream/connections |
| L1/L2 导航 | 单一 PWA、L1 rail、L2/module binding、role context | pack metadata、persona/KB declarations | capability navigation |

成功标准：

1. 用户安装一个主程序，其他能力可作为资源按需下载；
2. 新资源不修改 CTRL Rust/TypeScript，不自带通信 runtime；
3. 通信八条接缝有明确 protocol、理由和可生成 endpoint spec；
4. AsyncAPI 已由 `ADR-010 communication § endpoint-spec v10` 从 accepted architecture 退役；
5. 前端只按内容类型和通用 workspace 渲染，不存在 pack-specific executable UI；
6. 每个 Track 有 compiler/test/harness/UI/governance 的 fresh evidence。

详细 installer/resource 表和八缝矩阵见同目录 `1784712773722-ctrl-architecture-optimization.md`。该文档也是非权威计划，不替代 ADR。

## 2. 全局边界

### 2.1 必须在主程序内

- Tauri shell、Rust kernel 和五 primitives；
- `:17873` gate、MCP host/server、typed EventBus；
- Tauri IPC/Channels、WS、ACP、WebRTC/mesh adapters；
- keychain、review、audit、sandbox、updater/rollback；
- 单一 PWA、viewer registry、smart-table、FeaturePackScene 和通用 forms/viewers；
- registry/install/provision/auth/projection engines。

### 2.2 可以按需下载

- feature-pack manifests、MCP servers/connectors；
- Skills、personas、templates、schemas、KB/content seeds；
- registry/provider/model catalogue 数据；
- 由主程序 adapter 管理的 pinned external agent/runtime assets。

### 2.3 永远不作为资源下载

- pack-specific React components；
- HTML/CSS/JavaScript/WASM executable UI bundles；
- iframe/MCP Apps `ui://` hosts 或 MessageChannel bridge；
- pack 自带 gate、WebSocket、ACP 或其他协议实现；
- secret、gate bearer 或用户内容副本。

该边界服从 ADR-002 §7.4 manifest=data/runtime=generic 与 §7.5 zero-bespoke frontend；本计划不提出反向 amendment。

## 3. Tracks（地基到表面）

### Track 0 — 治理与 authority 对齐

**目标**：确认计划与 accepted authority 已对齐，再进入实现。

1. [x] GOAL 保持当前活跃目标，未重复“切换 GOAL”。
2. [x] bao 确认 ADR-010 endpoint-spec 的替代形态：
   - MCP `tools/list` JSON Schema；
   - §14 `describe` schema；
   - typed command/external-event JSON Schema；
   - Tauri IPC/Channels/WS binding、auth、version、degradation registry；
   - protobuf 仅跨设备腿。
3. [x] `ADR-010 communication § endpoint-spec v10` 已按 PROCESS 原地 amendment，明确 **不采用 AsyncAPI**。
4. [x] ADR-002 §7.4/§7.5 未修改；未新增 executable UI 决策。
5. [x] ADR-010 frontmatter/changelog/sections 与 INDEX 已同步；治理检查见本次 amendment evidence。

**Authority anchor**：Track 1 现在以 `ADR-010 communication § endpoint-spec v10` 为准，可以实现 generated endpoint artifacts；任何新的 lock-point 变化仍须先停下问 bao。

### Track 1 — 通信地基（优先）

**目标**：完成 GOAL 的 endpoint specification + typed bus，并让通信完全属于主程序。

#### 1A. Endpoint artifacts

- 导出 MCP `tools/list` input/output schemas；
- 形式化 §14 `describe` schema；
- 从 Rust typed external events 生成 JSON Schema/TS types；
- 建 stream binding registry，列出 event、WS/Channel endpoint、auth、protocol version、degraded behavior；
- catalog 只读生成 artifact，不爬源码；
- 不生成或维护 AsyncAPI。

#### 1B. Typed bus production wiring

- 真实 producer 发布 `InternalMsg`，而不是继续绕过 typed EventBus；
- actor handler 逐步收窄到正类型；
- internal event 不直接出信任域；
- projection bridge 按 subscriber scope/redaction 产生 external event；
- `query{watch}` 经 `:17873` 建立/审计/撤销，热流经 Tauri Channels/WS；
- bounded queue、disconnect、revocation、last-snapshot degradation 有测试。

#### 1C. 八缝一致性

逐项验证：

1. frontend/backend = Tauri IPC + token WS；
2. module/module = actor + bounded channels；
3. Irisy/frontend stream = Tauri Channels + WS；
4. capability ingress = MCP through gate；
5. third-party app = MCP；
6. watch substrate = Channels + WS, authorization at gate；
7. coding agent = MCP + ACP；
8. mesh = WebRTC/Olm/Automerge/CBOR，remote control protobuf only。

**验收**：cargo lib tests、endpoint artifact drift test、`:17873` harness、desktop Channel smoke、browser WS smoke、governance、独立 review。

### Track 2 — md 文档管理收敛

**目标**：基于已有 `RecordSink`/`ProduceOp` 和 §14 source 收敛脑面，不重建已经存在的基础。

- 核实统一 `describe/query/produce` 与当前 PWA 写路径；
- 对 bespoke smart-table tools 做 caller/parity inventory；
- 任何退役先提供兼容期与 Irisy harness evidence；
- 用户内容继续是 Markdown/frontmatter，SQLite 只作可重建索引；
- 不把“capability module 三件套”提升为新架构抽象，除非 owning ADR 先决定。

**决策点**：PWA 是否收敛到 §14 produce 涉及既有 surface，若 ADR 无明确答案，停下问 bao。

### Track 3 — html / artifact 通用渲染

**目标**：把 HTML 与其他 artifact 统一走 content-type viewer，不把 HTML 误解成第三方 app runtime。

- §14 produce 生成本地 artifact；
- viewer registry 按 content type 选择 Markdown/HTML/code/table/image/PDF 等现有 viewer；
- FeaturePackScene 与 morphing output 复用 generic ViewerHost contract；
- 保留 raw input、transformed artifact、本地输出的 drill-down；
- HTML viewer 不获得 Tauri、gate bearer、keychain、filesystem 或任意 extension API；
- smart-table workspace 继续是功能包的通用产品操作面。

**明确不做**：iframe extension host、MCP Apps `ui://`、pack JavaScript/WASM、per-pack component。

### Track 4 — coding 能力连贯化

**目标**：让 projection 与 pack creation 在产品上连贯，但保持两条脑路径和一条 gate。

- 用户自己的 CLI 通过 projection 发现 MCP/Skills/assets，agent loop 仍归 CLI；
- Irisy 的 bundled Hermes / selectable engine 通过现有受控路径调用 gate；
- pack creator 产出 manifest/Skills/MCP server resource，经 validate → install → smoke；
- 用一个真实 connector 验证 discover → scaffold → govern → install；
- 不让 downloadable pack 实现 ACP/MCP host 或前端 runtime。

### Track 5 — L1/L2 与 role context 绑定

**目标**：在现有 ADR-003/005 role 模型内，把模块导航与 `(persona, packs, kb)` context 绑定。

- L1 仍是模块/数据导航，role 是 Irisy 每轮 context，两者不混为架构层；
- 绑定使用声明式 metadata，避免按 pack id 写前端分支；
- 通用 viewer/smart-table/workspace 由内容类型决定；
- Settings/Discover 等无 role 的 route 保持纯导航；
- “capability module = surface + source + gate”只可作为分析 lens，不作为 accepted 抽象，除非 owning ADR amendment。

**验收**：tsc、vitest、Playwright L1/L2 + role 切换、gate harness、独立 review。

## 4. 执行顺序

```text
Track 0 ADR-010 amendment
  → Track 1 endpoint artifacts + typed bus
  → Track 2 md convergence
  → Track 3 generic artifact rendering
  → Track 4 coding/pack creation
  → Track 5 navigation/role binding
```

Track 内使用最小 coherent slice；一次只处理一个 authority owner。Track 2/3 可在 Track 1 的 ADR amendment 后并行设计，但不能各自发明协议或 UI runtime。

## 5. 全局反偏离清单

每个 slice 开始前检查：

- [ ] 是否直接服务 GOAL 的一个成功标准？
- [ ] 是否读了 owning ADR？
- [ ] 是否把通信实现留在主程序？
- [ ] 是否只新增 data/config/content/server resource，而不是 CTRL pack-specific code？
- [ ] 是否按内容类型使用 generic viewer/smart-table？
- [ ] 是否意外恢复 AsyncAPI？
- [ ] 是否意外引入 executable UI/iframe/JS/WASM/MCP Apps？
- [ ] 是否把非权威计划或 strategy note 当成 architecture truth？
- [ ] 若改变 lock-point，是否先停下取得 bao consensus 并 amendment ADR？

## 6. 验证循环

每 Track 均执行：

1. **Anchor**：重读 GOAL 的对应 criterion；
2. **Govern**：重读 owning ADR 与 PROCESS；
3. **Design**：先定义边界、state flow、endpoint/type；
4. **Implement**：最小 coherent change，non-trivial code 使用正确 ADR citation；
5. **Verify**：affected compiler/typecheck、targeted tests、runtime/gate smoke、必要 UI visual；
6. **Review**：独立 semantic reviewer 对照用户三项要求；
7. **Confirm**：fresh `git status`/diff，并明确未验证项。

计划/治理检查：

```bash
bash scripts/check-adr-acceptance.sh --soft
node scripts/check-governance.mjs --worktree
git diff --check
```

发布不属于本计划。只有用户重新明确要求、发布前置条件满足并经过 remote production confirmation 后，才恢复 release task。

## Appendix A — Authority map（参考）

| Concern | Owner |
|---|---|
| five primitives / kernel topology | ADR-001 spine |
| §14 / gate / MCP host / projection / pack runtime | ADR-002 substrate |
| single PWA / viewer registry / smart-table / L1-L2 | ADR-003 frontend |
| sandbox / supply chain / updater | ADR-004 cap |
| Irisy product/brain/role intent | ADR-005 irisy |
| trust domains / eight seams / endpoint specification | ADR-010 communication |

## Appendix B — Preserved governance lessons

- ownership matrix 用于避免一个计划同时重定义 kernel、frontend、security 和 communication；
- ADR dependency order 用于确保 contract owner 先决定、consumer 后实现；
- `pack_sandbox.rs` 只治理 shell/process sandbox；
- `reconnect_installed_pack_servers` 的存在证明 server resource 可由 generic host 重连，但不授权 executable UI；
- ADR-004 staged signing debt 仍按其 own scope 管理，不能被拿来为不存在的 UI extension lifecycle 扩 scope；
- 任何被 replacement 取代的 live authority 必须在同一 governed change 中退休，不能保留双真相。
