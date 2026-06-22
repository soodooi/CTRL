---
title: 文档保鲜机制 — 防过时 / 定时检查 / 更新
kind: mechanism
status: living
freshness: stable
review_by: 2026-09-22
verify_against: 本机制自身稳定;若发现文档反复过时未被发现,说明机制没执行,回看本文
created_at: 2026-06-22
owner: bao
author: zeus
trigger: 本 session GOAL.md 进度过时(把已达成的 SC8 标"未做")误导了一整轮——bao 问「研究/目标会随开发过时,处理机制是什么?」
related:
  - "[[GOAL]]"
  - "[[master-plan]]"
  - "[[dev-playbook]]"
---

# 文档保鲜机制

> bao 2026-06-22:「研究成果会随开发慢慢过时,过时的处理机制是什么?是不是也要做成文档、定时检查、更新?」——对。本文就是那个机制。

## 一、根本诊断:为什么会过时

本 session 的活教材:GOAL.md 把已达成的 SC8 标成"下一步未做",误导我喊了一整轮"回 SC8"。**病根 = 文档存了「易变状态」(进度/完成度),代码变了文档没同步。**

铁律推论:**文档不该存易变状态;易变状态去查源头。**
- 进度真相 = **git / 代码 / 测试**,不是文档。
- "完成度"靠**跑验证**确认(typecheck/vitest/真机),不靠文档声明。
- 文档**引用**源头(commit hash / 测试),**不复制**状态。

## 二、文档分级(每份文档 frontmatter 标 `freshness`)

| 级别 | 是什么 | 过时风险 | 处理 |
|---|---|---|---|
| **stable** | 架构原则/决策/哲学(ADR、master-plan 远景、本文)| 低 | 变了走 ADR amend;无需定时 review |
| **living** | 会随开发演进(GOAL 进度、能力市场方案)| **高** | 必须 `review_by` 定时核;进度引用 git 不复制 |
| **snapshot** | 某时点研究报告(research-protocol-2026、deep-research 产出)| **必然** | 标 `as_of` 日期,**默认会过时不假装更新**;用前核实,需要时重跑研究 |

## 三、保鲜元数据(living / snapshot 文档 frontmatter 必填)

```yaml
freshness: living | stable | snapshot
review_by: 2026-09-22        # 下次该检查的日期(living/snapshot)
verify_against: "git log / 跑 smart-table vitest / 真机 :17873"  # 怎么核实真伪
as_of: 2026-06-22            # snapshot 专用:这是哪天的事实
superseded_by: "[[xxx]]"      # 被取代时填,不删原文(留轨迹)
```

## 四、检查机制(三道闸,不靠记忆靠流程)

1. **开工前核实**(dev-playbook 铁律,最重要):动手前先 `git status` / `grep` / 跑测试核实真实状态,**永远不信文档的进度记录**。这道闸就能挡住本 session 那种误导。
2. **定时 review**(治本):用 `/schedule` 设周期性 cloud agent(建议**每 2 周**),对 living 文档逐一核对——GOAL 进度对不对得上 git?research 的 2026 事实还成立吗?过 `review_by` 的标记或更新。
3. **触发式 review**:阶段切换 / 重大 commit / `/goal done` 时,顺手 review 相关 living 文档。

## 五、过时处理动作(发现过时怎么办)

- **进度过时**(如 GOAL):append 进展日志写真实状态(以 log 末尾为准),不改历史。
- **决策过时**(如 ADR):走 amend(bump version + changelog),不删。
- **研究过时**(snapshot):标 `as_of` 已旧;需要时重跑 deep-research,旧的留作轨迹。
- **被取代**:原文加 `superseded_by`,不删(审计轨迹)。

## 六、立刻落地(给本 session 文档分级)

| 文档 | freshness | review_by |
|---|---|---|
| ADR-010 / master-plan(远景部分)/ dev-playbook / 本文 | stable | — |
| **GOAL.md** | **living** | 每 2 周(进度最易过时)|
| mcp-capability-marketplace(方案)| living | 2026-09 |
| research-protocol-2026 / protocol-opensource-strategy / protocol-research-summary | **snapshot** | as_of 2026-06-22,用前核实 |

**下一步**:① 给上述 living/snapshot 文档补 frontmatter 的 `freshness`/`review_by`/`verify_against`(轻量,逐个或批量)② 用 `/schedule` 设每 2 周的文档保鲜 review routine。
