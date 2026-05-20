# Protocol / Verification Protocol

> 派遣前 review + 功能验收 + 派遣后 review 三段质检.
> Parent: [olympus-protocol.md](../olympus-protocol.md)

**Version**: 1.1 (2026-04-28 e2e-test fix — scaled count + downstream_of trigger + escalation enforcement)
**Effective**: 2026-04-28 (新 dispatch 起). 已 merged H-001~H-004 不追溯, 作为 e2e test reference 数据.

> **Why this exists** (bao 2026-04-28): "质量和生产要分开, 你自己也要派专业的 agent review". zeus self-review = bias. 派遣前必须经独立 specialist 审, 不依赖 zeus 单一视角.

---

## 1. 三段质检

```
zeus 写 handoff
  ↓
[§2 派遣前 review (生产线 QA)]
  zeus 派 specialist 独立审 → 修 critical/high → 才 push handoff → 才 forward
  ↓
worker 实施
  ↓
[§3 功能验收 (端到端 demo-able capability)]
  worker push + 跑 verify 脚本 + 附 demo artifact → status: done
  ↓
[§4 派遣后 review (产品 QA)]
  zeus 派 themis → themis 派 specialist 审 PR → flip verified
```

**派遣前 ≠ 派遣后** (常被混淆):
- 派遣前 = 生产线 QA (zeus 自己产出的 handoff 也是被审对象)
- 派遣后 = 产品 QA (worker 产出的 PR 被审)
- 两段都 mandatory, 都用 specialist agent, 但视角不同

---

## 2. 派遣前 Review (生产线 QA)

**触发**: zeus 写完 handoff body, **不 push 不 forward**, 先派 specialist.

### 2.1 Specialist 矩阵 (zeus inline)

| Specialist agent | 审什么 | 默认触发 |
|---|---|---|
| **architect** | 架构 / lane 边界 / cross-cutting 设计 / spec 自洽 | 新 lane / 新 spec / fleet 结构调整 / cross-cutting unification |
| **general-purpose** | spec gap / 引用错误 (file 存在?) / 自相矛盾 / 排期不现实 / lane-guard 撞 | 任何 multi-handoff dispatch (≥ 2 个 handoff) |
| **silent-failure-hunter** | self-reported 验收 / unverifiable 项 / counter-evidence 缺失 | **任何 handoff** (default mandatory) |
| **typescript-reviewer** | spec 里的 code sample / type 设计 / API surface | spec 含代码样例 |
| **security-reviewer** | denylist / lane-guard / 凭证 / KV / auth / cross-tenant 隔离 | 改 hooks / KV / auth lane / 多商家隔离 |
| **code-reviewer** | handoff body 写法 / verify 脚本质量 | verify 脚本 ≥ 10 行 |
| **database-reviewer** | D1 schema / migration 设计 / multi-db 边界 | 改 database/ 或 multi-db wrapper |

**Trigger** (machine-checkable, 不靠 zeus 判断):

派遣前 review **mandatory** for handoff with ANY of (8 条):
1. touches `.olym/steering/protocol/**` (改协议本身)
2. touches `.olym/steering/lane-ownership.yaml` (改 lane 边界)
3. touches `.olym/steering/olympus-roster.md` (新 lane 加 persona / 退役)
4. 新 spec dir (`.olym/specs/<新>/` 创建, git diff 有新 dir)
5. cross-lane touches (≥ 2 lanes appear in `touches[]` 当映射到 lane-ownership.yaml 时)
6. ≥ 3 file globs in `touches[]`
7. severity P0 / P1
8. frontmatter 含 `downstream_of: H-...` 字段 + 引用的 handoff touches lane-ownership.yaml 或 olympus-roster.md (machine-checkable: grep `downstream_of` + 验引用 handoff touches[])

**Default specialist count** (取最高 tier; e2e test 2026-04-28 修):

```
取最高 tier 规则 (overlap 时):
- 含 P0 OR 改 protocol/** OR 改 lane-yaml OR 改 roster (新 lane) → "大"
- 否则数 mandatory 条件命中数:
  - 命中 ≥ 4 → "大"
  - 命中 2-3 → "中"
  - 命中恰好 1 → "小"
```

| Tier | default specialist | 视角组合 |
|---|---|---|
| **小** | **1 specialist** | zeus 按类型选 (单视角) |
| **中** | **2 specialist** | architect + silent-failure-hunter (架构 + 验收) |
| **大** | **3 specialist** | architect + silent-failure-hunter + security-reviewer (架构 + 验收 + 安全/边界) |

