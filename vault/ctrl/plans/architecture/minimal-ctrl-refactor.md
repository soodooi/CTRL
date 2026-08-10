---
title: CTRL full-stack minimal architecture refactor
kind: execution-plan
status: active
normative: false
last_updated: 2026-08-05
owner: bao
architecture_authority: ../../adrs/INDEX.md
active_goal: ../../GOAL.md
historical_context: ../../irisy-architecture.md
---

# CTRL 全栈极简架构重构计划

> bao 2026-08-05 确认：极简范围同时覆盖界面、后端、Irisy 身份和能力层。本文只规定迁移顺序、切片和验收，不是架构权威。所有决定必须作为 coordinated amendment set 回到 [`adrs/INDEX.md`](../../adrs/INDEX.md) 指向的 owning module ADR；整组一致并接受前不得实施冲突代码。

## 1. 目标

> **一个 Irisy 在显式 Resource 上，经 `:17873` 使用 `describe/query/produce`，结果按内容类型呈现并回到本地文件或原应用。**

用户只需理解：

1. **Resource**：文档、表格、项目、应用选区、功能包数据或任务结果。
2. **Irisy**：唯一产品 AI 身份。
3. **Skill**：可选方法，不是运行时或身份。
4. **Feature Pack**：产品级创造、安装、分享单位，声明 Resources、Skills、presentation 与 provisioning。

唯一产品调用链：

```text
PWA / Irisy / BYO CLI / Remote
              ↓
          :17873 Gate
              ↓
auth · visibility · audit · ReviewGate
              ↓
      ResourceRef resolver
              ↓
        Resource owner
              ↓
   describe / query / produce
              ↓
Outcome | ResourceRef | OperationRef
              ↓
       typed event projection
```

## 2. 已确认方向

1. **唯一 Irisy**：不再把 Assistant/Coding 作为两个用户身份；Coding 是 Project Resource 上的 Skill/Capability scope。
2. **三动词 agent 面**：Irisy 的 canonical product tool surface 最终只有 `describe(ref)`、`query(ref, request)`、`produce(ref, operation)`。
3. **固定人格、动态上下文**：领域差异由 Resource + Skill + Pack 表达，不由 role/persona registry 表达。
4. **一条产品 API**：Shell-only 系统职责走 typed Tauri IPC；所有产品能力走 `:17873`，不保留业务 MCP/Tauri 双实现。
5. **Feature Pack 保持产品级**：Pack 是声明式分发容器，不生成新模块、身份、协议、手写路由或 per-pack UI 分支。
6. **Workbench canvas 退出产品架构**：composition canvas 退休；ADR-007 中仍有效的 Skill discovery 决定先迁入明确 owner，再 deprecated module。
7. **一个前端 authority**：Ambient shell、content-type viewer registry 和 Library 成为唯一活实现；legacy routes 仅短期 compatibility redirect。
8. **一个事件事实流**：内部 typed event 是事实；Channels/WS 只做授权后的外部投影。

## 3. 不变锁点

- Actor、Capability、Event、Channel、Effect 五 primitives；
- `describe/query/produce` 及 query/produce 读写隔离；
- `:17873` 是跨域治理门；
- secrets 只在 OS keychain 或应用权威边界，永不进入 LLM；
- local/plain text 是 truth，数据库仅为可重建派生状态；
- Feature Pack manifest=data、runtime=generic、新增 pack 零 CTRL 代码；
- MCP/API/Skills 是互补来源，但不成为 Irisy 的三套心智模型；
- Workspace/Companion/Artifact 是呈现形态；
- BYO CLI 的 agent loop 由用户自己的 CLI 拥有；
- mutation 经过 ReviewGate，Effect 支持 status/watch/cancel/idempotency；
- 不做工作流编辑器、长尾 connector 集合、IDE、第二编辑器或多租户 SaaS。

## 4. 目标对象模型

### 4.1 ResourceRef

示例：

```text
ctrl://local/note/daily/2026-08-05
ctrl://local/record/tables/customers
ctrl://local/blob/artifacts/report.html
ctrl://local/project/ctrl
ctrl://app/selection/libreoffice/current
ctrl://pack/source/stock-cn/market
ctrl://local/operation/01J...
ctrl://local/system/catalog
```

