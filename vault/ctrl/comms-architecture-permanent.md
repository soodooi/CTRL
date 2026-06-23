# CTRL 通讯架构 — 永久内核设计

> Status: ACCEPTED v1 (2026-06-22, bao 钦定「永久使用的那种」)
> 取代: `vault/ctrl/comms-protocol-refactor.md` (那是诊断 draft;本文是其结论的收敛成品)
> Governing ADR: ADR-002 substrate §14 (v32, describe/query/produce + §14.7 subscribe) + ADR-010 communication
> 一句话: **一个窄腰、两个信任域、三个动词、N 个传输、降级即契约。**

---

## 0. 为什么现在「太复杂」—— 根因是维度坍缩

复杂度不来自模块多,来自**四个正交维度被搅在一根线上谈**。每加一个需求,四个维度同时长东西:

- 5 种 source × 2 种表面 (Tauri command / MCP tool) × N 种传输 (IPC / WS / stdio / HTTP / ACP / mesh)
- subscribe 想当「第四动词」,把传输语义塞进数据语义的枚举
- gate 既当安全边界、又当内部总线;ST-SS 旁路 gate → 审计盲区
- 双表面靠手工收编,无生成源、无棘轮 → 边收边长

**修复方式不是再加协议,是把四个维度切干净,每维只准一个简单答案。** 切干净后系统从 `N×M×K` 的乘积复杂度塌成 `N+M+K` 的加法复杂度 —— 这是本设计全部价值的来源。

---

## 1. 四个正交维度 (永久骨架)

| 维度 | 问题 | 永久答案 | 对标取经 |
|---|---|---|---|
| **What** (数据语义) | 能对数据做什么 | **三个动词,冻结**: `describe` / `query` / `produce` | GraphQL query≠mutation + CQRS 读写分离 + Plan9「一组操作覆盖所有资源」 |
| **How** (传输) | 字节怎么搬 | 传输是可插拔驱动,**一次定义→多传输派生** | 9P / gRPC IDL 派生多端 + tauri-specta/ts-rs |
| **Who** (信任) | 谁能调 | **两个信任域、一条 gate**: 内核域直连零治理;跨域必经 :17873 | Erlang/OTP 进程内消息 + capability-based security |
| **When-broken** (降级) | 坏了怎么办 | **降级/冲突是契约一等公民**,每源在 `describe` 自报 | CRDT / local-first: 离线是默认不是异常 |

正交的含义: 改任一维度不波及其它三个。加 content-type 只动 What;加传输 (未来 mesh) 只动 How,语义治理不变;收紧安全只动 Who;接易离线的源只动 When-broken。**腰不动,两头随便长 —— 这就是「永久」的工程定义。**

---

## 2. 维度 What: 三动词,且**读写物理分离** (已是代码现实)

CTRL 现状已经验证了这个设计 —— `kernel/query.rs` 顶部注释明写「the **read half** of the Unified Operation Interface」:

```rust
// 读半边 (已实装, src-tauri/src/kernel/query.rs:175)
pub trait QuerySource {
    fn describe(&self) -> Describe;          // 自报: source_kind + fields + operators
    fn rows(&self) -> &[Row];
    fn query(&self, req: &QueryRequest, now: NaiveDate)
        -> Result<QueryResult, QueryError>;  // 默认实现 = run_query(共享引擎)
}

// 写半边 = produce, 物理分开 (过 review gate, 串行)
// smart-table 的 produce: upsert / update_cell / add_view / run_ai_column
```

**关键校准 (2026-06-22 对真实代码核对后修正)**: 早期 draft 把三动词画成「一个 trait」是错的。现实是 `describe`+`query` 在 `QuerySource` (读),`produce` 单独走 gate (写) —— 这**恰恰强化** CQRS 论点: 读可并行不过门,写串行过 review gate。两者**不该塌进一个 trait**。describe 横跨两者 (读前自报 schema,也约束写)。

- `SourceKind { Record, Text, Blob }` (query.rs:26) 已存在 —— 不同源不同能力 profile 的现成落点。RecordSource (filter/sort/group) / TextSource (match/semantic) / BlobSource (get/extract);算子由 `describe` 自报,**统一在接口、分化在 describe**,不是啥都 query。
- `Operator` 是编译期 enum (12 变体),`field` 是唯一被校验的字符串 —— 防幻觉 (未知字段拒绝 + 返回 valid 集让 caller 自纠)。

---

## 3. 维度 How: subscribe 收编为 `query{watch}` + 单源→多传输派生

### 3.1 subscribe 不是第四动词 (已写入 ADR-002 §14.7 v32)

流式读 = `query` 加 `watch:true` 修饰: 源解析快照 → gate 推增量 (ST-SS Cell/Op)。动词集冻结在三个。无流语义的源 (registry/providers) `describe` 报 `watchable:false`,天然不实现 (ISP) —— 不会被迫写空实现/panic。

### 3.2 单源→多传输派生层 (消双表面的根)

双表面 (134 Tauri + 58 MCP) 的根不是「收编没做完」,是**缺一个 single-source→多传输的派生机制**。手工逐个改照样漂移。

**决策 (已锁)**: 手写 Rust 宏,从一个源定义生成 Tauri command / MCP tool / stream 三表面。先立一个最小可用宏当范式 (不一次性全派生),配**棘轮 lint** 禁止新增裸 `#[tauri::command]` —— 根治再生。守「自包含、无 runtime 依赖」(不引 tauri-specta 的构建期依赖,除非范式证明宏维护成本失控才回退)。

---

## 4. 维度 Who: 两个信任域、一条 gate

