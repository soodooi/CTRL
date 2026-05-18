---
id: olym-main-loop
type: protocol
status: active
scope: cross-project (olym framework asset, git 即用)
created: 2026-05-17
sibling: evolution.md (持续提升 + research lifecycle), git.md (commit + branch), review.md (themis tier)
---

# Olym Main Loop — 10 Stage Dev Cycle

> Olym dev loop. 一个 idea 从源头到 ship + learn 的全路径.
> 反某 monolithic refactor 反例 (atomic single-PR cutover 撞墙) — 每 stage 都有 quality gate.

## Why 10 stage

简化 6 stage (ADR → SPEC → LANE → PR → COMMIT → 合并) 漏 4 key:
- 前置 **TRIGGER + RESEARCH** — 防盲做
- 插入 **REVIEW** — 防 AI propose ≠ AI execute (#1 强一致哲学)
- 后置 **VERIFY + LEARN** — 防"名义 done 实际系统残缺", 持续提升闭环

## 10 stage 一览

```
TRIGGER → RESEARCH → ADR → SPEC → HANDOFF → LANE → PR(REVIEW) → MERGE → VERIFY → LEARN
   ↑                                                                                  │
   └──────────────────── feedback loop ────────────────────────────────────────────────┘
```

## Per-stage 详

### 1. TRIGGER (问题源头)

- 源头: directive / audit finding / consumer 反馈 / 撞墙复盘 / spike-result
- Artifact: 无 (fleet 内部 awareness)
- Exit: 答 "这是为了 ___ ship value" (#0 元规则), 答不出 → 砍

### 2. RESEARCH (探索)

- spike (可行?) / proposal (如何做?) / poc (能跑?), per `evolution.md §5`
- Timeboxed: spike 1-3 day, proposal 1-2 day, poc 1-5 day
- Artifact: `.olym/research/{spikes,proposals,pocs}/<topic>-<date>/`
- Tool: `bash scripts/scratch-new.sh <type> <topic> [persona]`
- Exit: RESULT.md 含决策证据
- Anti-pattern: 重复 spike / 孤儿 spike (无 ADR 引用)

### 3. ADR (决策)

- MADR 模板 (单决策, status: proposed/accepted/shipped/superseded/reverted)
- Artifact: `.olym/decisions/<NNN>-<slug>.md` (framework) 或 consumer-specific `docs/decisions/`
- Owner: zeus (framework) / lane owner (lane-scoped) / cross-project consumer (跨项目)
- Approval: 决策者批准 (任何) / cross-project consumer 共审 (framework ADR)
- Exit: status: accepted + ship value clear

### 4. SPEC (规范)

- 落地具体: design + requirements + tasks (一个 spec = 一个 ADR 的 implementation 蓝图)
- Artifact: `.olym/specs/<topic>/` (framework) 或 `docs/specs/<topic>/` (consumer)
- Owner: zeus (framework spec) / lane owner (lane-scoped spec)
- Exit: spec frozen (no major change pending implementation)

### 5. HANDOFF (派遣)

- dispatch to lane owner
- Frontmatter: id / title / severity (P0/P1/P2/P3) / status / reporter / assigned_to / lane / touches / acceptance / goal
- Per #0 元规则: handoff 必答 "这推进什么 ship value"
- Artifact: `.olym/handoffs/H-<YYYY-MM-DD>-<NNN>-<slug>.md` (framework) 或 `docs/handoffs/` (consumer)
- Tool: handoff frontmatter validator (audit script)
- Exit: status: open → assigned_to set

### 6. LANE 执行 (实施)

- lane owner 在 worktree 实施 (跟 spec 走)
- 三轴解耦: persona × lane × business (lane-A/B/C/...)
- Worktree: `.worktrees/<lane>/` (long-lived) 或 `.worktrees/scratch/<topic>/` (short)
- Lane-guard hook enforces scope (per `.olym/steering/lane-ownership.yaml`)
- Exit: code commit ready

### 7. PR + REVIEW

- PR 创建 + commit (per `.olym/steering/protocol/git.md`)
- Themis review tier A/B/C (per `.olym/steering/protocol/review.md`):
  - **A tier**: 重大改动 (>500 LOC / 跨 lane / 协议变更) — themis APPROVE 必需 + 决策者 approval
  - **B tier**: lane-scoped feature — themis APPROVE 必需
  - **C tier**: 小活 (doc/typo/<200 LOC) — themis APPROVE optional
- CI: pre-push hook (代码全英 / shared-layer / v3.2 token / dike skill 决策者-approved trailer)
- Exit: PR APPROVE + CI green

### 8. MERGE (合并)

- squash to main (per `.olym/steering/protocol/git.md §squash-verify`)
- Verify: `gh pr list --state merged --head <branch>` (squash-merged 不是 `git cherry`)
- Branch cleanup: `git branch -D <feat>` (squash 后必须 -D)
- Exit: main 同步 + branch 清

### 9. VERIFY (验证, ship 后)

- Smoke test: curl `/health` or relevant endpoint, screen UI flow
- Audit: `audit-cross-cutting.mjs` finding count not regress
- 3-row chronology (per handoff): verbal-go (Stage 0) / merge-go (Stage 8) / verify-go (Stage 9)
- Dike audit: EOD aggregate (per `protocol/conduct.md §Zeus 收尾`)
- Anti-pattern: "名义 done 实际 broken" (某 monolithic refactor restore PR 反例)
- Exit: handoff status: in_progress → done (verify-go)

### 10. LEARN ↑ (反馈, 闭环回到 TRIGGER)

- Growth-log: persona 更新 `growth-log.md` (本次学到什么 / 踩什么坑 / olym 可提升点)
- ADR retro: 撞墙时新开 retro ADR (per `evolution.md §Contribution sources`)
- Cross-project: 跨项目 lesson 进 zeus 跨项目 memory (`.olym/personas/zeus/memory.md`)
- Cadence: persona EOD, zeus 每周 synthesize, 决策者 每月 cross-project review
- 触发新 TRIGGER (回到 stage 1): 反复 pattern 升级为 framework ADR

## Cross-cutting gates (任何 stage 触发)

| Gate | 触发 | 工具 |
|---|---|---|
| Dike audit | EOD / 完结 handoff / 每月 | dike skill |
| Themis review | PR stage 强制 | review.md tier A/B/C |
| Cross-cutting audit | EOD / PR pre-merge / 每周 | `scripts/audit-cross-cutting.mjs` |
| #0 元规则 check | 每 stage entry | 答 "这推进什么 ship value" |
| Zeus stewardship | 任何 cross-lane / framework 改 | zeus main tree, denylist enforced |

## Anti-pattern (撞墙 lesson)

| 反例 | Stage 失败 | Lesson |
|---|---|---|
| Atomic single-PR cutover | 跳过 stage 2 RESEARCH 的 PoC | 某 monolithic refactor restore PR 印证 (per #0 元规则) |
| 名义 done 实际 broken | 跳过 stage 9 VERIFY | done 标准应加 "1 周内无 restore PR" |
| 孤儿 spike / proposal | 无 stage 3 ADR 引用 | per evolution.md anti-pattern: kill (bloat) |
| AI propose 直接 ship | 跳过 stage 7 REVIEW | per #1 强一致哲学: AI propose ≠ AI execute, destructive 必经决策者 |
| Lane scope 蔓延 | stage 6 不守 .olym/steering/lane-ownership.yaml | 反 lane-guard hook (block writes outside lane) |

## Reference

- [`evolution.md`](evolution.md) — 持续提升 + research lifecycle (stage 2 详)
- [`protocol/git.md`](../steering/protocol/git.md) — commit + branch + squash-verify (stage 7-8 详)
- [`protocol/review.md`](../steering/protocol/review.md) — themis tier A/B/C (stage 7 详)
- [`protocol/handoff.md`](../steering/protocol/handoff.md) — handoff frontmatter + lifecycle (stage 5 详)
- [`protocol/conduct.md`](../steering/protocol/conduct.md) — zeus stewardship + EOD audit (stage 9 详)
- [`protocol/knowledge.md`](../steering/protocol/knowledge.md) — KM 三层 (stage 10 详)