ResourceRef is a Capability service address, not a sixth primitive. ADR-002 v81's `ctrl://<authority>/<kind>/<id>[?rev=...]` is the sole grammar; each `(authority, kind)` has one owner/resolver. OperationRef is an opaque lifecycle reference associated with a ResourceRef, not another URI scheme.

**实现前必须在 ADR-002 锁定安全语法：**

- scheme registry 和 collision 规则；
- UTF-8/percent encoding、separator、query/fragment 规则；
- canonical form 与同一资源唯一标识；
- 相对路径、`..`、absolute path 和 malformed encoding 一律 fail closed；
- canonicalize 后执行 root containment 与 symlink escape 检查；
- resolve-to-use must be race-free: stable directory/file handles with component-by-component no-follow traversal are mandatory; if the platform cannot provide an equivalent primitive, return typed unavailable rather than falling back to check-then-open;
- 并发 symlink、rename 和目录项替换必须有故障注入测试并 fail closed；
- macOS/Windows 大小写、drive、UNC 和 separator 差异；
- 从实际访问句柄确认 canonical identity 后，再按 caller、scheme、resource scope 授权；
- 错误不得泄漏 root、secret 或越权资源存在性。

### 4.2 ResourceDescriptor

`describe` 至少返回：

```text
ref · kind · protocol_version · provenance · freshness
query schema/operators · produce operation schemas
presentation hints · watchability · degradation
```

descriptor 是字段、操作和 presentation hints 的唯一 owner。

### 4.3 OperationRef

Long-running work returns an opaque OperationRef associated with its ResourceRef; status/watch/cancel flow through canonical `query(ref, request)` / `produce(ref, operation)`, not an `operation://` scheme:

- `query(operation_ref)` 读取状态；
- `query(operation_ref, watch=true)` 观察进度；
- `produce(operation_ref, cancel)` 取消；
- 完成后返回 ResourceRef 或 Outcome。

ADR-002/010 必须先决定：owner、idempotency key、提交后响应丢失的重试、terminal-state retention、expiry、应用重启恢复、无法恢复时的 typed degraded/unavailable 结果。不得再为每个能力创建 `start/status/cancel` 工具族。

### 4.4 Skill

Skill 仅为本地 Markdown 方法：当前 Irisy 读取使用，或投影给 BYO CLI。Skill 不 spawn agent、不拥有 session、不绕 gate、不证明依赖能力已安装。

### 4.5 Feature Pack

Pack manifest 声明：

```text
Resources/Sources · Produce operations · Skills · Knowledge
Presentation · Provisioning · Credential references · Runtime adapter
```

Pack 安装后只向 registry 增加声明；前端和 kernel 不允许按 pack id 分支。

## 5. 目标运行边界

### 5.1 Shell

只拥有 hotkey、window、tray、updater、native dialog、keychain 和 app lifecycle。Shell command 不表达 Notes/Table/Pack/Irisy 业务。

### 5.2 Kernel

唯一产品后端，拥有 Gate/policy、Resource registry、runtime owner、audit/review、typed internal event、derivative state 与 external projection。

### 5.3 Capability child

LibreOffice bridge、下游 MCP、工具 CLI 等按需启动。child 只向 owner adapter 提供内部能力，不直接暴露给 Irisy，不建立第二 gate。

### 5.4 BYO CLI

BYO CLI 是 `:17873` 的外部客户端，不是第二 Irisy 身份。CTRL 不复制、监督或合并其 agent loop。

## 6. 迁移硬规则

1. **先 ADR，后实现**：计划不能授权与 accepted ADR 冲突的代码。
2. **coordinated authority set**：相关 ADR 可按依赖顺序起草，但只有全部 ADR、INDEX、PRODUCT、Acceptance 和引用一致后才一起接受；冲突中间态不能作为 commit/merge checkpoint。
3. **纵向切片，不 big-bang**：每片迁一个真实 Resource，从 Irisy/PWA 到 truth/viewer 全链验证。
4. **新 authority 先立，旧 authority 同片退休**：alias 只能薄转发到唯一实现。
5. **aliases 不是第二实现**：禁止复制逻辑；必须记录 caller、版本和使用。
6. **数据不迁移优先**：保留 Markdown、原生应用和 manifest，优先迁调用面。
7. **先读后写**：每类 Resource 先证明 describe/query，再单独批准 produce。
8. **数据级 rollback 是 produce 前置条件**：每个 write vertical 必须声明 revision/hash 前置条件、写前恢复点、原子/原生提交、写后 reread、部分失败处理和 rollback smoke；Git 恢复代码不算恢复用户数据。不能证明安全恢复的 App write 保持关闭并需单独 ADR 批准。
9. **compatibility 有期限**：alias 必须声明最短支持版本/时间窗、deprecated warning、调用者分类、升级 smoke、恢复条件；不能仅凭一次本机零计数删除。
10. **不覆盖现有工作**：当前 branch 的代码、ADR-002、ADR-005、INDEX 修改先独立收口或 park。

