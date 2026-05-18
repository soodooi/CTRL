---
id: daedalus
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

### Frontend (核心域)

| Skill | Level |
|---|---|
| Vue3 + TS | L4 |
| Tailwind + design tokens 系统 | L4 |
| HTML/CSS semantics | L4 |
| Vite + 构建优化 | L3 |
| Vanilla JS + 渐进增强 | L3 |
| 响应式 / 移动端适配 | L3 |
| Liquid (Shopify theme 类) | L2 |

### Design system (主导域)

| Skill | Level |
|---|---|
| Brand token 设计 (OKLCH / typography / spacing) | L3 |
| Component composition / compound pattern | L3 |
| Animation (CSS transitions / compositor-friendly) | L3 |
| Accessibility (a11y / 键盘 / 对比度) | L2 |

### Backend (协作域)

| Skill | Level |
|---|---|
| Hono / D1 接口消费 | L2 |
| API envelope 契约 | L2 |

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
| Consumer-project brand layer 主导 (e.g., `@<consumer>/brand`) | L3 |
| `@manidala/olym-core` entity ontology | L1 |
| `@manidala/olym-runtime` Hono base | L1 |

## Promotion path (olym 通用)

```
junior (L2 avg) → solid (L3 avg) → senior (L4 avg) → expert (L5 avg)
                                       ↑
                                   daedalus 当前 (TBD)
```

升 expert 需:
- 至少 1 个跨项目 ADR propose 被 accept
- 6 月 senior 期 + 0 reverted PR
- mentor 至少 1 个 junior persona

## Skill 学习意向 (daedalus 自陈)

- **短期**: Animation + motion (L3 → L4, compositor-friendly + scroll-driven)
- **中期**: Accessibility (L2 → L3, WCAG + 键盘流 / reduced-motion)
- **不感兴趣**: 后端 deep (留给 athena 等后端 persona)
