---
title: CTRL 高效开发 Playbook — 怎么用好工具/subagents 达成目标
kind: playbook
status: living
created_at: 2026-06-22
owner: bao
author: zeus
trigger: 本 session 零代码、一整轮研究旁支盖过主目标后,bao 问「开发模式是不是不对」
related:
  - "[[GOAL]]"
  - "[[master-plan]]"
  - "[[feedback-anchor-before-expensive-research]]"
---

# CTRL 高效开发 Playbook

> bao 2026-06-22:「这次零代码,开发模式是不是不对?研究一下最好的开发模式、最佳实践,用好我们最好的工具/subagents,最高效达成目标。」

## 一、诚实诊断:这次零代码的根因

**不是目标设错** —— GOAL.md 的 SC8(§14 接前端)是清晰、小、可验证的好目标。
**根因 = 单一 agent 无阶段边界 + 执行漂移**(2026 最佳实践印证:monolithic agent 的经典陷阱):
1. 我(单主 agent)把 研究/规划/决策 全揽,**没有「研究阶段 → 实施阶段」的硬边界** → 研究无限延伸,从不切到实施。
2. 一连串「继续」我没每步锚 GOAL,**研究边际收益递减还继续**。
3. 强力工具(Workflow/deep-research/subagents)**全用在研究、零用在实施** —— 资源错配。

结论:研究本身有价值(澄清架构 + 否定开源弯路),但**比例 100:0 + 没有阶段切换信号** = 病。CTRL **不缺工具/方法,缺阶段纪律**。

## 二、高效开发模式(7 条,CTRL 已有工具 + 2026 最佳实践 + 本次教训)

1. **目标锚定**(goal skill):每个非平凡工作先一句话「服务 GOAL 哪个目标」;不服务先问。研究/旁支必须有**预算 + 出口**(产出决策/spec 就停)。
2. **阶段硬边界**(★治本次的病):**研究/设计 → 实施 → 验证 三阶段不混**。研究阶段有明确出口(出 spec/决策即止,不无限延伸)。2026 最佳实践:别让一个 agent 同时 analyze/plan/build/validate,会 paralysis。
3. **spec-driven**:目标切成小而可验证的 spec(executable artifact)。SC8 先切 spec,再动手。
4. **subagent 并行实施**(★把多 agent 用在写代码,不只研究):像轨1 那样——独立切片派 specialist subagent **并行实施**,fresh context(clean 胜过 accumulated),parent 只编排。CTRL 已验证过(轨1 的 4 项并行做)。
5. **独立验证**(code-reviewer subagent):每个实施切片后,独立 CHECK subagent 验证(catch builder misses)——dev-loop 第 6 步。
6. **dev-loop 节奏**:三层验证(compile + kernel smoke + 视觉/单测)+ 独立 checker + commit,小步累积。
7. **防漂移纪律**:研究边际递减就停;连续「继续」时主动报「这是研究还是实施」;Workflow/deep-research 设 token 预算,别耗尽 session。

## 三、资源地图(用好我们最好的工具/subagents)

| 资源 | 用在哪 | 这次的教训 |
|---|---|---|
| **goal skill** | 锚定 + 防漂移 | 跳过了,导致漂移 |
| **dev-loop skill** | 实施节奏(三层验证)| 整个 session 没进入 |
| **code-reviewer subagent** | CHECK 阶段独立验证 | 只在研究里用过 |
| **并行 subagents** | **并行实施独立切片**(不只研究)| 全用在研究 |
| **Workflow** | 多阶段确定性编排(实施 pipeline 也行)| 全用在 deep-research |
| **deep-research** | 限量、锚定、有出口的外部调研 | 跑了 4 个,耗尽 session |
| impeccable/critique/verify | 前端质量/视觉验证 | 没用到(因为没写前端)|

**核心升级**:把 Workflow/subagent 的并行编排能力**用在实施**——多个独立切片(如 SC8 的 filter/sort/group UI、describe 字段、AI 列)可并行派 subagent 做,而不是串行手写,也不是只拿来研究。

## 四、立刻应用到 SC8(让 playbook 不空谈)

下个 session 开 SC8,按这个模式:
1. **锚定**:goal skill 确认 SC8 是活跃目标。
2. **切 spec**(研究/设计阶段,有出口):SC8 = 前端消费 §14 query gate,切成 3 个独立切片——① filter/sort/group UI ② describe 驱动的字段/算子渲染 ③ AI 列(start→poll→展示)。出 spec 即止,不再研究。
3. **并行实施**(实施阶段):3 切片派 3 个 specialist subagent 并行做(fresh context,各给对应 spec),parent 编排。
4. **独立验证**(验证阶段):每切片 code-reviewer + tsc/vitest + `/table-lab` 视觉验证。
5. **dev-loop commit**:绿了 commit,累积到 `feat/smart-table-grist-parity`。

## 五、一句话

**目标没错,工具齐全,缺的是「研究有出口、实施有并行、阶段有边界」的纪律。** 最好的开发模式第一条恰恰是:**别用研究代替做** —— 验证这条的方式,就是下个动作真的回 SC8 写代码。