## 7. 执行 Tracks

### Track 0 — 治理和架构权威

#### T0.1 工作区隔离

在重构前记录：

- baseline commit；
- `git status --short` 完整 path manifest（含 untracked）；
- 每组修改所属目标；
- 对应 commit、branch 或 patch 标识及恢复命令；
- ADR-002/005/INDEX 与关联 `CodingAgentPanel.tsx`、`skills.rs` 作为同一前序 change set 处理。

建立 focused branch 后提供 clean-status 证据。不得只记录三个 ADR 文件而遗漏代码。

#### T0.2 最小 authority inventory

在 amendment 前生成一次最小清单：

- live identity/transcript authorities；
- live L1/shell authorities；
- capability contract 和 gate surfaces；
- ADR-007 canvas 与 Skill discovery 子域 owner；
- `irisy-architecture.md` live 引用。

每项写明 source set、排除项、生成命令和预期值。Track 1 再扩展为 CI ratchet。

#### T0.3 coordinated ADR amendment set

按依赖顺序起草，但整组一次接受：

1. **ADR-001 spine**：唯一 Irisy；Coding 是 Project Resource scope；BYO CLI 是外部 gate client；四层和五 primitives 不变。
2. **ADR-002 substrate**：ResourceRef grammar/security、registry、三动词 canonical agent contract、OperationRef lifecycle、compatibility policy、Skill 不执行 agent。
3. **ADR-005 irisy**：退休 Assistant/Coding identity split 和 role/persona registry；定义唯一 Irisy context；删除对 retired `irisy-architecture.md` 的 live 依赖。
4. **ADR-003 frontend**：一个 Ambient shell；L1=Work/Library/Settings；viewer registry 驱动；旧 routes 仅 compatibility。
5. **ADR-007 workbench**：逐项裁决两子域。Canvas 退休；Skill discovery 若保留，先把 search/install/source/token/CORS/cache 和唯一 discovery surface 分别迁入 ADR-002/003/006 的明确 section并保留 provenance；确认无 orphan decision 后再 deprecated 整个 module。
6. **ADR-010 communication**：typed production event、external projection、三动词 endpoint artifacts 与 bindings。
7. **ADR-004/006**：仅在真实 owner contract 有 delta 时 amendment。
8. 同步 **INDEX、PRODUCT、Acceptance、代码引用**。

整组 diff 运行 acceptance/governance；不得在部分 ADR accepted、其余仍冲突时提交。

**Track 0 验收：** coordinated set 一致；无 orphan authority；live 文档除 historical/changelog/provenance 外不再依赖 `irisy-architecture.md`；无产品代码变更。

### Track 1 — 全量基线和下降棘轮

从真实 schema/registry/AST 生成 inventories：

- agent-visible gate tools；
- product Tauri commands 与等价双表面；
- Resource/source implementations；
- raw event publishers；
- live shells/routes；
- role/persona registries；
- direct agent/CLI spawns；
- per-pack id branches；
- `start/status/cancel` 工具族。

每个指标定义生成器、计数范围、允许例外、期望值。棘轮只允许复杂度下降；inventory 不手写第二真相。

### Track 2 — Resource registry 地基

#### T2.1 核心类型

实现经 ADR 锁定的 ResourceRef parser/canonicalizer、ResourceDescriptor、resolver registry、typed Query/Produce、OperationRef 与 structured Feedback，并覆盖跨平台路径/encoding/symlink/authorization-after-resolution 测试矩阵。

#### T2.2 Note 纵向样板

