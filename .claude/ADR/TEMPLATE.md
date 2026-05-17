---
id: ADR-XXX
title: <短句决策名，不超过 12 字>
status: Proposed  # Proposed | Accepted | Superseded | Rejected
date: YYYY-MM-DD
proposers: [zeus | athena | hephaestus]
accepter: bao
supersedes: []   # e.g. [ADR-001#section-3.1]
superseded_by: []
implemented_by: []  # e.g. [.olym/specs/kernel/spec.md]
tags: [foundation | shell | llm | mesh | product | commercial]
---

# ADR-XXX: <Title>

> **One decision per ADR**. 如果本文档讨论 2 个以上独立决策，请拆。
> **不写实现细节**——细节放 `.olym/specs/<domain>/`。
> **不写阶段计划**——计划放 `.olym/steering/ctrl-strategy.md`。
> **不写迁移步骤**——步骤放 `.olym/handoffs/H-YYYY-MM-DD-NNN-*.md`。
> ADR 只写：**决策 + 为什么 + 后果 + 替代方案**。

---

## 1. Context

为什么现在要决策？写当时的事实、约束、压力来源。
**含具体数字、引用源**（commit、handoff、用户访谈、bao 指令的 session id）。
不写决策方案本身。

## 2. Decision

**一句话**：CTRL adopts/rejects/replaces ...

再 2-3 句展开**决策内容**。不超过 1 段。

## 3. Consequences

### Positive
- ...

### Negative
- ...

### Neutral / Trade-offs
- ...

## 4. Alternatives Considered

| 方案 | 优点 | 缺点 | 拒绝原因 |
|------|------|------|---------|
| A. | ... | ... | ... |
| B. | ... | ... | ... |

至少列 2 个被拒方案。**写 Rejected ADR 也用这个模板，把 status 设 Rejected**。

## 5. Compliance / Validation

如何验证该决策真的落地？
- 触发回归 review 的条件（"如果 X 失败，回到 ADR review"）
- 关联的 success criteria（量化 + 截止）
- 关联的 spec 文件（implemented_by frontmatter）

## 6. References

- 上游 ADR / spec / handoff
- 外部论文 / 库文档
- 类比项目案例

---

**Footer 自动**（不要手填）：
- 本 ADR 由 `build-index.ts` 收录进 [INDEX.md](./INDEX.md)
- 当前有效架构请见 [EFFECTIVE.md](./EFFECTIVE.md)
- 决策流程见 [PROCESS.md](./PROCESS.md)