视情况额外加 (按 trigger 类型, 不算入 default):
- spec 含 code sample → `typescript-reviewer`
- 改 hooks / KV / 凭证 → `security-reviewer` (如果 tier 默认没含)
- 改 D1 schema → `database-reviewer`
- verify 脚本 ≥ 10 行 → `code-reviewer`
- multi-handoff dispatch / spec gap / lane-guard 撞 → `general-purpose`

**Specialist 选择规则** ("小" tier zeus 按类型选):
- structural / new lane / spec design → `architect`
- verifiability / unverifiable items → `silent-failure-hunter`
- multi-handoff dispatch / spec gap / lane-guard 撞 → `general-purpose`
- auth / KV / 凭证 / cross-tenant → `security-reviewer`

**其他 handoff (P2/P3, 单 file spec amendment, lane re-route, status flip)** = zeus solo, no archive, no verify script.

### 2.2 Workflow

```
1. zeus 写 handoff (草稿状态, 不 push)
2. 跑 §2.1 trigger machine-judge → 决定 mandatory? + default specialist count (1/2/3)
3. 并行起 specialist agent
4. 收集 review 报告 (Critical / High / Medium / Low)
5. Critical escalation: 1st specialist 找 ≥ 1 个 Critical → mandatory escalation
   - 加 1 个跟 1st 不同视角 specialist (default 1 → 2; default 2 → 3; default 3 → 加 typescript-reviewer / database-reviewer 视情况)
   - **bao audit-able 记录**: archive header 必含 `escalated: true|false` + `escalated_specialist: <name>` 或 `escalated: false / reason: <no-critical>`
   - zeus 不记 = 流程违规, bao 可 grep audit
6. Critical + High 全修. Medium / Low 评估后决定 + 记录在 archive
7. 二次 review (修完后, 起 1 个 specialist (跟 1st 不同视角) 跑 sanity check). archive 必记 `secondary_review_specialist: <name>`
8. 通过 → push handoff → forward block
```

**Critical 没修不可派**. High 没修需 zeus 显式记录"接受 risk + reason" + bao 知会.

**Why escalation enforcement**: §2.2 step 5 "auto" 在 v1.0 是 unverifiable claim (council Critic 提). v1.1 改成 archive grep-able 字段 — escalation decision 不在 archive 里 = 流程违规. bao 任何时点可 `grep -r "^escalated:" .olym/handoffs/<H-id>-pre-dispatch-review.md` audit.

### 2.3 派遣前 review 输出 archive

每次派遣前 review 输出归档 `.olym/handoffs/<H-id>-pre-dispatch-review.md`, 让 worker 看到 reviewer 找的洞 + zeus 怎么修.

**Archive 必含 frontmatter** (machine-checkable, bao audit-able):

```yaml
---
handoff_id: H-YYYY-MM-DD-NNN
trigger_tier: 小 | 中 | 大
default_specialists: [architect, silent-failure-hunter, ...]
critical_count: <1st specialist 找到的 Critical 总数>
escalated: true | false
escalated_specialist: <name> | null
escalated_reason: <"no critical found" | "1st found N critical, invoked X">
secondary_review_specialist: <name> | null  # §2.2 step 7
high_count: <H 总数>
high_accepted_risk: <列表 — high 没修的, 含 reason + bao 知会状态>
review_completed_at: YYYY-MM-DD HH:MM
---
```

`scripts/fleet-status.sh` 升级时 grep `critical_count` / `escalated` 字段做 kill-switch (§6.4) 数据收集.

---

## 3. 功能验收 (端到端 demo-able capability)

**核心**: 验收 = **一个**端到端 feature, 不是 N 个独立勾.

**Why** (bao 2026-04-28): "多个验收一起, 形成功能, 要组织一下". 单独 unit 全过 ≠ feature 真能用. self-reported 验收 = bias.

### 3.1 模板 (任何 handoff 必含)

```markdown
## 验收功能 (Acceptance Feature)

**Feature 名称**: <一句话描述能 demo 的 capability (用户视角 / 系统视角)>

**端到端场景** (按顺序串):
1. <step 1: 输入 / 命令> → <期望输出>
2. <step 2: ...> → <...>
3. <step 3: ...> → <...>

**Pass 标准**: 全部 step 通过. 任一 step fail → status: in_progress (不能 flip done).

**Verify 脚本** (zeus + assignee 都可重跑):
```bash
bash scripts/verify-<H-id>.sh
# 期望 exit code 0 + stdout 含 ✓ 标记
```

**Counter-evidence** (看似过了但其实没真 ship 的信号):
- e.g., 文件建了但没人 import → 没真消费
- e.g., audit 输出空数组 → 没真扫
- e.g., typecheck pass 但 strict: false 偷偷开 → grep tsconfig.json strict

**Demo artifact**: 截图 / asciinema / 输出片段 (附进 status: done handoff body)
```

