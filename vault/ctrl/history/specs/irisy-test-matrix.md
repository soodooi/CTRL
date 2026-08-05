# Irisy 测试矩阵 (test capability SSOT)

> 我(Claude)承担 **测试能力**;Irisy 功能由**别人开发**。本文件 = 「Irisy 该做成什么」→「怎么验证它做对了」的真相源。
> 测试 = 验证 Irisy 符合规格。未实装的能力 **不由我实装**,而是写成规格化 pending/blocked 测试(红灯,待开发者点绿)。
> 真相源派生自:ADR-005(governing)+ ADR-008(retired,voice/acceptance 来源)+ PRODUCT.md + `vault/ctrl/history/brainstorm/irisy-*` + `capability-catalog.ts` + `irisy-prompts.ts` v10。

## Irisy 要做成什么 —— 三层时代(测当前层,别测退役层)

| 时代 | Irisy = | 状态 | 含 |
|---|---|---|---|
| Era 1 | **大脑 / agent**(Pi 驱动) | **退役** | ADR-008 全部、ADR-005 §5/§6/§7、irisy-pipeline/capabilities/reply-specs brainstorm |
| Era 2 | **PWA persona shell**(人设 + 提示注入 + sycophancy 过滤 + drill-down),脑=外部 agent | 当前设计 | ADR-005 v5 |
| Era 3 | **当前代码真相** | 跑着的东西 | Pi 删了、Hermes 未接线;`IrisyChat` 直接把单体 v10 prompt 走 provider router |

**最大 gap(测试矩阵的核心约束)**:Era 3 = persona prompt + render filter + SOUL.md + 部分 reflection,**没有接线的 brain**(Pi 删除、Hermes reserved-unwired)。→ 一切「工具执行 / agent loop」行为(C1–C7、capability decomposition、reflect subagent)**没有脑去跑**,断言它们的测试必须标 **blocked-on-Hermes**,不是 prompt 写错。

## 当前真实通道 → 测试状态

| 通道 | 职责 | 实装 | 我的测试 |
|---|---|---|---|
| Provider 路由(P1) | 路由到 active provider + failover + cooldown | ✅ | ✅ SC5(路由身份)+ SC6(failover/cooldown 状态机) |
| 提示组装(P3) | base persona + SOUL.md + mcps 注入 | ✅(顺序≠ADR-005 §6.4,brain_state 已 drop) | ✅ SC2 |
| SOUL.md 记忆(P6) | 每轮 core-memory 注入 + read/write | ✅ | ✅ SC10(write 闭环 round-trip) |
| Reflect 循环(P5) | detect 信号 + reflect + playbook | 🟡 部分(只 detect 2 信号,无 playbook 整合) | ✅ SC7(detect)+ pending(playbook F15/F18) |
| 会话历史(P9) | hermes JSONL 投影到 history drawer | ✅ | ✅ SC8 |
| Render 过滤(P10) | 剥 scaffold/thinking/narration/codename | ✅ | ✅ SC3 |
| **Brain(Hermes)** | agent loop / 工具执行 | ⛔ **零(未接线)** | blocked-on-Hermes |
| Capability 选择(P7) | pickCapabilitySegments 按关键词注入 | ⛔ 零(Pi hook 没了) | 规格 pending(F6–F12) |
| Drill-down | 长按看 filter 前 raw | ❓ 未验证 | pending(F25,需先确认) |
| Coding face | opencode in /coding | 🟡 部分(独立 transport) | pending(F30) |

## 回复正确性契约 = 测试中心(bao 钦定)

两层执行 → 两类测试:
1. **确定性层(render filter `cleanReplyText`)** → **unit 测试**(已建,确定性,无需 LLM):scaffold/thinking/narration 剥离、codename→品牌标签改写。✅ SC3。
2. **prompt-only 层(voice rules + 6 guardrails)** → **golden-transcript 测试**(给定输入,断言回复满足约束;需 mock provider 或 fixture 回复)。**尚未建** —— 这是测试能力的下一块空白,最贴合「回复对不对」:
   - voice:≤4 行 / 无 preamble(`!/^(Sure|Of course|...)/`)/ 无 codename 泄漏 / 无 planner scaffold / 无 help-trailer / 匹配用户语言
   - guardrails E1–E6(已有 golden pairs `irisy-prompts.ts:172-200`):iCloud 推回 / Notion 锁定推回 / calibrated uncertainty / correct-no-apology / 无内部名泄漏 / 无 trailer
   - SC4 已断言「这些规则**在 prompt 里**」;golden 测试验证「模型**真的照做**」(留 e2e/fixture)

## 验收矩阵(F1–F30 摘要,详见 agent 调研)

测试类型:U=unit / I=integration / E=e2e / G=golden-transcript。状态:✅已测 / 🟡待建 / ⛔blocked-未实装。

| 类 | 验收点 | 状态 | 测试 |
|---|---|---|---|
| **回复契约** | render filter 剥 scaffold/thinking/narration(F2)、codename 改写(F3) | ✅ | U(SC3) |
| | voice rules 在 prompt(F1 部分) | ✅ | U(SC4) |
| | voice 真实遵守 ≤4 行/无 preamble(F1)、guardrails E1–E6(F4/F5/F13) | 🟡 | **G 待建** |
| | per-intent reply specs ~24(F27) | 🟡 | G 待建 |
| **已实装通道** | provider failover/cooldown(D) | ✅ | U(SC5/SC6) |
| | SOUL.md round-trip(F26 部分) | ✅ | U(SC10) |
| | detect rules(F14 部分) | ✅ | U(SC7) |
| | floorCapabilities 只返回 zeroInstall+排序(F28) | 🟡 | **U 待建** |
| | capability 卡片渲染(F29) | 🟡 | E 待建 |
| **未实装(规格 pending)** | IRISY_BASE_PERSONA 提取 + 删单体(F6) | ⛔ | U pending |
| | 8 capability segments + pickCapabilitySegments(F7/F8) | ⛔ | U pending |
| | buildSystemPrompt 顺序(F9) | 🟡 | U |
| | C1–C3 工具路由(F10/F11/F12) | ⛔ blocked-on-Hermes | E pending |
| | reflect playbook 整合/audit/metrics(F15/F18/F19/F20) | ⛔ | U/I pending |
| | 5-min UX 7-step E2E(F24) | 🟡 | E 待建 |
| | drill-down raw 视图(F25) | ❓ | E(先确认) |

## 测试能力三类策略(我做什么 vs 别人做什么)

1. **已实装通道 → 我建真测试,守住不回归。** (SC1–8/SC10 已覆盖大部分;待补 F28 capability-catalog、golden voice 测试。)
2. **prompt-only 回复契约 → 我建 golden-transcript 测试。** 这是「回复对不对」最直接的验证,当前空白,优先级最高。
3. **未实装能力 → 我建规格化 pending/blocked 测试(红灯),定义"正确长什么样",标 blocked-on-Hermes/待开发。别人实装后点绿。** 不由我实装功能。

## 待 bao 确认的漂移(测试矩阵依赖这些定论)

- **Hermes 接线** = 最大 gap;C1–C7/reflect-subagent/coding 的工具行为测试全 blocked 在此。
- **ADR-005 §6/§7(capability decomposition + pi-extension)** Pi 退役后失效,需 amend 标 superseded(否则 F6–F12 验收点悬空)。
- **opencode vs hermes 不一致**:v10 prompt + catalog 说 coding face=opencode,former `CLAUDE.md` 说 Irisy brain=hermes、opencode unwired。需钉死 running build 到底调谁(值得一个 pin-down 测试)。
