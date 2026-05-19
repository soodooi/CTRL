# Olym — Internal Handbook (Navigator)

> 一页入口. ≤250 行. 任何内容深入 = 链 source-of-truth, 不重复.
> 新 zeus session / bao 自查 / 第三方 reader 先读这页.
> Starter origin: https://github.com/soodooi/hello-olym

---

## 1. What is Olym

Olym 是 **multi-agent AI-native dev OS** — 5 层架构 (Identity / Knowledge / Protocol / Tooling / Pipeline) + N 位 fleet (1 主 + M owner + R reserved) 通过 git-based handoff 协同. 内部代号 `olympus` (希腊神栖息地, 全员希腊神 persona). 当前协议 v0.1.0 (从 hello-olym starter 入场).

---

## 2. 5 Layers

| Layer | 答 | 入口 |
|---|---|---|
| **Identity** | 谁是 fleet member, 各 own 哪个 lane | [`olympus-roster.md`](steering/olympus-roster.md) · [`lane-ownership.yaml`](steering/lane-ownership.yaml) |
| **Knowledge** | 项目知识沉淀 — spec / decision / steering / best-practice | [`protocol/knowledge.md`](steering/protocol/knowledge.md) · [`specs/`](specs/) · [`steering/`](steering/) · [`decisions/`](decisions/) · [`best-practice/`](best-practice/) |
| **Protocol** | 12 类协议 | [`olympus-protocol.md`](steering/olympus-protocol.md) — 见 §4 |
| **Tooling** | 自动化 hooks + scripts + commands | `.husky/` · `.claude/hooks/` · [`../scripts/`](../scripts/) · `.claude/commands/` |
| **Pipeline** | dispatch → handoff → branch → PR → review → squash → sediment | [`protocol/handoff.md`](steering/protocol/handoff.md) + [`protocol/git.md`](steering/protocol/git.md) |

---

## 3. Fleet 速查

> **Bootstrap mandatory**: 项目接手后 bao 在 `olympus-roster.md` 填实际 fleet, 然后回头更新此 §3.

**主**: `@zeus` (orchestrator + cross-cutting + Identity/Knowledge/Protocol stewardship, main tree + borrowed worktree, infra/governance, 不写业务码)

**Lane owner (M 位, 业务 × 技术 matrix)**:
- `@athena` = (`<lane-A>`, `<dim>`) — `<scope>`
- `@daedalus` = (`<lane-B>`, `<dim>`) — `<scope>`
- `@apollo` = (`<lane-C>`, `<dim>`) — `<scope>`
- `@hephaestus` = (`<lane-D>`, infra) — `<scope>`

**Reserved**: 待 bao 决.

**Specialist (zeus inline, 4 位, 不占 fleet 名额)**: `@themis` (review) · `@prometheus` (backend tech) · `@demeter` (database tech) · `@dike` (audit)

详见 [`olympus-roster.md`](steering/olympus-roster.md).

---

## 4. 12 Protocols 速查

| Protocol | 答 | 入口 |
|---|---|---|
| **handoff** | git-based 任务交接 + 状态 + 跨机器同步 + `## bao approval` 段 | [`protocol/handoff.md`](steering/protocol/handoff.md) |
| **review** | tier (ABC) / specialist 决策树 / scope 升级 | [`protocol/review.md`](steering/protocol/review.md) |
| **git** | commit / branch / squash-verify / pre-push / lane-guard | [`protocol/git.md`](steering/protocol/git.md) |
| **conduct** | 处女座 / 不绕 / 收尾 sequence / stewardship / retirement SOP / proposal SOP | [`protocol/conduct.md`](steering/protocol/conduct.md) |
| **knowledge** | KM 三层 + 4 目标 + daily iteration workflow | [`protocol/knowledge.md`](steering/protocol/knowledge.md) |
| **discipline** | 行为契约索引 (实际散在 conduct.md + MEMORY.md + spec-discipline.md) | [`protocol/discipline.md`](steering/protocol/discipline.md) · [`protocol/spec-discipline.md`](steering/protocol/spec-discipline.md) |
| **verification** | 派遣前 review + 功能验收 + 派遣后 zeus 自审 (dike) | [`protocol/verification.md`](steering/protocol/verification.md) |
| **deploy** | Stage 6 lifecycle: 5-stage SOP + 5 hard gates + staging matrix + emergency carve-out | [`protocol/deploy.md`](steering/protocol/deploy.md) |
| **rollback** | Stage 9 sub: 4 triggers + per-target + reverse-order | [`protocol/rollback.md`](steering/protocol/rollback.md) |
| **monitor** | Stage 8 daily ops: checklist + per-service matrix + 4-tier ladder + cost watch | [`protocol/monitor.md`](steering/protocol/monitor.md) |
| **incident** | Stage 9 full: 4-phase Detect/Triage/Action/Retro + 5-min triage + 24h retro mandatory | [`protocol/incident.md`](steering/protocol/incident.md) |