### 3.2 反模式 (不允许)

❌ "9 个文件全建" (count 不证 quality)
❌ "我读了 spec" (self-reported)
❌ "理解了" (no verification possible)
❌ "应该能用" (no demo)
❌ "Day N EOD" 没具体时间点 (allows drift)
❌ verify 脚本不存在 / 不 runnable

### 3.3 正模式

✅ 端到端命令链 (typecheck → smoke pilot → 5 worker build)
✅ counter-evidence 写明 (哪些假象 = 没真 ship)
✅ time-box 具体 (Day 1 EOD = 23:59 +08, 不到 EOD 派 follow-up handoff 自报)
✅ demo artifact 附 (截图 / log)

---

## 4. 派遣后 Review (产品 QA)

引用 [protocol/review.md](review.md) themis tier 决策树.

worker push + status: done + 附 demo artifact → zeus ping themis (review chief of staff) → themis 按 tier (A/B/C) 派 ECC specialist agent → review 通过 → zeus flip verified.

**派遣后 review ≠ 重做派遣前 review**. 派遣前审 spec / 设计, 派遣后审 PR 实施 (代码质量 / security / typing / silent failure).

---

## 5. 跟其他 protocol 关系

- [protocol/handoff.md](handoff.md) §2 frontmatter — verification 段加进 handoff body
- [protocol/review.md](review.md) — 派遣后 review (themis 派 specialist)
- [protocol/conduct.md](conduct.md) §3 — zeus 收尾 sequence 含 cross-cutting audit (这是 daily verification, 不是单 handoff verification)

---

## 6. zeus 不再 self-review

**bao 2026-04-28 钦定**: "你 review 自己的工作 — 自己 review 自己肯定不行的".

zeus self-review **禁止** 作为派遣前唯一手段. trigger 满足 §2.1 mandatory 条件的 handoff 必须 ≥ 1 个独立 specialist agent.

### Trivial handoff = machine-judge (不让 zeus 自决, 防 self-review 后门)

trivial 必须**同时**满足:
1. frontmatter-only diff (status / updated 字段改, body 不动)
2. `touches[]` 跟所有 active handoff 无 overlap
3. severity P3
4. 不在 §2.1 mandatory trigger 列表里

任何不满足 → mandatory pre-review. 不让 zeus 自决"trivial".

### Protocol/lane-yaml edit 特殊 — bao 是最终审核权威

改 `.olym/steering/protocol/**` / `.olym/steering/lane-ownership.yaml` / `.olym/steering/olympus-roster.md` 任何文件:
1. zeus 写完 → push 到 zeus-only branch (e.g., `chore/zeus-protocol-<date>`), **不直接 main**
2. specialist (architect / silent-failure-hunter) review 该 branch
3. **bao 看 + approve** ← critical: 没有其他 specialist agent 有权 block zeus 改 denylist 文件 (council Skeptic 洞察)
4. bao 同意后, zeus merge main

**Why**: 这些文件在 lane-ownership.yaml denylist (zeus-only writeable). 没 fleet member 能 review-block. bao = system-wide enforcement authority.

### Tie-break (specialist 之间 Critical 冲突)

≥ 2 specialist 给冲突 Critical (e.g., security-reviewer 说"锁紧" + silent-failure-hunter 说"失败大声"):
1. zeus **选边 + 记录冲突 + 选边理由** (写 handoff body 派遣前 review 段)
2. **bao 可推翻** (final authority on protocol-level conflict)
3. 不让 zeus 自决也不让 bao 默认决定

### Kill-switch (process self-deprecation)

任何 specialist 连续 10 个 dispatch 0 Critical → demote 到 opt-in (zeus 不再默认调).
重新触发条件: zeus 注意到该 specialist 领域有 silent failure 重新启用.

**Why**: 防 process calcification (council Pragmatist). 当 zeus drafting 改善后, review 负担应自动下降, 不应固化.

---

## 7. 实时通信 vs 异步通信