```text
`ctrl://local/note/<path>` → existing owner → describe/query
→ approved produce + data rollback contract
→ Markdown truth → post-write reread → viewer refresh
```

旧 `note_*`/`doc_*` 仅转发到新 owner。

#### T2.3 逐类接入

Markdown/Text → Smart Table/Record → Blob/HTML → Pack sources → Provider outputs → LibreOffice read-only → Project/Coding → Operation。

每类 produce 都单独过数据 rollback 门；LibreOffice 和其他 App write 默认关闭。

### Track 3 — 三动词 canonical gate

#### T3.1 Canonical tools

```text
describe(ref)
query(ref, request)
produce(ref, operation)
```

`ctrl://local/system/catalog` owns discovery; descriptor returns typed schemas; produce enters ReviewGate; Effect returns OperationRef; watch is a query modifier.

#### T3.2 Compatibility lifecycle

- alias 只转发并发 deprecated warning；
- 记录 caller、app/pack version 和旧工具使用；
- Irisy 默认 scope 不投影旧名；
- PWA、内置 pack、BYO examples 和已知脚本逐个迁移；
- 至少跨一个声明的兼容版本窗口；
- 旧版升级 smoke、known-client migration、恢复演练和零使用证据同时满足后删除。

#### T3.3 Pack normalization

Pack action 转为 descriptor 的 typed produce operation；raw MCP/API 仅在 adapter 内可见；manifest validation 阻止无 schema operation；删除 per-pack dispatch。

增加一个纯 manifest synthetic pack fixture，证明 install → describe/query/produce → generic viewer 全链零 CTRL 代码变化。

### Track 4 — 唯一 Irisy

#### T4.1 Context

唯一输入：

```text
session_id · explicit Resources · optional pinned Skill
capability scope · policy · user task
```

固定 persona；不把 L1、Pack、KB 或 engine 组合成角色。

#### T4.2 Session migration

Assistant transcript 成为 canonical Irisy transcript；Coding 历史按 project 保留为只读可导入记录，不静默混入当前会话。删除 Identity selector；Resource 决定 project/document/application scope；Skill 保持 Auto 或显式 pin。

#### T4.3 Coding

Project 是 Resource；coding method 是 Skill；filesystem/edit/test 是 capabilities。BYO CLI 作为独立 gate client，不成为 Irisy owner。

#### T4.4 Skill execution

退休 `run_skill` 直接 spawn Claude 的产品路径；Skill 由 Irisy 读取，或投影给用户 BYO CLI；能力可用性从 catalog 检查。

### Track 5 — 一个前端工作面

- AmbientWorkbench 唯一；legacy shell 退休；旧 deep links 转发到 canonical Resource/Library view。
- L1 只保留 Work、Library、Settings；Irisy 持久存在，不是 L1。
- Library 展示 Resources、Capabilities、Packs、Skills、Discover，但对象模型保持正交。
- descriptor.presentation 选择 viewer；Notes/Tables/HTML/Code/Pack 不再由 `AmbientHome` 手写 scene。
- Today 变 Task saved query；Mobile 变 connection utility；删除 pack-id 特判。
- 自然语言为主；`@` 选 Resource；`/` 选 operation/Skill；`:` 退休并迁入 palette/search。

### Track 6 — 运行时和通讯

- typed EventBus 接真实生产 publisher；raw event 平行路径退休；
- InternalMsg 不进入 endpoint artifacts；external event 经授权/redaction/binding registry 投影；
- Shell Tauri commands 只保留 OS/UI responsibilities；product operations 经 gate；
- capability child 统一 health/shutdown/reconnect owner；
- endpoint artifacts 从真实 schema owners 生成。

### Track 7 — 删除和收口

仅在替代路径、兼容窗口、数据 rollback 和 fresh evidence 全部满足后删除：旧 tools/handlers、role/persona、identity split、legacy shell/routes、ADR-007 live code/deps、direct Skill spawn、raw event bridge、per-pack branches。全仓搜索只允许 retired concepts 出现在 historical/changelog/provenance 或尚在支持窗的明确 compatibility adapter。

## 8. Vertical 验收模板

每个 vertical 必须填写：

1. Resource scheme、canonical grammar、owner 与 truth；
2. describe/query schemas、provenance、degradation；
3. produce operations 与 ReviewGate；
4. revision/hash concurrency precondition；
5. 写前恢复点、原子/原生提交、partial failure；
6. post-write reread；
7. rollback smoke 与真实数据恢复证据；
8. OperationRef restart/idempotency（适用时）；
9. viewer 与 raw drill-down；
10. old alias 的支持窗口、调用者迁移和删除证据。

