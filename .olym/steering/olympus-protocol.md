# Olympus Protocol

> Fleet 协作规则索引. 12 类协议 + daily iteration workflow.
> Sibling: [olympus-roster.md](olympus-roster.md) (人事真相).
>
> ⚠️ **zeus-only writeable** — 此文件 (含 `protocol/` 子目录) 被 `lane-ownership.yaml` denylist_explicit (`.olym/steering/**`) 阻 worker 写入. 协议变更由 zeus stewardship 实施.

**Version**: 0.1.0 (starter template — copy of <consumer-project> v1.10 sanitized)
**Total**: **12 类协议子文件**

---

## 12 类协议

| 类 | 文件 | 一句话 |
|---|---|---|
| **Discipline** | [protocol/discipline.md](protocol/discipline.md) | 行为契约索引 stub (实际内容散在 conduct.md + MEMORY.md, 此 stub 仅做导航) |
| **Conduct** | [protocol/conduct.md](protocol/conduct.md) | 处女座 / 不绕 / zeus 收尾 sequence (含 cross-cutting audit) / 离线 fleet 处理 / 自决 / daily cadence |
| **Handoff** | [protocol/handoff.md](protocol/handoff.md) | handoff 流程 / signature / 跨机器同步 / forward block / collision / handover |
| **Review** | [protocol/review.md](protocol/review.md) | tier 判定 (ABC) / specialist 决策树 (themis 派 ECC agent + prometheus + demeter inline) / fix-commit grep / scope 升级 (派遣后 review) |
| **Verification** | [protocol/verification.md](protocol/verification.md) | 派遣前 review (trigger machine-judge + scaled default 1/2/3 by tier + Critical escalation grep-able) + 功能验收模板 (端到端 demo-able) + tie-break + kill-switch + bao 作 protocol edit 最终权威 + dike post-dispatch zeus 自审 |
| **Git** | [protocol/git.md](protocol/git.md) | commit message [H-...] / branch 命名 / squash-verify / pre-push hook / squash-merged 后清理 / worktree 新开 retire / lane-guard 6 步 / .lane 文件 |
| **Knowledge** | [protocol/knowledge.md](protocol/knowledge.md) | KM 三层 (capture/aggregate/steward) + 4 目标 (日报/dev env starter/skills/best-practice) + daily iteration workflow |
| **Spec Discipline** | [protocol/spec-discipline.md](protocol/spec-discipline.md) | spec semver 化 / 4 类内容路由 (Contract/Behaviour/Decision/Plan) / superseded_check / changelog / 反膨胀机制 |
| **Deploy** | [protocol/deploy.md](protocol/deploy.md) | Stage 6 lifecycle: 5-stage SOP (PRE-CHECK/STAGING/PROD/SMOKE/ANNOUNCE) + 5 hard gates + staging matrix + emergency carve-out |
| **Rollback** | [protocol/rollback.md](protocol/rollback.md) | Stage 9 sub-protocol: 4 triggers + per-target table + reverse-order + emergency carve-out |
| **Monitor** | [protocol/monitor.md](protocol/monitor.md) | Stage 8 daily ops: checklist + per-service matrix + 4-tier ladder (info/warn/page/emergency) + cost watch |
| **Incident** | [protocol/incident.md](protocol/incident.md) | Stage 9 full: 4-phase (Detect/Triage/Action/Retro) + 5-min triage budget + 24h retro mandatory at page+ + comm template |

---

## 对话日常映射

| bao 说 | 文件 |
|---|---|
| "怎么开 handoff" | protocol/handoff.md |
| "派遣前 review 谁审" | protocol/verification.md §2 |
| "review 这个 PR 用啥 specialist" | protocol/review.md (派遣后 fleet PR — themis) |
| "zeus 管理质量怎么审" | protocol/verification.md §8 (派遣后 zeus 自审 — dike) + `.olym/skills/dike/SKILL.md` |
| "怎么验收" | protocol/verification.md §3 (功能验收模板) |
| "commit message 格式" | protocol/git.md |
| "处女座规范" | protocol/conduct.md |
| "怎么收尾" | protocol/conduct.md §3 (含 dike step 8) |
| "日报怎么生成" | protocol/knowledge.md |
| "dike skill 加新 pattern" | `.olym/skills/dike/SKILL.md` "Iteration mechanism" + bao approve mandatory |
| "要不要开新 spec" | protocol/spec-discipline.md §6 决策树 (优先 bump 已有 / 下沉 steering / 写 TSDoc / 开 handoff) |
| "spec 怎么写 frontmatter" | protocol/spec-discipline.md §3 (6 强制字段 + superseded_check) |

---

## 本 protocol 跟 Claude 规范关系

**Claude 规范** (must, 底层): `.claude/` 目录 / hooks / agents / SessionStart / handoff frontmatter / memory 单文件.
**Olympus protocol** (建在 Claude 规范上): fleet 怎么协作, 用 Claude 工具实施.

**未来不允许 break Claude 规范** — protocol 在 Claude 规范基础上扩展, 不冲突.

---

## Daily Iteration Cycle

详细 workflow 见:
- **KM 视角**: [protocol/knowledge.md](protocol/knowledge.md) — daily iteration workflow (capture / aggregate / steward 三层)
- **Conduct 视角**: [protocol/conduct.md](protocol/conduct.md) §3 — zeus 收尾 sequence + cross-cutting audit

(此处不再 inline 步骤, 避免 4 处版本漂移. 历史多处描述已收敛到上述 2 个真实位置.)
