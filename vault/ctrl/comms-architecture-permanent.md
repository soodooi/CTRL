# CTRL 通讯架构 — 永久内核设计

> Status: ACCEPTED v2 (2026-06-22, bao 钦定「永久使用的那种」; v2 加 §10 深化)
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

## 10. 深化设计 (v2): 三个结构性修正 + 五个待细化点

> v1 骨架 (窄腰 + 三动词 + 两信任域 + 降级一等公民) **不推翻**。但批判性自审 (对照代码现状) 发现 v1 有两处「讲得太干净、其实糊弄过去」的坍缩 + 一个「永久性」漏洞 —— 必须补进契约才算谋定。代码证据: 勘查确认 4 个 Source **全是 Record,`SourceKind` 有 Blob/Text 却无实现,`QueryResult` 是 record-shaped `{rows}`** —— 印证了 §10.A。

### §10.A 结构性修正: `query` 结果类型随 `source_kind` **多态** (修「返回类型坍缩」)

**病灶**: `QueryResult { rows: Vec<Row> }`,`Row = BTreeMap<String,String>` 是纯 record 形状。但 CTRL 要支持 pdf / 图片 / 视频 / 长文 —— blob 的「读」= 取字节 + 抽取片段,text 的「读」= 语义匹配 + 返回段落,**结果根本不是 row**。把三种 SourceKind 的读塞进一个 `query→rows` = 「维度坍缩」借尸还魂在**返回类型**上 (Plan9「一切皆文件」被诟病的同病: 统一了操作名却丢了类型)。

**修正**: 动词仍是三个 (不破坏窄腰),但**结果类型随 `describe().source_kind` 多态**:

```rust
pub enum QueryResult {
    Records { rows: Vec<Row>, match_count: usize },        // RecordSource: filter/sort/group
    Text    { spans: Vec<TextSpan>, match_count: usize },  // TextSource: match/semantic → 段落
    Blob    { handle: BlobHandle, chunks: Vec<ChunkRef> }, // BlobSource: 字节句柄 + 抽取片段
}
```

算子也随 source_kind 分化 (Record: filter/sort/group · Text: match/semantic · Blob: get/extract/page),由 `describe` 自报。**统一在三动词、分化在结果类型 + 算子**。对标: GraphQL union/interface 返回类型。落 CTRL: pdf = BlobSource (query 返回页/抽取),笔记全文 = TextSource。

### §10.B 结构性修正: `produce` 分「写」vs「effectful 动作」,坐到 **Effect primitive** 上

**病灶**: `produce` = 写,但 CTRL 能力市场里**大量能力是动作不是 CRUD** (发飞书消息 / 部署 CF Worker / 跑 AI 列)。这些是长耗时、有进度、可取消、需幂等的副作用。证据: `run_ai_column` 被迫自造 job 三件套 (start/status/cancel) —— 说明 produce 契约**漏了长耗时动作子模型**,各能力只能各自重造轮子。更刺眼: ADR-001 第五 primitive 就是 **`Effect`**,而 v1 几乎只用了 Channel/Event/Actor,Effect 被晾着。

**修正**: `produce` 两态,effectful 动作坐到 Effect primitive:

```rust
pub enum Produce {
    Write(WriteOp),       // 同步写 (update_cell/append_row/upsert): 立即返回 Outcome
    Effect(EffectSpec),   // 长耗时动作: 返回 OperationHandle
}
pub struct OperationHandle {
    pub operation_id: String,
    pub idempotency_key: Option<String>,  // 网络重试安全, 防重复执行
    // 进度/状态 → 复用 query{watch} 订阅 operation_id (不新增机制!)
    // 取消     → produce 一个 cancel action
}
```

漂亮处: **进度复用 §14.7 `query{watch}`,取消复用 produce** —— 不新增任何传输/机制,纯契约收编。对标: Google AIP-151 long-running operations / Temporal durable execution / gRPC operation 模型。落 CTRL: `run_ai_column` 从手搓 job 收编成标准 Effect;发消息 / 部署都走同一套。

### §10.C 结构性修正: 契约**版本演进**纪律 (「永久」的真正考验)

**病灶**: v1 把「永久」理解成「动词冻结为三」。但永久的真正考验是 **能力市场上第三方插件按某契约版本写好,CTRL 升级契约后怎么不弄坏它们?** `describe` 不报协议版本,gate 不协商 —— 这正是 CORBA/SOAP 真正死因之一 (版本脆性),而 MCP/gRPC 都有协议版本协商。

**修正** (写进 ADR-002 §14):
- `describe` 自报 `protocol_version: SemVer`。
- gate 做**能力协商**: 插件声明实现的契约版本,gate 按版本路由 / 降级。
- 演进纪律 = **protobuf 式只增不改**: 新字段 `#[serde(default)]` 可选,废弃字段标记不删,破坏性变更 = 新 major + gate 同时支持 N 与 N-1 (迁移窗口)。

对标: protobuf 向后兼容规则 / MCP protocol version / semver。**这条不写进 ADR,「永久」就是空话。**

### §10.D 待细化: 跨源组合 (关联/Lookup/Rollup) **归属上层**,不进 Source 契约

智能表格对标飞书多维表格需要关联/Lookup/Rollup (跨表),但 (1) CLAUDE.md 禁跨 D1 JOIN (2) Source 契约是单源 (自报字段、查自己)。**决策: 组合在上层** (Irisy / feature pack) 用 **DataLoader 模式** (先 query 源 A 拿外键 → batch query 源 B → 内存 join),Source 保持单一职责。Lookup/Rollup = feature-pack 层 derived field,不是 Source 原生字段。对标: GraphQL federation / DataLoader (N+1 batch) / CQRS read model。与 ADR-002 v30「关系型字段落地待后续切片」对齐 —— 此处明确归属,不留洞。

