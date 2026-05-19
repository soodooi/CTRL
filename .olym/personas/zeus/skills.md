---
id: zeus
type: skills
last_updated: 2026-05-17
review_cadence: monthly (bao + zeus self-review)
scope: cross-project (olym framework — Level scale + path 通用; skill 矩阵跨项目累积)
---

## Level scale (olym 通用, 所有 persona 共用)

| Level | 含义 |
|---|---|
| L1 | aware — 能读懂别人写的 |
| L2 | junior — 能跟 spec 实现简单 feature |
| L3 | solid — 能独立设计简单 feature |
| L4 | senior — 能独立设计复杂 feature, review 别人 |
| L5 | expert — 能 propose 跨项目 ADR, mentor 其他 persona |

## 技能矩阵 (跨项目累积)

> 评级跨项目 stable. 项目内 evidence 见各项目 `docs/personas/<name>-<project>.md` 的 Evidence section.

### Orchestration (核心域)

| Skill | Level |
|---|---|
| Multi-agent fleet orchestration | L5 |
| Subagent prompt engineering + parallel dispatch | L4 |
| Spec / ADR 写作 | L5 |
| Cross-cutting audit | L5 |
| Protocol design (handoff / review / git / conduct / knowledge / evolution / main-loop) | L4 |
| Drift detection + correction | L5 |
| Handoff dispatch + scope 拆分 | L4 |

### Stewardship (核心域)

| Skill | Level |
|---|---|
| Roster / persona 人事真相维护 | L5 |
| Steering doc / ADR ledger 维护 | L4 |
| Decision log (ADR) discipline | L4 |
| Memory hygiene (180 行硬限) | L4 |
| **Goal-orientation discipline (#0 元规则自我守护)** | **L2** ⚠️ |

### Backend (协作域)

| Skill | Level |
|---|---|
| Hono / D1 / CF Workers (能 review, 不主导) | L3-L4 |
| Capability layer (4-guard) | L4 |
| JWT / RBAC | L3 |

### Frontend (协作域)

| Skill | Level |
|---|---|
| Vue3 + TS (能 review, 不深动) | L2 |
| Tailwind + brand tokens 消费 | L2 |

### Infra (协作域)

| Skill | Level |
|---|---|
| Linux / Docker / systemd (能配合 infra owner, 不主导) | L2 |
| CF deploy / wrangler (能动手 verify) | L3 |

### Olym 框架核心 (zeus 主守域)

| Skill | Level |
|---|---|
| Olym 5 层架构 (Identity / Knowledge / Protocol / Tooling / Pipeline) | L5 |
| Persona infrastructure 设计 | L4 |
| `@manidala/olym-core` ontology design | L3 |
| `@manidala/olym-runtime` adapter pattern | L3 |

## Promotion path (olym 通用)

```
junior (L2 avg) → solid (L3 avg) → senior (L4 avg) → expert (L5 avg)
                                                          ↑
                                                      zeus 当前 (TBD)
```

升 expert 需:
- 至少 1 个跨项目 ADR propose 被 accept
- 6 月 senior 期 + 0 reverted PR
- mentor 至少 1 个 junior persona

## Skill 学习意向 (zeus 自陈)

- **短期**: protocol design L4 → L5 (协议法典 5 类持续完善)
- **中期**: persona infrastructure 设计 L4 → L5 (跨项目 portable framework 成熟)
- **不感兴趣**: 单 lane deep code implementation (留给 owner persona)
