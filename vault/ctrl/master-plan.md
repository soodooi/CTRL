---
title: CTRL Master Plan — 远景 · 市场 · 目标分层 · 全局把控(2026-06-22)
kind: master-plan
status: living
created_at: 2026-06-22
owner: bao
author: zeus
purpose: 把控全局的单一真相源——把本 session 的研究(协议/开源/能力市场/竞品)与产品主目标整合成一张分层规划图,指导接下来的开发。GOAL.md 是「当前活跃目标」,本文是「全局地图」。
related:
  - "[[GOAL]]"
  - 010-communication.md
  - "[[protocol-research-summary]]"
  - "[[mcp-capability-marketplace]]"
  - "[[protocol-opensource-strategy]]"
---

# CTRL Master Plan

> bao 2026-06-22:「结合研究,重新规划目标、竞品、远景、市场,做全面总结,规划接下来如何把控全局。」
> 用法:**GOAL.md = 当前唯一活跃目标(可验证、小);本文 = 全局地图(远景 + 分层路线)。** 每次开工锚 GOAL.md,迷失时回本文看自己在哪一层。

## 一、远景(CTRL 是什么)

**CTRL = 普通用户的 local-first 通用 AI 平台。** 按 `Ctrl` 唤起 → 意图 → 浮现 1-3 个能力模块;能力 = 可安装插件(每个 = 一个 MCP server),第三方可造可分享(share-and-be-shared)。
- **商业**:卖 substrate + 平台 + 能力市场,**不卖模型**。
- **护城河**:**产品**(把碎片整合成普通人能用的平台)+ **数据主权**(本地是 truth)+ **gate 治理**(安全可信)。**不是协议**(§14 不开源,见研究结论)。

## 二、市场与竞品定位(本 session 研究提炼)

| 赛道 | 代表 | 形态 | 服务谁 |
|---|---|---|---|
| coding agent + MCP | Claude Code / Cursor / Cline | marketplace + one-click MCP | **开发者** |
| PKM / local-first | Obsidian(+MCP 插件)/ Tana / AnyType | 笔记 + AI | 单点(知识管理)|
| 语义层 / 数据 | Cube / OSI / Apollo(GraphQL+MCP)| 企业数据 + agent | **企业/开发者** |
| launcher | Raycast | 快捷启动 + AI | 偏开发者 |
| agent 协议 | MCP(标准)/ ACP / AG-UI / A2A | 互操作协议(互补分层)| 平台/开发者 |

**CTRL 的真空位**:以上要么开发者向(Cursor/Cline/Apollo),要么单点(Obsidian PKM)——**没有一个把 MCP 生态(工具/能力)整合成「普通用户」的 local-first 通用平台 + one-click 能力市场 + gate 安全治理**。这就是 CTRL 占的位,**在产品层,不在协议层**。

## 三、战略结论(本 session 研究的净提炼,锁定)

1. **通讯架构 = 统一窄腰(§14 契约 + gate 治理 + MCP 插件)+ 多元传输**(ADR-010)。不追求"一个框架统吃"。
2. **§14 不开源成标准**——想占的层已被 MCP+GraphQL+Cube+Obsidian-MCP 生态填满;**§14 留内部,做 MCP 生态最佳 local-first 公民**(protocol-opensource-strategy)。
3. **CTRL 天生握 MCP 安全核心牌**:gate=gateway defense、keychain=凭证、§14 produce gate=写审批、local-first=减泄露;能力市场只需补 4 块(扫描/hash-pin/验签/沙箱)。
4. **普通用户 ≠ 编辑 JSON**:能力接入要 Cursor/Cline 式 one-click + CTRL gate 自动安全,这是与开发者工具的分水岭。

## 四、目标分层(重新规划——主目标不膨胀,只放进大图)

| 层 | 目标 | 状态 | 验证 |
|---|---|---|---|
| **近期(当前活跃)** | §14 + 智能表格 + 接 PWA 前端(SC8)| **GOAL.md ACTIVE,不变** | 用户能在前端用 §14 query/produce 操作智能表格 |
| **中期** | 能力市场 + gate 治理(MCP 接入:发现/安全/生命周期)| 方案就绪(mcp-capability-marketplace 7 切片 + 4 gate 决策)| 普通用户 one-click 装第三方能力,经 gate 安全运行 |
| **远景** | 普通用户通用 AI 平台 + 能力生态(share-and-be-shared)| 远景 | 第三方造能力、用户装能力,CTRL 是 substrate |

> **原则(GOAL.md 哲学)**:一次只一个活跃目标。**智能表格 = 第一个能力模块 beachhead**(不是"做表格",是"用表格验证 §14+gate+前端这条产品链")。中/远是路线,不是当前目标——不抢 SC8。

## 五、全局路线图(把控全局的顺序)

```
近期 ── SC8:§14 接前端(智能表格可用)         ← 现在做
   │     + 轨1 Grist parity / 轨2 关系型索引
   ▼
中期 ── 能力市场切片 0-6(mcp-capability-marketplace):
   │     0 manifest+发现 → 1 扫描验签 → 2 hash-pin 防 rug-pull
   │     → 3 凭证/scope → 4 produce 审批 → 5 沙箱 → 6 市场 UI
   │     (开工前先拍 4 个 gate 决策,写 ADR-006 §4 实装)
   ▼
远景 ── 能力生态 + share-and-be-shared(第三方造/用户装)
```

## 六、把控全局的开发纪律

1. **锚定**:每个非平凡工作先说"服务 GOAL.md 哪个目标";不服务先问 bao(memory `feedback-anchor-before-expensive-research`)。
2. **节奏**:走 `dev-loop`(三层验证 + 独立 checker),绿了 commit,小步累积。
3. **不漂移**:研究/旁支必须明示"服务哪层 + 排序";研究边际收益递减就收敛。
4. **ADR 治理**:战略改动走 8 module ADR(section amend,不 churn);plain-text/vim-test/spine 5 primitive/keychain 不动。
5. **本地是 truth**:所有功能守 local-first;收敛不推倒(134 Tauri + 58 MCP 在用)。

## 七、文档地图(本 session 研究产出导航)

| 文档 | 角色 |
|---|---|
| **master-plan.md**(本文)| 全局地图(远景/市场/分层/路线)|
| GOAL.md | 当前活跃目标(SC8)|
| ADR-010 communication | 通讯总纲(权威)|
| protocol-research-summary.md | 协议研究单一入口 |
| research-protocol-2026.md | 协议选型事实 |
| protocol-opensource-strategy.md | 开源否定结论 |
| mcp-capability-marketplace.md | 能力市场架构 + 7 切片 + 4 gate 决策 |

## 八、目标调整结论

**主目标(SC8 + 智能表格)不调整** —— 它是正确的近期 beachhead。调整的是**视角**:它现在被明确放进"普通用户通用平台"的分层大图,知道自己是第一个能力模块、后面是能力市场。**全局有图、当前有锚、研究有结论、路线有序。接下来:回 SC8 开发。**