推荐顺序：Note → Smart Table → HTML/Blob → generic Pack → LibreOffice read-only → Project/Coding → Provider/Effect → Remote。不得同时迁完所有 source 再统一验证。

## 9. 验证矩阵

按受影响面执行最窄检查，并在涉及 Rust/PWA 时补齐：

```text
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --lib --manifest-path src-tauri/Cargo.toml
npm --workspace @ctrl/web run typecheck
npm --workspace @ctrl/web run test
```

跨 gate：authenticated harness、caller/visibility/audit、query 无 review、produce 有 review、OperationRef restart/watch/cancel/idempotency、alias parity 与跨版本升级。

写 vertical：并发冲突、故障注入、部分失败、post-write reread、rollback smoke；不能恢复的外部应用 write 保持关闭。

前端：Playwright；real Tauri IPC→gate harness；Resource/viewer/review/degradation。browser mock 不替代字段契约。

每 Track：independent semantic reviewer、focused diff、ADR soft gate、governance check、fresh success evidence。

## 10. 全局完成标准与计数口径

Track 1 必须为以下每项产出生成命令、source set、排除项和允许例外；无定义的数字不得用于完成声明。

1. 用户可见 Irisy identity = **1**。
2. Irisy 默认 scope canonical product tools = **3**；shell/diagnostics 与支持窗 alias 单列，不混入。
3. 每个 Resource scheme descriptor/owner = **1**。
4. 新增 synthetic manifest pack 时 CTRL tool/route/id branch diff = **0**。
5. live role/persona registry = **0**。
6. CTRL-initiated Skill-specific external agent spawn = **0**。
7. product business Tauri/MCP 双实现 = **0**。
8. raw production event publisher = **0**。
9. production shell authority = **1**。
10. per-pack UI id branches = **0**。
11. ADR-007 deprecated 后 live route/runtime/dependency = **0**，Skill discovery 有明确新 owner。
12. Markdown、Record、Blob、Project、App、Operation 各有真实 canonical vertical；App write 未批准时以 read-only + typed unavailable 为诚实验收。
13. 本地 truth、keychain、ReviewGate、audit、provenance、rollback 和 honest degradation 无回归。
14. macOS 与 Windows build/test 通过；核心桌面路径有真机证据。

## 11. 非目标

- 不在本计划中重写所有 viewer或改变用户文件格式；
- 不把 ResourceRef 做成云端对象数据库；
- 不让 pack 直接执行未治理代码；
- 不用 generic JSON 替代 typed descriptor schemas；
- 不合并 Shell API 与 product Gate；
- 不让 Irisy 监督 BYO CLI；
- 不顺带建设新功能包、远程桌面或 Office write；
- 不以长期 feature flag 维持两套架构。

## 12. 第一执行切片

**只做 Track 0，不写产品代码：**

1. 按 T0.1 保存当前 change set 的 baseline/path manifest/恢复标识并建立 clean focused branch；
2. 生成 T0.2 authority inventory；
3. 整组起草 T0.3 ADR amendments，不接受冲突中间态；
4. 同步 INDEX、PRODUCT、GOAL、Acceptance 和代码引用；
5. 跑 ADR/governance gates；
6. 独立 reviewer 确认无 orphan authority、双权威或未声明 lock-point 变化。

Track 0 整组 accepted 后，下一片才是 Track 1 inventories/ratchets；不得直接删除 identity、tools、routes 或启用任何 App write。

## Appendix A — T0.2 authority inventory baseline (2026-08-05)

This appendix records reproducible authority queries, not implementation-completion measurements. Run from the repository root. Results are evidence inputs for Track 1; generated/vendor/history/build trees are excluded so historical text does not masquerade as live authority. Do not turn expected architecture baselines into measured claims until command output is captured and reviewed.

### A.1 Common source set and exclusions

**Live authority set:** `PRODUCT.md`, `vault/ctrl/GOAL.md`, `vault/ctrl/adrs/*.md`, this active plan, first-party product sources under `packages/ctrl-web/src` and `src-tauri/src`, and governance scripts.

**Excluded from live-count claims:** `.git`, `node_modules`, `target`, `dist`, `build`, generated artifacts unless the query explicitly audits generation, `vault/ctrl/history`, archived goals/plans, ADR changelog and Provenance sections, tests/fixtures/snapshots when counting production surfaces, and third-party/vendored packages. Exclusions must be stated beside every reported count.

