# Protocol / Handoff Protocol

> Fleet 通信主渠道. handoff 是 git-based 任务交接 + 状态对齐 + 跨机器同步载体.
> Parent: [olympus-protocol.md](../olympus-protocol.md)

---

## 1. handoff 是什么

- 物理形式: `.olym/handoffs/H-YYYY-MM-DD-NNN-<slug>.md` 单文件 markdown + frontmatter
- 通信方式: **git-based** — 写 → push → 对方 git fetch → SessionStart hook 注入 → 看到
- 替代: 不走 chat / 不走 RPC / 不走中央 broker. 一切 fleet 通信通过 handoff.

---

## 2. Handoff frontmatter 标准

```yaml
---
id: H-YYYY-MM-DD-NNN
title: <短描述>
severity: P0 | P1 | P2 | P3
status: open | claimed | in_progress | done | verified | superseded
reporter: <persona, e.g. zeus / athena / apollo>
assigned_to: <lane | persona>     # see "Lane vs Persona" 段
from: <persona>                   # 通信路径 from
to: <persona>                     # 通信路径 to
lane: <lane>                      # 工作 lane (单字符串, 禁 inline comment)
touches:
  - <file glob>
  - <file glob>
related:
  - H-YYYY-MM-DD-NNN
project_id: <optional-kebab-id>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

**字段说明**:
- **assigned_to**: 谁干 (lane 名主流, persona 名次之)
- **from / to**: 通信路径 (跟 assigned_to 区分 — assigned_to 是 ownership, from/to 是消息路由)
- **lane**: 必须**单字符串**, 禁 inline comment (容易把 yaml 解析破坏 — H-2026-04-26-004 经验)
- **touches**: 文件 glob, lane-guard 用此判断"自家 active handoff 范围"
- **project_id** (optional, 2026-05-05 加): kebab-case 项目 ID, 把多个 handoff 聚合成项目级 rollup. handoffs-index `## By Project` 段读此字段. backward compat: 缺则归 "(no project)" group. 命名跟 spec_id 对齐 (e.g., `olym-v3-protocol` / `creator-credit-pack`). 一项目 N handoffs.
- **category** (optional, 2026-05-05 加): work nature (NOT urgency — severity 是 urgency). 取值 `feature` / `bugfix` / `refactor` / `docs` / `chore` — 跟 conventional commit type 对齐. severity × category cross-product 决定 priority: `P0+bugfix=hotfix` 立即修, `P0+feature=block-ship` 排 sprint, `P2+refactor=nice-to-have`. handoffs-index `## By Category` 段聚合. backward compat: 缺则归 "(uncategorized)" group.

---

## 3. Severity 分级

| 级 | 含义 | 行动 |
|---|---|---|
| **P0** | 数据丢失 / 安全漏洞 / launch blocker / prod down | 立刻接 |
| **P1** | 功能阻塞 / 用户可见 bug / 高频踩坑 | 24h 内接 |
| **P2** | 优化 / 重构 / 文档 | 排队 |
| **P3** | 探索性 / 实验 / nice-to-have | 等 capacity |

---

## 3.5. bao approval 段 (G-048, Stage 0)

每 handoff body **必须** 含 `## bao approval` 段 (Stage 0 Propose 的 trace), 三选一:

```markdown
## bao approval
- bao verbal-go: 2026-05-05: "go P1 第 1 件"
```

或

```markdown
## bao approval
- proposal: [.olym/proposals/P-2026-05-05-NNN-...](../proposals/...)
- bao approved: 2026-05-05 via "ack"
- effort: M (1-3d)
```

或

```markdown
## bao approval
- emergency: production /api/health 5xx, retroactive 24h
```

详 [`.olym/specs/olym-proposal-sop/spec.md`](../../specs/olym-proposal-sop/spec.md). 漏段 = dike P2 finding.

> **Backward compat**: 仅 forward-going 强制 (新建 handoff from 2026-05-05). 53 historical handoffs grandfathered, 不强制回填.

### 3.5.1 Full chronology (verified handoff)

Handoff `status: verified` 时, `## bao approval` 段必须扩到 **3 行 chronology**, 不能只留 verbal-go:

```markdown
## bao approval

- 2026-05-06 verbal-go: "ack 进 G-014" (verbatim) · effort: S (1-2h)
- 2026-05-06 merge-go: themis APPROVE 0 blockers + 1 LOW → PR #106 squash-merged at 2026-05-06T14:49:54Z (mergeCommit 023fb3d5)
- 2026-05-06 verify-go: post-merge close commit 34b619af flipped status `in_progress → verified` + 31st olym dogfood iteration recorded; G-014 P1 done
```

3 行解释:
- **verbal-go** (Stage 0 Propose): bao 同意做这件事的原话或 paraphrased intent + effort 估算
- **merge-go** (Stage 2-3 Review→Merge): themis verdict (APPROVE / CHANGE_REQUEST + 处理结果) → PR # + squash-merged 时间 + mergeCommit short SHA
- **verify-go** (Stage 4 Verify): post-merge close commit SHA + status flip 痕迹 + roadmap goal closure (e.g., "G-NNN Pn done")

**回填规则**:
- 任何 `status: verified` 但只有 verbal-go 的 handoff = dike P2 finding (selective application)
- EOD wrap 时 zeus 必须 backfill 当天所有 verified handoff 到 3 行 chronology, **不能只补最后一个**
- 历史回填 (>7 天) 不强制, 但显式加一行 `2026-MM-DD backfill note: ...` 说明 retroactive

**Why 3 行**: 单 verbal-go 行只 capture intent, 没 capture review chain + verification outcome. 读 handoff body (不读 commit history / GitHub UI) 的人无法判断 "themis 真审过吗", "PR 真 squash 了吗", "status 真 flip verified 吗". 3 行让 handoff body 自洽 audit trail.

**Reference impl**: H-2026-05-06-005 / H-006 / H-007 (full chronology); H-005/H-006 在 2026-05-07 backfill 补齐.

---

## 4. Status 流转

```
open → claimed → in_progress → done → verified
                              ↓
                        superseded (任务取消 / 被新 handoff 替代)
```

- **open**: 已创建未 claim
- **claimed**: assignee 看到了, 准备做
- **in_progress**: 实际开干
- **done**: assignee 完成, 等 zeus review
- **verified**: zeus review 通过, 闭环
- **superseded**: 取消 / 被替代

**done → verified 是 zeus 唯一 stewardship**, lane owner 不能自己 flip verified.

---

## 5. 命名约定

`H-YYYY-MM-DD-NNN-<slug>.md`:
- `YYYY-MM-DD` = 创建日期 (绝对日期, 不写 "today")
- `NNN` = 当日序号 (001, 002, ...)
- `<slug>` = 短描述, kebab-case

例: `H-2026-04-26-007-vulcan-to-daedalus.md`

---

## 6. Commit message 关联

完成 handoff 时 commit message 加 `[H-YYYY-MM-DD-NNN]` 前缀:

```
fix(admin): [H-2026-04-26-004] vue/attributes-order auto-fix - common
```

便于 git log + handoff cross-reference. 详细 git workflow 见 [git.md](git.md).

---

## 7. Signature 协议 (强制)

任何 forward block / progress report / handoff body / 跨机器消息**必须**含发送方 + 接收方标识.

### 7.1 Forward block 顶部

```
@<recipient>: ...content... — from @<sender>
```

例: `@athena: 警告... — from @zeus via bao forward`

### 7.2 Progress report (worker → zeus)

开头 `@zeus: ...`, 结尾 `— from @<persona>`.

### 7.3 Cross-machine message

加 `(from <machine-id>)` 标记物理来源:

```
— from @apollo (desktop)
```

### 7.4 Handoff frontmatter

`from:` + `to:` 字段填 persona, 区分跟 `assigned_to` (assigned_to = 谁干, from/to = 通信路径).

**Why signature**: 之前 fleet 消息没签名 → bao forward 给 zeus 后 zeus 不知道 originator → 责任追溯断, 上下文丢. 签名后 fleet 协作可追溯.

### 7.5 Optional frontmatter 字段 (verification protocol 引入)

下面字段 optional, 满足条件时**必填** (machine-checkable for 派遣前 review trigger):

- `downstream_of: H-YYYY-MM-DD-NNN` — 当本 handoff 是某 lane-yaml/roster 改动的 downstream 通知时, 引用源 handoff. **触发 verification §2.1 mandatory pre-review**.
- `pre_dispatch_review: <archive-path | "skipped (trivial)">` — 派遣前 review archive 路径.
- `demo_artifact: <path | URL | "not_applicable" | "pending">` — 验收功能 demo 产物.

