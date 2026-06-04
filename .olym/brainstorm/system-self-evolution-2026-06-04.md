# System Self-Evolution — 6 Loops × 6 Stages (2026-06-04)

**Date**: 2026-06-04
**Trigger**: bao "不仅仅 Irisy LLM, 整个系统都要自我升级成长 ... 沉, 唯一真相, 要经常整理 ADR"
**Status**: brainstorm 设计稿, ADR amend pending bao 锁
**Anchors**: ADR-001 spine / 002-substrate / 005-irisy / 006-cross-cutting / 007-workbench
**Predecessors**:
- [[cap-design-v2-2026-06-04]] (cap = Pi 戴的帽子, 7 cap source, autonomy L3-L5, smart-table)
- [[irisy-self-reflection-loop-2026-06-04]] (Irisy chat 三步闭环 — 这份扩展为全系统 6 闭环)
- [[irisy-capabilities-2026-06-04]] (现 80+ capability, 这份补 self-evolution 闭环)
- memory `decision_ctrl_lean_substrate_scheduler_executor_tools` (底座 = 调度器 + 执行器 + 工具堆)
- memory `feedback_pi_is_core_use_upstream_surfaces` (用 Pi 自己 export 的 surface)
- memory `feedback_build_system_not_business` (我建系统不建业务)
- memory `feedback_adr_code_comments_are_truth` (ADR + 代码 + 注释 = 唯一真相)

---

## TL;DR

bao 2026-06-04 校准: **不仅仅 Irisy LLM, 整个 CTRL 系统都要自我升级成长**.

CTRL 自我升级 = **6 个并行闭环, 每个 6 阶段统一架构**:

```
Detect → Diagnose → Plan (typed ISA) → Execute (microkernel + policy) → Verify → Learn
```

**6 闭环跨 CTRL 全栈**:

1. **Irisy chat reflection** — LLM behavior 调整 (Letta-code sleep-time subagent 模式)
2. **Provider routing self-tuning** — per-provider trust score + telemetry (Nova AI Ops)
3. **Cap curation** — 用户行为 telemetry → cap rating + 推荐 + 弃用建议
4. **Vault index optimization** — 搜索 hit-rate 反馈 → embedding re-rank (Mem0)
5. **System self-healing** — kernel/Pi error → Pi diagnose + 自动 recover + rollback (ReCiSt)
6. **SKILL/MCP cross-user recommendation** — 聚合行为 → 推荐 (Voyager, opt-in)

**5 设计原则** (从 2026 8+ finding 提炼):
- Typed ISA (-95% agent-caused harm, arxiv 2604.09963)
- Microkernel validation (CTRL kernel 本身就是)
- Audit ledger (immutable, replay-able, 复用 persistence.rs)
- Policy envelope + blast-radius limit (autonomy L3-L5 跨闭环统一)
- vim test 守住 (markdown + YAML, 用户可看可改)

**落地按 crawl-walk-run** (Nova AI Ops, ReCiSt §C 一致), 不分 v1/v1.x, 按风险层叠.

---

## 1 范畴 — 不只是 Irisy chat

之前 brainstorm `irisy-self-reflection-loop-2026-06-04.md` 聚焦 Irisy chat reflection. bao 校准: 系统级自我升级是全栈, 不只是 LLM agent.

| # | 闭环 | 现状 | self-evolution 形态 (2026 finding) |
|---|---|---|---|
| 1 | Irisy chat reflection | brainstorm doc §4 已设计未实施 | Detect failure signal → Reflect (sleep-time subagent, Letta-code) → Improve playbook |
| 2 | Provider routing | memory `decision_provider_v3_byok_first` v3 cooldown only | per-provider trust score (Nova AI Ops) + per-action telemetry feed |
| 3 | Cap curation | cap-design-v2 §6 有 usage_count / last_used / rating fields 全 dormant | usage telemetry → cap rating / 推荐 / 弃用建议 (Voyager skill library) |
| 4 | Vault index | kernel/vault_index.rs FTS5 静态 | 搜索 query 落 log, 命中率反馈 → re-rank embeddings (Mem0 consolidate) |
| 5 | System self-healing | kernel/Pi error 现 manual restart | Pi diagnose subagent + 自动 restart + verify + rollback (ReCiSt 4 层) |
| 6 | SKILL/MCP recommendation | 用户手动 install | 跨用户聚合 install/usage → ranking 推荐 (opt-in telemetry, privacy-preserving) |

