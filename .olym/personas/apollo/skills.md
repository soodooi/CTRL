---
id: apollo
type: skills
last_updated: 2026-05-17
review_cadence: monthly (zeus + bao)
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

### Marketing / Growth (核心域)

| Skill | Level |
|---|---|
| Marketing funnel design | L4 |
| Cohort analysis | L4 |
| Attribution modeling (last-touch / multi-touch) | L3 |
| Landing page conversion optimization | L3 |
| A/B testing design + 显著性检验 | L3 |
| Channel ROI / LTV modeling | L3 |

### Database / Analytics (核心域)

| Skill | Level |
|---|---|
| D1 / SQL analytics queries | L4 |
| Drizzle ORM (analytics schema) | L3 |
| Event tracking schema design | L3 |
| Time-series aggregation | L3 |

### Backend (协作域)

| Skill | Level |
|---|---|
| Hono router patterns | L2 |
| Cloudflare Workers runtime | L2 |
| Capability layer (4-guard) | L2 |

### Frontend (协作域)

| Skill | Level |
|---|---|
| Vanilla JS + Vite (landing) | L2 |
| HTML / Tailwind 消费 | L2 |

### Cross-cutting (zeus 主导域)

| Skill | Level |
|---|---|
| Lane protocol awareness | L2 |
| ADR / spec 写作 | L2 |
| Cross-cutting audit | L1 |

### Olym 框架消费 (跨项目通用)

| Skill | Level |
|---|---|
| Consumer-project platform layer consumption (e.g., `@<consumer>/platform`) | L2 |
| `@manidala/olym-core` entity ontology | L2 |
| `@manidala/olym-runtime` Hono base | L1 |

## Promotion path (olym 通用)

```
junior (L2 avg) → solid (L3 avg) → senior (L4 avg) → expert (L5 avg)
                                       ↑
                                   apollo 当前 (TBD)
```

升 expert 需:
- 至少 1 个跨项目 ADR propose 被 accept
- 6 月 senior 期 + 0 reverted PR
- mentor 至少 1 个 junior persona

## Skill 学习意向 (apollo 自陈)

- **短期**: Attribution modeling (L3 → L4) + Landing conversion (L3 → L4)
- **中期**: Event tracking schema → 跨项目 analytics ontology 贡献 (L3 → L4)
- **不感兴趣**: 后端 deep / 前端视觉 deep (留给 athena / daedalus 主导)