详细 schema + 模板见 [protocol/verification.md](verification.md) §3.1 (验收功能模板) + §2.3 (archive frontmatter).

---

## 8. Forward block 风格 (zeus → worker via bao)

zeus 给 fleet worker 的 fenced block 给:

1. **Outcome 期望** (你需要做出什么结果)
2. **Critical constraint** (lane / scope / commit policy / denylist / 不动哪些 file)
3. **Blocker 通知方式** (开 handoff / ping zeus)

**不给** git 命令细节 / 文件改法 / step-by-step 工作流 — worker 自决执行策略.

**Why**: bao 反馈 "你安排任务的时候, 不用太具体, 不然实操会受很多限制". 太详细的 step-by-step 限制 worker 灵活实操. worker 在自己环境/状态下知道最优执行路径.

---

## 9. Cross-machine fleet 同步

**问题**: bao 多台机器 (laptop + desktop), 本机 zeus 看不到台式机 fleet 状态 (e.g., @apollo / @dionysus 在 desktop).

**当前应对**:
- 跨机器消息走 git push + bao 中转 (HANDOVER.md 模式)
- handoff frontmatter `from: @<persona> (machine: desktop)` 标注物理来源
- 本机 zeus 通过 `git fetch` + `origin/feat/*` branch mtime 推断台式机活跃度

**长期 KM 任务** (protocol/knowledge.md):
- 跨机器 fleet 状态同步机制 (周期 push status snapshot 到共享 branch)
- 离线 fleet 自动检测 (本机 zeus 启动时报 "X 离线, Y 有 dirty")

---

## 10. Handoff Collision 协议 (撞文件 4 选项)

两个 handoff 同时改同一 file → 4 选项:

| 选项 | 含义 |
|---|---|
| **A. 并发** | 两 handoff 各自做, 后合并者 rebase. 适合无逻辑 overlap |
| **B1. 顺序** | 一个先做完合 main, 另一个 rebase 起步 |
| **B2. 并发 + rebase** | 两个并发但都基于 origin/main, 后合者 rebase main |
| **B3. handover** | 一个让另一个接管全部, 跟 4 步 handover 协议 |
| **C. 强制 zeus 协调** | 都不做主, 等 zeus split scope 派 |

zeus 决定按 collision 性质选.

---

## 11. Handover 协议 (4 步)

A persona 把工作 handover 给 B persona:

1. **A 标 intent**: handoff body 写 "handover to @B (原因)", 提交 push
2. **B 接管**: 自己开 follow-up handoff `from: @A, to: @B, related: <H-original>`, 接续干
3. **Commit 约定**: B 的 commit message 加 `[H-YYYY-MM-DD-NNN-handover]` 前缀, body 写 "Continued from H-... by @A"
4. **lane scope 复核**: B 必须确认接的工作仍在自己 lane scope (或开 cross-lane handoff)

例: H-2026-04-26-007 (@vulcan → @daedalus, creator handover)

---

## 12. 离线 fleet 处理

ping 前必须确认 persona 在线 (bao 说"X 不在线" 或本机看不到 worktree session = 离线).

**离线 fleet member 的 dirty / 异常状态**:
- zeus **不主动代处** (会破坏 in-flight context)
- **不留 ping** (无接收 channel)
- 直接留过夜等其上线自决
- 备忘只记本地 inventory **不写 handoff** (handoff 是 fleet 通信不是单边备忘)

---

## 13. Read-Full-Body 规则

起 worker prompt 含 "watch for blocker X" clause 之前, 必须 grep handoff body `KV` / `凭证` / `credentials` / `token` / `前置` / `背景` 确认 alleged blocker 是否已 resolved.

prefer "凭证齐全直接 smoke" 不要 "如果卡住 mark blocked".

---

## 14. Done 后归档 vs 删除

memory 规则: **delete (not archive)** stale handoffs once merged. 但实际 `.olym/handoffs/` 仍留大量 done — 待 KM 任务清理.

清理触发:
- handoff `status: done` + 关联 PR merge 满 7 天 → 可删
- handoff `status: superseded` → 立即可删
- handoff `status: verified` → 保留 (历史决策记录)