---

## 2 6 阶段统一架构 (跨 6 闭环复用)

来源综合: Nova AI Ops 6-stage loop / ReCiSt 4-layer / arxiv 2604.09963 typed ISA / OpsAgent dual self-evolution.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  1. Detect       0-cost rule-based signal recognition                        │
│                  (failure / drift / pattern / threshold cross / latency)     │
│                  Non-LLM, client-side / kernel-side, instant                 │
│                                                                              │
│  2. Diagnose     LLM-driven causal hypothesis (on-demand, NOT per-turn)      │
│                  Parallel reasoning sub-trees (ReCiSt §C)                    │
│                  Output: ranked causal hypothesis WITH provenance            │
│                                                                              │
│  3. Plan         Typed ISA action (NOT raw commands)                         │
│                  arxiv 2604.09963: typed actuation = -95% agent-caused harm  │
│                  CTRL: existing 5 primitives naturally typed                 │
│                                                                              │
│  4. Execute      Microkernel validate + policy envelope                      │
│                  + blast-radius limit + scope check + transactional          │
│                  (per-action rollback or compensation if possible)           │
│                                                                              │
│  5. Verify       Did the signal actually recover?                            │
│                  Nova AI Ops: skip verify = "auto-fix" loops forever         │
│                  or declares victory on still-broken service                 │
│                                                                              │
│  6. Learn        Consolidate into:                                           │
│                  - markdown playbook (user-visible, vim test守住)            │
│                  - SQLite audit ledger (immutable, replay-able)              │
│                  - Pi system prompt next-turn injection (Improve layer)      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**关键 invariants** (跨 6 闭环):
- Detect 永远 cheap (0 LLM, 0 latency)
- Diagnose 永远 on-demand (累积 N signal 后, 不每 event)
- Plan 永远 typed (agent 不能发原始命令)
- Execute 永远 microkernel-validated (policy envelope 守口)
- Verify 永远跑 (不允许 silent claim success)
- Learn 永远物化 (markdown + audit ledger 双轨)

---

## 3 6 闭环 × 6 阶段 详表

### 3.1 Loop 1 — Irisy chat reflection (LLM behavior)

| 阶段 | 实施 | 工程量 |
|---|---|---|
| Detect | `packages/ctrl-web/src/lib/irisy-reflection.ts` (新): user_rephrase / negative_feedback / banned_preamble / tool_call_fail 规则 | small |
| Diagnose | Sleep-time background subagent (Letta-code 模式), idle 30min / 累积 5 episode / 用户主动 trigger | medium |
| Plan | Pi 输出 "do-list" + "don't-list" + SOUL.md `x-ctrl:lessons` markdown | small |
| Execute | append `.irisy-memory/playbook.md` + SOUL.md `x-ctrl:lessons` (Pi 自动写, 不打断用户) | small |
| Verify | `negative episode rate / 100 turn` 下降 / 同一 rule 复发率 → 0 | small (metric only) |
| Learn | playbook 注入 IrisyChat system prompt (Improve 层, brainstorm doc §4.4) | small |

### 3.2 Loop 2 — Provider routing self-tuning

| 阶段 | 实施 | 工程量 |
|---|---|---|
| Detect | provider failure / cooldown trigger / latency spike / token cost spike | small (复用 `provider_failover_record`) |
| Diagnose | 规则即可 (no LLM): N 连续 fail / cooldown 频率 / cost outlier | small |
| Plan | typed action: `trust_score -= 0.1` / `add_to_fallback_chain` / `auto_route_alt` | small |
| Execute | 改 `~/.ctrl/state/active-providers.json` + microkernel validate | small |
| Verify | next 5 turn 走新 provider 成功率 | small |
| Learn | `vault/.ctrl/provider-trust.yaml` 持久化, 跨 boot 保留 | small |