### §10.E 待细化: gate 自身的**降级 + 背压** (本地优先要求 gate 也能挂)

跨域调用全压一道 gate = 单点;但「本地是 truth」要求 gate 挂了仍可读。**设计**: (1) **gate 降级** —— gate 故障时,只读本地 `query` 临时降到内核域待遇 (直通,因为读本就不改状态、本地是 truth);**write/effect 必须等 gate** (治理不可旁路)。(2) **背压** —— gate 对并发调用 bounded queue + **circuit breaker**: 某源持续失败则熔断,快速返回 `degraded` 而非堆积。与「两信任域」一致: gate 降级 = 跨域读在 gate 故障时临时获内核域待遇。对标: API gateway rate-limit / circuit breaker / bulkhead。落 CTRL: 拔网 / gate 重启时用户仍能读本地 vault,写操作排队等恢复。

### §10.F 待细化: **AI-facing 错误契约** (agentic 平台的自纠回路)

v1 只有 `describe` 字段级防幻觉;produce 被拒/降级/失败没有结构化自纠反馈。**设计**: 统一 `Feedback` (不只 human string):

```rust
pub struct Feedback {
    pub kind: FeedbackKind,            // UnknownField | ReviewRejected | Degraded | RateLimited | Conflict
    pub retriable: bool,               // AI 该不该重试
    pub correction: Option<Correction>,// 结构化纠正: valid 字段集 / 修正参数 / 等待时长
    pub human: String,                 // 给人看的
}
```

现有 `QueryError::UnknownField{valid}` 是其特例,统一收编。对标: HTTP problem+json (RFC 7807) / gRPC rich error (google.rpc.Status details) / agentic self-correction loop。落 CTRL: Irisy 拿到 `retriable + correction` 自动重试/自纠,而非把 raw error 丢给普通用户。

### §10.G 待细化: 可见性裁剪 × **intent-scoped projection**

勘查发现 gate 可见性是 TODO (全工具对所有 caller 可见) = 治理半成品。**设计**: 可见性绑 **intent-scoped projection** (ADR-002 § projection): 不是「所有 source 对所有 caller 可见」,而是 gate 按 `(caller, intent)` 投影可见子集。这正是「按 Ctrl → 意图 → 1-3 能力模块」的实现 —— 既是 UX (不灌爆 context) 又是安全 (最小暴露面 / capability-based)。对标: capability-based security (最小权限) / RBAC scoping。

### §10.H 待细化: mesh 跨设备的三动词成立性

跨设备 query/produce 涉及 CRDT 合并 / E2EE / 最终一致,与本地语义不同。**判断: mesh 是「传输 + 一致性层」,不是腰外的另一个世界,三动词仍成立、语义投影到 CRDT**: (1) 跨设备 `query` = query 远程 Source (经 mesh 传输,结果是最终一致快照)。(2) 跨设备 `produce` = 投影成 **CRDT op** (Automerge change): 本地立即生效 + 异步合并到 peer (= 「本地是 truth,异步推云/peer」)。(3) `describe.degradation` 在 mesh 语境 = `LocalWins` (CRDT 自动合并,本地优先)。(4) **Beelay/Keyhive = capability sync,正好对接 gate 的 capability-token 授权**。对标: Automerge / local-first (Ink&Switch)。落 CTRL: 跨设备就是「本地 truth、云/peer mirror」在通讯层的体现,三动词不变。

### §10 小结: 哪些动骨架、哪些不动

| 点 | 性质 | 动骨架? | 落点 |
|---|---|---|---|
| A query 多态 | 结构性修正 | 改 `QueryResult` 类型 (动词不变) | ADR-002 §14 |
| B produce/Effect | 结构性修正 | `produce` 两态 + 用 Effect primitive | ADR-002 §14 + ADR-001 §Effect |
| C 版本演进 | 结构性修正 | describe 加 version + gate 协商 | ADR-002 §14 |
| D 跨源组合 | 待细化 | 否 (归上层) | ADR-010 + ADR-002 §14 |
| E gate 降级/背压 | 待细化 | 否 (gate 增强) | ADR-010 § governance/trust-domains |
| F AI 错误契约 | 待细化 | 否 (统一 Feedback) | ADR-002 §14 |
| G 可见性 × intent | 待细化 | 否 (gate 增强) | ADR-010 + ADR-002 § projection |
| H mesh 三动词 | 待细化 | 否 (语义投影) | ADR-010 § transports + ADR-002 § crypto |

## Changelog

- v2 (2026-06-22): NEW §10 深化设计 —— 批判性自审后补三结构性修正 (A query 结果随 source_kind 多态 / B produce 分写-effect 坐 Effect primitive / C 契约版本演进纪律) + 五待细化 (D 跨源组合归上层 / E gate 降级背压 / F AI-facing 错误契约 / G 可见性×intent projection / H mesh 三动词投影 CRDT)。骨架不变,补 v1 糊弄过去的坍缩 + 永久性漏洞。同步进 ADR-002 §14 (A/B/C/F) + ADR-010 (D/E/G/H)。
- v1 (ACCEPTED, 2026-06-22): 对真实代码逐行校准后定稿。修正早期 draft 的「一个 trait 三动词」→ 尊重现状的读写物理分离 (`QuerySource` 读 + `produce` 写),这强化 CQRS 论点。subscribe→query{watch} 已同步进 ADR-002 §14.7 v32。四维正交框架 + 窄腰沙漏 + 六决策 + 四步路线。
- v0 (PROPOSAL, 2026-06-22): 初稿 (工具受限期写于对话,未持久化;v1 重建并校准)。