**zeus 跟 fleet member (atlas / iris / athena 等)**: **异步**, 走 git-based handoff + bao forward 中转. **不能实时**.

**zeus 跟 ECC inline subagent (architect / themis / general-purpose / etc)**: **实时**, zeus context 内 Agent tool 起 subagent.

**fleet member ↔ fleet member**: 异步, git push + zeus 中转 + bao forward.

**hermes service** (VPS MiniMax / Maya / Telegram): zeus 通过 `Agent(subagent_type: "hermes")` 实时调用.

详见 [protocol/handoff.md](handoff.md) §9 跨机器 fleet 同步.

---

## 8. Dike — 派遣后 zeus 自审 (skill-driven, 持续迭代)

**Why**: §2 派遣前 review 审 handoff 内容, §4 派遣后 review 审 fleet PR. 但 **zeus 是否真的走了 §2 流程** 没人审 — zeus 自决"忽略" = self-review 后门. dike 填这空, 形成闭环.

**Skill 主体**: [.olym/skills/dike/SKILL.md](../../skills/dike/SKILL.md)

### 8.1 角色定位

- specialist 维度第 4 位 (zeus inline, 跟 themis / prometheus / demeter 同维度)
- skill-driven (不是裸 LLM 模板)
- 不停迭代 (累积 <project> 管理特有 patterns, 复利改进)
- bao approve mandatory for skill update (zeus 不能自决加 known patterns)

### 8.2 Invoke 时机 (静默 + daily 回顾)

**核心**: dike 跟实时 specialist review 严格区分 — dike 静默 background 跑, 不阻塞 zeus 主线; daily 一次回顾 (bao 2026-04-28 钦定 "dike 静默审核, 一天回顾一次; 代码 review 是实时要修改的").

**启动期 (initial 30 days, 2026-04-28 起)**:

| 时机 | 模式 | 触发 | 输出 |
|---|---|---|---|
| 每次 dispatch 后 | **background 静默** | zeus 派完 → `Agent({ run_in_background: true, ... })` 起 dike | `.olym/audits/zeus-quality/<H-id>-quality.md` (zeus 不实时看) |
| **EOD 回顾 (daily)** | foreground | zeus 收尾 step 8 — 一次性看 today 所有 quality file | `.olym/audits/zeus-quality/eod-YYYY-MM-DD.md` (汇总) |
| Monthly self-audit | foreground | 每月 1st silent-failure-hunter 审 dike skill (走 §6.2) | `monthly-self-audit-YYYY-MM.md` |

**成熟期 (30 天后)**: daily 回顾 → **weekly 回顾** (周日 EOD), background 静默维持. 详见 [SKILL.md "When to activate"](../../skills/dike/SKILL.md).

启动期 threshold ≥ 1 occurrence 即提议加 pattern; 成熟期 ≥ 3.

**bao_notify_required: yes 自动 surface** (SessionStart hook + fleet-status.sh) — zeus 不能 silently drop, 但不 block dispatch.

### 8.3 Audit 5 维度 (dispatch 质量)

跟 [SKILL.md](../../skills/dike/SKILL.md) 同步:
1. 派遣前 review 走了 (§2 流程 + specialist count + P0 修齐 + 二次 review)
2. trigger machine-judge 准确 (§2.1 8 条 + downstream_of)
3. archive 完整 (§2.3 frontmatter 8 字段)
4. 验收功能模板用了 (§3 端到端 demo-able)
5. forward block 完整 (outcome / constraint / blocker / 签名)

### 8.4 Skill iteration governance

- pattern occurrences ≥ 3 → zeus 提议加 known patterns
- **bao approve mandatory** (类似 §6.2 protocol edit, 防 zeus 自决加 pattern 绕过 self-review ban)
- 改 SKILL.md / patterns/ 走草稿 branch + bao approve

### 8.5 Escalation (P0)

dike audit `overall_severity: P0` → mandatory `bao_notify_required: yes` → zeus 收尾 forward block 含 "@bao: dike P0 finding" → 不让 zeus 静默忽略.

### 8.6 跟 themis 区别

- **themis** (review chief of staff) = 派 specialist 审 **fleet PR** (worker 工作产出, §4 派遣后)
- **dike** (zeus quality tracker) = 审 **zeus 管理动作** (派遣 / forward / cross-cutting audit / 收尾, §8 派遣后)
- 母女对应, fleet 形成"派遣前 (§2) + 派遣后 fleet PR (§4 themis) + 派遣后 zeus 自审 (§8 dike)" 三段质检
- 三段不重叠