### 3.3 Loop 3 — Cap curation

| 阶段 | 实施 | 工程量 |
|---|---|---|
| Detect | 用户 wear / dismiss / re-wear cap 行为, cap output 满意度 (隐式: 是否落 vault, 是否被用户改) | medium (new telemetry) |
| Diagnose | rule: 装但 N 天 0 wear = cold cap; wear 后立即 remove = bad cap; wear 后 vault.write = good cap | small |
| Plan | typed action: `lower_rating` / `propose_uninstall` / `boost_recommend` | small |
| Execute | 改 cap-design-v2 §6 已设计的 `rating` / `usage_count` 字段 (现 dormant) | small |
| Verify | cap-rating 跟 user-rating (my_rating 字段) 是否一致? drift > 1.0 = signal wrong | small |
| Learn | cross-cap ranking 调整, cap-table 排序自动反映 | small |

### 3.4 Loop 4 — Vault index optimization

| 阶段 | 实施 | 工程量 |
|---|---|---|
| Detect | 用户 `vault.search` 后 click-through 行为, query 无结果率 | medium (new query log) |
| Diagnose | 0-result query / click-rate < 0.2 query / 反复 search 同关键词 | small |
| Plan | typed action: `re-embed_note` / `add_alias` / `boost_term_weight` | small |
| Execute | 复用 `vault_aliases` + `vault_embeddings` 现有 API | small |
| Verify | 同一 query 下次 click-rate 提升? | small |
| Learn | `vault/.ctrl/search-tuning.yaml` 持久化 | small |

### 3.5 Loop 5 — System self-healing (kernel + Pi)

| 阶段 | 实施 | 工程量 |
|---|---|---|
| Detect | kernel `tracing::error!()` / Pi crash / port bind fail / disk full / vault corrupt | medium (聚合现有 tracing log) |
| Diagnose | Pi 跑 ReCiSt 风 diagnostic agent, 读 tracing log + 系统状态 | large (new Pi subagent) |
| Plan | typed ISA: `restart_pi` / `clear_cooldown` / `rebuild_vault_index` / `rotate_keychain_token` | medium |
| Execute | microkernel validate (capability check) + blast-radius limit (e.g. Pi restart 不影响 vault) | medium |
| Verify | error 是否再次触发? Pi `/healthz` reachable? | small |
| Learn | `vault/.ctrl/incidents/<date>.md` immutable record + audit ledger | small |

### 3.6 Loop 6 — Cross-user SKILL/MCP recommendation (远期, opt-in)

| 阶段 | 实施 | 工程量 |
|---|---|---|
| Detect | 用户 install / dismiss cap 行为 (opt-in telemetry → ctrl-cloud aggregator) | large (privacy + aggregator) |
| Diagnose | aggregator side: 跨用户 cap usage cluster → "用户 A 装了 X, 类似用户 B 也常装 X" | large (cross-user analytics) |
| Plan | typed action: `surface_recommendation` (不自动 install, 只推送 banner) | small |
| Execute | ctrl-cloud → CTRL native client → Discover 推荐 panel | medium |
| Verify | 推荐 cap 装机率 / dismiss 率 | small |
| Learn | aggregator-side ranking model update | large |

→ Loop 6 最远期, 需要 privacy / telemetry opt-in + ctrl-cloud aggregator infra. Phase Run 才碰.

---

## 4 CTRL 已有基础 — 不全是新建