总入口 [`olympus-protocol.md`](steering/olympus-protocol.md).

---

## 5. RFC 5-step Cheat Sheet

任何改 olym 自身 (zeus stewardship 文件类) **mandatory 5 步**, 不可合并:

```
1. OPEN     branch + spec + handoff (+ optional ADR)
2. IMPLEMENT  改文件 + commit on branch + push + open PR
3. REVIEW   派 themis (Agent code-reviewer), tier 默认 B
4. MERGE    gh pr merge --squash --delete-branch
5. SEDIMENT dike audit + handoff verified + roadmap mark + best-practice
```

Emergency carve-out: 生产挂可 commit-first, **24h 内**补 spec/handoff/ADR + retroactive themis review.

完整规则见 [`protocol/spec-discipline.md`](steering/protocol/spec-discipline.md) §7.

---

## 6. Common Commands

| 命令 | 用途 |
|---|---|
| `bash scripts/audit-all.sh` | 跑 olym SSOT drift + dogfood audit (EOD) |
| `bash scripts/fleet-status.sh` | 树状态 + handoff 计数 + dike phase + EOD audit 状态 |
| `bash scripts/git-new.sh feat/<name>` | sync main + 开 branch (禁止裸 git switch -c) |
| `node scripts/specs-index.mjs` | 重生 `.olym/specs/_index.md` |
| `node scripts/handoffs-index.js` | 重生 `.olym/handoffs/INDEX.md` |
| `bash scripts/worktree-new.sh <persona> <lane> <branch>` | 新 worktree (派 fleet member) |
| `gh pr list --state merged --head <branch>` | squash-verify (PR 真合 main 否) |
| `node scripts/handoffs-archive.mjs --apply` | manual archive (Stop hook 自动跑此 on main+clean, 7d grace) |
| `node scripts/daily-digest.mjs --apply` | generate today's digest → `.olym/digests/D-YYYY-MM-DD-digest.md` |
| `node scripts/pre-push-dispatch-check.mjs` | manual run — soft-warn missing pre-dispatch-review (runs auto on `git push`) |
| `node scripts/audit-olym-dogfood.mjs` | meta-audit: olym 自己是否遵守 protocol — included in `audit-all.sh` |

完整 scripts 见 [`../scripts/`](../scripts/).

---

## 7. 写新 spec / 新 handoff 决策树 (15s)

```
新需求要写下来
  ↓
现有 spec 能 bump? → 是 → bump (minor/major) + 加 § + changelog. 不开新.
  ↓ 否
是 once-off 决策 (含 alternatives)? → 写 ADR `.olym/decisions/NNN-slug.md`
  ↓ 否
是 evergreen 规则? → 写 steering `.olym/steering/<topic>.md`
  ↓ 否
是 contract (附属代码文件)? → 写 TSDoc, 不开 spec
  ↓ 否
是短期 plan (1-7d)? → 开 handoff, 不开 spec
  ↓ 否
开新 spec (frontmatter 必填 superseded_check)
```

详 [`protocol/spec-discipline.md`](steering/protocol/spec-discipline.md) §6.

---

## 8. 核心契约 (永远不破)

- `git-new.sh` 开 branch (禁裸 `git switch -c` 在未 sync 的 main 上)
- 改 olym stewardship 文件类 = mandatory RFC 5 步 (非 emergency 不允许 commit-first)
- handoff branch commit 必含 `[H-YYYY-MM-DD-NNN]` (commit-msg hook 强制)
- handoff body **必须**含 `## bao approval` 段 (verbal-go quote / proposal ref / emergency reason 三选一)
- 退役 persona 必走 4 步 SOP ([`olympus-roster.md`](steering/olympus-roster.md) "退役 SOP" 段)
- 退役 lane (cold-storage) 走 5-stage lifecycle; frozen lane lane-guard 自动 block
- prod incident page+ tier 24h 内必开 retro handoff ([`protocol/incident.md`](steering/protocol/incident.md) Phase 4)
- spec 文档 version ≠ 产品版本 ([`spec-discipline.md`](steering/protocol/spec-discipline.md) §4)
- "GA" = `lifecycle: GA` 不是 `version: 1.0.0`

---

> 这页 ≤250 行是 hard cap. 任何深入 = 链, 不复制.
> 维护 owner: zeus. 改 = RFC 5 步 (此页是 olym stewardship 类之一).