```
外部世界 (untrusted)
  外部agent  Irisy  BYO-CLI  PWA写操作  connector→第三方
     └────────┴────────┴────────┴──────────┘
                       │
             ┌─────────▼──────────┐
             │  :17873  THE GATE   │  唯一窄腰
             │ 鉴权(cap-token)·审计·可见性裁剪 │
             │  describe / query / produce │
             │ (流: 授权+审计经此, 字节走:17872) │
             └─────────▲──────────┘
                       │  传输派生层 (宏生成 Tauri/MCP/stream)
             ┌─────────▼──────────┐
             │  Source registry    │  describe + query(读) / produce(写)
             │ vault terminal smart-table KB connector registry provider … │
             └─────────▲──────────┘
                       │
内核域 (trusted): actor + channel + event  ← 内部通讯, 不经 gate
```

- **gate 只守跨域**: 内核 actor↔actor 走 channel/event 零治理 (Erlang/OTP);只有跨信任边界 (外部 agent / Irisy→工具 / connector→第三方 / PWA→写) 必经 :17873。**内核自调经 gate = 反模式,砍。**
- **ST-SS 字节旁路、授权回笼**: 流数据走 :17872 不阻塞,但 session 授权 + 审计元数据登记回 gate → 补掉「流不被治理」的审计盲区。gate 看得见、可撤销/脱敏每个 live 订阅,即便不在热字节路径上。
- **迁移防误判**: 用类型系统编码信任域 (内核域调用走 channel 类型,跨域走 gate 类型),让编译器挡「内核自调误经 gate」。

---

## 5. 维度 When-broken: 降级是契约一等公民

plain-text 哲学 (本地 truth / 云 mirror / 拔网可用 / 本地赢冲突) 要求降级不是异常分支:

- 每个源在 `describe` **声明**降级行为 (offline→返回什么、冲突→本地赢)。connector 是最易离线的源,必须自报。
- `QueryResult` / `produce` 的 `Outcome` 含一等变体: `Full | Partial | Degraded` (读) / `Done | Conflict(local-wins) | Rejected` (写)。
- watch 丢源 (connector 掉线) → 降级到最后快照 + `degraded` 标记,不 hard-fail。

> 现状缺口 (待实装): `QueryResult` 现在只有 `{rows, match_count}`,`QueryError` 只有 `UnknownField`。降级变体是**新增**,不破坏现有 —— 收敛式加。

---

## 6. 六个已拍板的工程决策 (全部守 CLAUDE.md 保命线)

1. **三动词冻结**,`subscribe` 收编为 `query{watch}` (ADR-002 §14.7 v32 已写入)。
2. **读写物理分离不塌缩**: `QuerySource` (读) + `produce` (写过 gate) —— 现状已如此,设计确认而非更改。
3. **gate 只守跨域**,内核自调零治理 (Erlang/OTP)。
4. **ST-SS 字节旁路、授权回笼**,补审计盲区。
5. **单源→多传输派生**: 手写 Rust 宏 + 棘轮 lint,根治双表面。
6. **降级是一等公民**,`describe` 自报 + 结果含降级变体。
7. **外部标准参考借词、不绑版本**: AG-UI/ACP 同 VMark 待遇 (兼容承诺不是依赖)。

---

## 7. 与现有代码的关系: 纯收紧,不推倒 (复用 ≥90%)

| 类别 | 项 |
|---|---|
| **不动** (锁定) | 5 primitives (actor/channel/event/capability/effect)、mcp_server gate 主体、stss_bridge 传输、`QuerySource` 读契约 |
| **收紧** | 内核自调移出 gate;ST-SS 授权回 gate |
| **新增** | `query{watch}` 投影;单源→多传输派生宏 + 棘轮 lint;`describe` 降级声明字段 + 结果降级变体;vault ~52 命令逐步收成 vault Source (旧命令保留随退) |

守「不推倒 / 不做 cleanup PR」: 旧 Tauri 命令保留可用、随用随退,新代码一律走派生宏。

---

## 8. 落地路线: 收敛式四步,每步独立可验证 (守 dev-loop)

1. **冻结契约** ✅ 部分done — ADR-002 §14.7 (subscribe→watch) 已 amend (v32);待补: 降级变体 + 两信任域写进 ADR-010 amendment。
2. **立范式** — `describe` 加 `watchable` + 降级字段;最小派生宏 + 棘轮 lint;拿 smart-table 当首个三表面派生样板。验证: kernel smoke 绿。
3. **收编** — vault → 单个 vault Source (旧命令保留);terminal / connector 跟进。
4. **闭环验证** — kernel smoke + :17873 真机回流 + PWA 视觉三层 (守 dev-loop 三层验证 + 独立 checker)。

---

## 9. 风险与权衡 (诚实标注)

- **派生宏维护成本**: 自研宏要自己维护;换零外部依赖 + 完全自控。失控退路 = 回手工收编 (过渡态),不影响契约层。
- **收敛期双表面共存**: 旧 Tauri 命令与新派生并存一段;棘轮 lint 保证只减不增,有限期债务。
- **gate 信任域切分**: 把内核自调移出 gate 需逐个确认「内核内部 vs 跨域」,用类型编码信任域让编译器挡误用。

---

## Changelog

- v1 (ACCEPTED, 2026-06-22): 对真实代码逐行校准后定稿。修正早期 draft 的「一个 trait 三动词」→ 尊重现状的读写物理分离 (`QuerySource` 读 + `produce` 写),这强化 CQRS 论点。subscribe→query{watch} 已同步进 ADR-002 §14.7 v32。四维正交框架 + 窄腰沙漏 + 六决策 + 四步路线。
- v0 (PROPOSAL, 2026-06-22): 初稿 (工具受限期写于对话,未持久化;v1 重建并校准)。