| 自我升级所需 | CTRL 现有 primitive | gap |
|---|---|---|
| **Typed ISA** | ADR-001 spine § primitives v1 (5: Actor/Capability/Event/Channel/Effect) | 跨闭环 ISA 词表统一; 当前 Effect 偏 kernel 内部, 需扩展给 self-evolution actions |
| **Microkernel validator** | CTRL kernel 本身 (capability_resolver.rs cap token 校验) | 当前 cap-scope, 需扩展 cross-loop policy validation |
| **Audit ledger** | persistence.rs SQLite event store | 现写 user-event, 需加 self-evolution-event kind |
| **Policy envelope** | capability tokens + cap manifest permissions | 加 autonomy L3-L5 (cap-design-v2 §14 #8) cross-loop 复用 |
| **vim test 守住** | SOUL.md / .irisy-memory/ / vault/.ctrl/ markdown + YAML | 一致 |
| **Pi subagent** | Pi (`@mariozechner/pi-coding-agent`) 已就位, ctrl-pi-bridge 已 wire provider | 缺: Pi background subagent invocation (Letta-code stateless mode) |
| **Brain state introspection** | `provider_brain_status()` 已 return primary + fallback | self-aware 基础已有, 缺其他子系统 introspection |
| **Telemetry pipeline** | kernel `tracing::info/warn/error!()` 现写 stdout 不聚合 | 需新 collector 落 SQLite/markdown |

---

## 5 落地路径 — Crawl-Walk-Run

按 Nova AI Ops 推荐 + bao `feedback_no_planning_no_phasing` (不分 v1/v1.x, 按风险层叠).

### 5.1 Phase Crawl (suggest-only, 不写 production)

工程量低, 可立即 ship. 给所有闭环加 **observability + suggest-only**, 不自动改任何状态.

- **Loop 1 detect**: `irisy-reflection.ts` 写 episode markdown (`vault/.irisy-memory/episodes/`), 不 reflect 不 inject
- **Loop 2 detect**: provider failover / cooldown 全部进 `vault/.ctrl/provider-events.log`
- **Loop 5 detect** + audit: kernel `tracing::error!()` 全部进 SQLite audit ledger (persistence.rs 新 event kind `system.error`)
- **All loops**: audit ledger UI panel (Settings → 自我升级 → "最近事件" tab), 用户能看见信号被记录但**不允许自动 act**

完成 Phase Crawl = CTRL 知道自己哪里出事 + 用户能看, 但不动手.

### 5.2 Phase Walk (低风险自动)

挑选**完全可 rollback + blast-radius 小**的 typed actions 进入自动:

- **Loop 1 reflect + improve**: Pi sleep-time subagent (idle 30min trigger) 写 playbook → 注入 next Irisy turn
- **Loop 2 plan + execute**: provider trust_score 自动调 (`-0.1` per consecutive fail), 不切 provider 只调 fallback chain 顺序
- **Loop 3 plan + execute**: cap rating 自动调 (cap-design-v2 §6 rating 字段), 不自动 uninstall
- **Loop 4 plan + execute**: vault.search alias 自动添加 (0-result query 触发 Irisy 提议 alias), 不删 alias
- **All loops verify**: 强制跑, signal 没恢复就 auto-rollback

完成 Phase Walk = CTRL 自动调整低风险参数, 高风险仍 manual.

### 5.3 Phase Run (完整自动, 远期)

- **Loop 5 execute**: Pi 自动 restart / kernel 自动 recover / vault index 自动 rebuild
- **Loop 6 全部**: cross-user telemetry + recommendation (需 opt-in)
- **Memory-R1 风格 RL fine-tune** (用 cross-user data 训 specialized sub-agent decide memory ops)
- **Cross-loop coordination**: Loop 1 reflection 触发 Loop 3 cap re-rating

完成 Phase Run = CTRL 全栈自治 (within policy envelope), 用户只在 break-glass 时干预.

---

## 6 5 设计原则 (扩展)

### 6.1 Typed ISA

每个闭环的 Plan 阶段产出 **typed action**, 不是自由文本 / 原始命令.

```rust
// kernel/self_evolution/isa.rs (proposed)
pub enum SelfEvolutionAction {
    // Loop 1
    AppendPlaybook { rule: String, kind: DoNotKind },
    UpdateSoulLessons { lesson: String },

    // Loop 2
    AdjustProviderTrust { provider_id: String, delta: f32 },
    ReorderFallbackChain { new_chain: Vec<String> },

    // Loop 3
    AdjustCapRating { cap_id: String, delta: f32 },
    ProposeUninstall { cap_id: String, reason: String },

    // Loop 4
    AddVaultAlias { path: String, alias: String },
    ReembedNote { path: String },

    // Loop 5
    RestartPi,
    ClearProviderCooldown { provider_id: String },
    RebuildVaultIndex,

    // Loop 6 (远期)
    SurfaceRecommendation { cap_id: String, reason: String },
}
```

arxiv 2604.09963 evidence: typed ISA + microkernel validator 减 95% agent-caused harm (77% → 4%).

### 6.2 Microkernel validation

每个 typed action 必须经 microkernel validator 校验:
- Capability scope check (action 是否允许?)
- Blast-radius limit (e.g. "RestartPi" 不允许影响 vault read)
- Policy envelope (autonomy L3-L5 限制, e.g. L3 不允许 RebuildVaultIndex)
- Transactional (rollback path 必须存在)

实施: kernel/self_evolution/validator.rs + 复用 capability_resolver.rs.

### 6.3 Audit ledger

每个 self-evolution event 写 SQLite immutable record, schema:

```sql
CREATE TABLE self_evolution_events (
    id INTEGER PRIMARY KEY,
    ts_ms INTEGER NOT NULL,
    loop_id TEXT NOT NULL,           -- 'irisy_reflection' / 'provider_routing' / ...
    stage TEXT NOT NULL,             -- 'detect' / 'diagnose' / 'plan' / 'execute' / 'verify' / 'learn'
    typed_action_json TEXT,          -- serialized SelfEvolutionAction
    evidence TEXT,                   -- raw signal / log excerpt
    diagnosis_json TEXT,             -- LLM causal hypothesis
    verify_result TEXT,              -- 'recovered' / 'unchanged' / 'rolled_back'
    autonomy_level TEXT              -- 'L3' / 'L4' / 'L5'
);
```

用户可 query: "上周 Irisy 改了我什么"? "Provider X 为什么被降级"?

### 6.4 Policy envelope + autonomy L3-L5

cap-design-v2 §14 #8 已设计 cap autonomy. 扩展到全闭环:

- **L3 半自主**: typed action 提议, 用户确认才执行 (Phase Crawl)
- **L4 默认**: 低风险 action 自动执行, 高风险 (blast-radius > N) 提议 (Phase Walk)
- **L5 完全自主**: 所有 action 自动 (Phase Run)

UI: Settings → 自我升级 → autonomy level slider.

### 6.5 vim test 守住

所有 self-evolution 数据落用户可见 markdown / YAML, 不进黑盒 vector store:
- `vault/.irisy-memory/episodes/<date>.md`
- `vault/.irisy-memory/reflections/<date>.md`
- `vault/.irisy-memory/playbook.md`
- `vault/.ctrl/provider-trust.yaml`
- `vault/.ctrl/cap-ratings.yaml`
- `vault/.ctrl/search-tuning.yaml`
- `vault/.ctrl/incidents/<date>.md`

audit ledger 仍 SQLite (高频 event 不适合 markdown), 但 Settings UI 提供 markdown 导出.

---

## 7 ADR amendment 清单 (bao "经常整理 ADR")

需 amend 的 ADR (按 priority):

| ADR | § amend | 内容摘要 | 优先 |
|---|---|---|---|
| **ADR-001 spine** | 加 § self-evolution v1 | 6 闭环顶层架构 + 6 阶段统一 + Typed ISA | **P0** |
| **ADR-002 substrate** | 加 § audit-ledger v1 | 复用 persistence.rs, 新 event kind `system.self_evolution` | **P0** |
| **ADR-002 substrate** | 加 § typed-isa v1 | SelfEvolutionAction enum + microkernel validator 跨闭环原则 | P1 |
| **ADR-005 irisy** | 加 §5 self-reflection-loop v1 | Loop 1 完整 (基于 irisy-self-reflection-loop brainstorm doc) | **P0** |
| **ADR-005 irisy** | 加 §6 sleep-time-subagent v1 | Pi background subagent (Letta-code 模式), idle trigger | P1 |
| **ADR-006 cross-cutting** | 加 § policy-envelope v1 | autonomy L3-L5 统一定义, 跨闭环复用 | **P0** |
| **ADR-006 cross-cutting** | 加 § telemetry v1 | tracing → SQLite audit pipeline, opt-in cross-user | P1 |
| **ADR-007 workbench** | 加 § cap-curation-feedback v1 | Loop 3, 用户行为 telemetry → cap rating | P1 |
| **(待开) ADR-008 self-evolution** | 新建 | 如果 6 闭环 substrate 化, 可独立模块化 | 视情况 |

**bao `feedback_adr_code_comments_are_truth` 锁**: ADR amend 跟代码同步, 不漂. 实施代码时必加注释 `(ADR-XXX § Y vN, 2026-06-04)`.

**bao `feedback_use_adr_acceptance_as_checklist` 锁**: 每个 amend 必带 § acceptance criteria, 实施时按 checklist 对照.

---

## 8 Open questions (bao 决策点)

1. **Crawl phase 先 ship 哪个闭环**?
   - 候选: Loop 1 (Irisy reflection) — 最闭, 用户感知最强
   - 候选: Loop 5 audit ledger — 最低层, 所有闭环受益
   - 候选: Loop 2 (Provider routing) — 现有 cooldown 直接扩展
   - **倾向: Loop 1 + Loop 5 audit ledger 并行**, 因为前者用户能感知, 后者所有闭环基础

2. **Pi sleep-time subagent 跑频率**?
   - idle 30min / session-end / 累积 5 episode 任一 trigger?
   - 还是只 idle 30min (避免打断用户)?
   - **bao 拍**

3. **Trust score granularity**?
   - per-provider (粗)
   - per-action (e.g. translate 信 Claude, code 信 GPT-4)
   - per-cap (e.g. frontend-slides 配 claude-oauth 最准)
   - **倾向: per-provider 起步, per-action v2.x**

4. **Cross-user telemetry (Loop 6) opt-in 还是默认 off**?
   - bao 哲学: 端侧化 + 无账号 → **默认 off, 用户主动 opt-in 才参与跨用户聚合**
   - opt-in 后数据仍**privacy-preserving** (DP / aggregation, 不上传原始)

5. **Audit ledger prune 策略**?
   - 永久保留 (immutable)? 空间增长无界
   - 提议: 7 天高分辨率 + 90 天 日级聚合 + > 90 天 month aggregate
   - **bao 拍**

6. **闭环 sequencing**?
   - Loop 5 (audit ledger) 是其他闭环 Learn 阶段的物化基础, 应先 ship
   - Loop 1 + Loop 2 可并行 (相对独立)
   - Loop 3 / Loop 4 依赖 Loop 5 (audit ledger schema)
   - Loop 6 最远期, 依赖 Loop 3 (cross-user 数据基础)
   - **倾向 sequencing**: Loop 5 audit ledger → (Loop 1, Loop 2) → (Loop 3, Loop 4) → Loop 6

7. **typed ISA action 集 v1 范围**?
   - 列了 ~13 actions, 是否够?
   - 是否漏关键 actions (e.g. compaction / re-summarize SOUL.md)?
   - **bao 拍 / 后续 iteration 加**

---

## 9 一致性核对 — 跟现有 memory / ADR

| 现有 memory / ADR | 一致性 | 说明 |
|---|---|---|
| `decision_ctrl_lean_substrate_scheduler_executor_tools` | ✅ | 6 闭环都走 kernel = 调度器 + 执行器, 不胖化 |
| `feedback_pi_is_core_use_upstream_surfaces` | ✅ | Pi sleep-time subagent 走 Pi 本职 (background agent surface), 不手糊 |
| `feedback_build_system_not_business` | ✅ | kernel 提供 primitive (audit ledger / microkernel validator / typed ISA), Pi/Irisy 写业务规则 |
| `feedback_no_planning_no_phasing` | 🟡 | crawl-walk-run 不是 phase delivery, 是 **风险层叠** (suggest → 低风险自动 → 完整自动), 同 branch 累积 ship |
| `feedback_adr_code_comments_are_truth` | ✅ | §7 ADR amend 清单 + 代码注释要求 |
| `feedback_use_adr_acceptance_as_checklist` | ✅ | ADR amend 必带 § acceptance |
| `feedback_no_redundancy_one_ssot` | ✅ | 一个 audit ledger schema 跨 6 闭环 (不每闭环自建) |
| `decision_ctrl_obsidian_philosophy` | ✅ | 所有数据落 markdown / YAML, vim test 守住 |
| `decision_provider_v3_byok_first` | ✅ | Loop 2 扩展现 v3 cooldown, 不替换 |
| `cap-design-v2-2026-06-04` §14 #8 autonomy L3-L5 | ✅ | §6.4 policy envelope 复用同一 L3-L5 定义 |
| `irisy-self-reflection-loop-2026-06-04` | ✅ | 本 doc 把 Detect/Reflect/Improve 三步扩展为 6 闭环 × 6 阶段 |

---

## 10 参考 (2026 finding)

### 10.1 学术 / 2026 papers

- OpsAgent — Self-Evolving Multi-agent System for Incident Management (arxiv 2510.24145v3, Lenovo prod) <https://arxiv.org/html/2510.24145v3>
- ReCiSt — Bio-inspired Agentic Self-Healing (arxiv 2601.00339) <https://arxiv.org/pdf/2601.00339>
- Typed ISA + Microkernel — 95% agent-caused harm reduction (arxiv 2604.09963) <https://www.arxiv.org/pdf/2604.09963>
- Survey of Self-Evolving AI Agents (arxiv 2508.07407) <https://arxiv.org/pdf/2508.07407>
- Memory for Autonomous LLM Agents — mechanisms, evaluation, frontiers (arxiv 2603.07670) <https://arxiv.org/html/2603.07670v1>
- SSGM — Stability and Safety Governed Memory Framework (arxiv 2603.11768) <https://arxiv.org/html/2603.11768v1>

### 10.2 Production

- Nova AI Ops — Self-Healing Infrastructure 2026 <https://novaaiops.com/self-healing-infrastructure>
- Elastic — Autonomous IT Platforms 2026 <https://www.elastic.co/blog/constellation-autonomous-it-platforms>
- Memory-R1 + AtomMem (mem0.ai state-of-2026 report) <https://mem0.ai/blog/state-of-ai-agent-memory-2026>
- Letta-code reflection subagent <https://github.com/letta-ai/letta-code/blob/main/src/agent/subagents/builtin/reflection.md>
- CoWork OS — Evolving Agent Intelligence (most aligned with CTRL native-OS shape) <https://coworkosapp.com/docs/evolving-agent-intelligence/>
- distil-labs self-healing agent (telemetry → SLM diagnosis → Warp Oz remediation) <https://github.com/distil-labs/distil-self-healing-agent>
- Quali — Agentic layers architecture <https://www.quali.com/blog/agentic-layers-the-architecture-behind-autonomous-infrastructure/>

### 10.3 Earlier finding (from irisy-self-reflection-loop-2026-06-04.md)

- Reflexion (NeurIPS 2023) <https://arxiv.org/abs/2303.11366>
- Self-Refine (NeurIPS 2023) <https://arxiv.org/abs/2303.17651>
- Generative Agents (Stanford 2023) <https://arxiv.org/abs/2304.03442>
- Voyager (NeurIPS 2023) <https://arxiv.org/abs/2305.16291>
- Letta (ex-MemGPT) <https://github.com/letta-ai/letta>
- Mem0 <https://github.com/mem0ai/mem0>

---

**下一步**: bao 拍 §8 8 个 open questions → 立即 ADR amend (§7 P0 三项: ADR-001 spine § self-evolution / ADR-002 substrate § audit-ledger / ADR-005 irisy §5 self-reflection-loop / ADR-006 cross-cutting § policy-envelope), 然后实施 Phase Crawl (Loop 1 + Loop 5 audit ledger 并行).