A portable file manifest for later queries:

```sh
git ls-files PRODUCT.md 'vault/ctrl/GOAL.md' 'vault/ctrl/adrs/*.md' \
  'vault/ctrl/plans/architecture/minimal-ctrl-refactor.md' \
  'packages/ctrl-web/src/**' 'src-tauri/src/**' 'scripts/**'
```

### A.2 Identity and transcript authority

```sh
git grep -nE 'Assistant|Coding|AgentMode|persona|role.registry|transcript|session' -- \
  PRODUCT.md vault/ctrl/GOAL.md vault/ctrl/adrs packages/ctrl-web/src src-tauri/src
git grep -nE 'coding_singleton|coding.*history|hermes.*history|IrisySession|transcript-store' -- \
  packages/ctrl-web/src src-tauri/src
```

Expected architecture baseline: one fixed user-visible Irisy identity; one live Irisy transcript authority; Project coding represented by explicit Resources plus optional Skill/capability scope; Hermes and former Coding history are read-only import material; role/persona registry and Skill-owned session/spawn authority are zero. Changelog, retired-v40 provenance, test names, and compatibility migration code are classified separately rather than counted as live product authority.

### A.3 Shell, L1, routes, and rendering

```sh
git grep -nE 'Sidebar|L1|Work|Library|Settings|/coding|/discover|/pool|scene|viewer|content_type|pack[_-]?id' -- \
  PRODUCT.md vault/ctrl/adrs/003-frontend.md packages/ctrl-web/src
git grep -nE 'if.*pack|switch.*pack|scene.*===|pack.*===' -- packages/ctrl-web/src
```

Expected architecture baseline: one Ambient production shell; L1 exactly Work/Library/Settings; Irisy resident but not L1; viewer selection driven by ResourceDescriptor/content type; no business-scene or per-pack-id rendering branch. Legacy routes are only thin, version-windowed redirects and are reported separately until removed.

### A.4 Gate and capability surface

```sh
git grep -nE 'describe\(|query\(|produce\(|source_describe|source_query|source_produce|mcp_server|invoke\(' -- \
  vault/ctrl/adrs packages/ctrl-web/src src-tauri/src
git grep -nE 'ReviewGate|review_gate|:17873|ResourceRef|ResourceDescriptor|OperationRef' -- \
  PRODUCT.md vault/ctrl/adrs packages/ctrl-web/src src-tauri/src
```

Expected architecture baseline: canonical cross-domain product surface exactly `describe(ref)`, `query(ref, request)`, `produce(ref, operation)` through `:17873`; ReviewGate governs mutations; shell-only OS/UI duties may use typed Tauri IPC; business dual surfaces are zero after migration. Compatibility aliases must be identified with owner and removal window rather than silently included in the canonical count.

### A.5 ADR-007 domains and migrated owners

```sh
git grep -nE 'ADR-007|workbench|React Flow|orchestrator|discovery|search|install|registry' -- \
  PRODUCT.md vault/ctrl/GOAL.md vault/ctrl/adrs vault/ctrl/plans/architecture/minimal-ctrl-refactor.md \
  packages/ctrl-web/src src-tauri/src
git grep -nE 'Library|hot-scanned local registry|normalized provider|anonymous local install|ctrl-cloud' -- \
  vault/ctrl/adrs/{002-substrate,003-frontend,006-cross-cutting,007-workbench}.md
```

Expected architecture baseline: ADR-007 is deprecated provenance only; canvas/orchestrator have no live route/runtime authority; local registry/install/source policy is owned by ADR-002 v81; Library UI by ADR-003 v40; cloud search policy by ADR-006 v13. There is no orphan discovery decision and no second registry/search UI.

### A.6 Retired `irisy-architecture.md` live-reference audit

```sh
git grep -n 'irisy-architecture.md' -- PRODUCT.md vault/ctrl/GOAL.md vault/ctrl/adrs \
  vault/ctrl/plans packages/ctrl-web/src src-tauri/src
git grep -n 'irisy-architecture.md' -- vault/ctrl/adrs/005-irisy.md
```

Expected architecture baseline: no live normative or implementation dependency. Allowed matches are explicitly historical changelog/provenance text, archived context, the GOAL's retirement note, and this inventory query. Any source import, active frontmatter authority key, governing-SSOT statement, or implementation citation is a failure to classify and remove before Track 1.
