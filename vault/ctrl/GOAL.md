# CTRL — 当前开发目标 (single active goal)

> 唯一在跑的目标,锚定所有工作。由 `goal` skill 管理。
> Plain markdown,local 是 truth,bao 拥有这个文件。

## Status: ACTIVE

## 目标 (Goal)

**为 Irisy 建立「回复正确性」的全通道闭环验证。**

bao 钦定重点(2026-06-19):测试中心 = **Irisy 的回复到底对不对**(行为/语义正确,不只是函数返回值)+ **全部运行通道都接通成最小闭环再测,不跳过**。

governing ADR = **ADR-005 irisy v5**(ADR-008 已退役,仅留 §8 acceptance 措辞作回复约束的来源)。
现状(探查实测 2026-06-19):Irisy 端到端 ~10 条运行通道,**测试覆盖 0%**;PWA(`ctrl-web`)**无 vitest**(`ctrl-stss`/`ctrl-memory` 已有可照抄);kernel 39 个 Rust 测试无一条 Irisy 专属;仅 1 个 Playwright e2e 测网格布局不碰 chat。

通道矩阵(每条:接通闭环 + 自动化测回复正确):

| 通道 | 含义 | 实装现状 | 代码入口 |
|---|---|---|---|
| P1 | Chat→Provider 路由 | 已实装 ~75% | `src-tauri/src/commands/irisy_chat.rs` + `kernel/provider/routing.rs` |
| P2 | Chat→Hermes(:17873 gate) | **门控关闭**(2026-06-12,等 ACP) | `irisy_chat.rs` mode 分支 + hermes `:17890` |
| P3 | 系统提示组装(persona v10 + brain_state + SOUL.md) | 已实装 ~90% | `ctrl-web/src/lib/irisy-prompts.ts` |
| P4 | brain_status 回读 | 已实装 ~80% | `src-tauri/src/commands/provider.rs` |
| P5 | reflect 触发检测 | detect 已实装,reflect/improve deferred | `ctrl-web/src/lib/irisy-reflection.ts` |
| P6 | SOUL.md 读写 | **仅 read,write 未实装** | `irisy-prompts.ts` loadSoul + kernel cmd |
| P7 | Capability Floor(C1–C8 选择) | **零实装** | `irisy-prompts.ts`(常数存根) |
| P9 | hermes 会话历史 | 已实装 ~70% | `src-tauri/src/commands/hermes_acp.rs` |
| P10 | 渲染过滤(剥 codename/sycophancy/planner blocks) | 已实装 ~90% | `ctrl-web/src/lib/irisy-render-filter.ts` |

## 成功标准 (Success criteria — 可验证)

**基础设施**
1. `ctrl-web` 有 `vitest.config.ts`,`npm run test -w @ctrl/web` 绿(目前 PWA 无单测框架)。

**回复正确性核心(bao 钦定重点 — 「回复对不对」)**
2. (P3) 测试验证系统提示组装正确:persona v10 base + `<brain_state>` 注入 + `SOUL.md` body 注入到位,`PROMPT_VERSION === 10`。
3. (P10) 给定含 codename(`Pi`)、sycophancy(`Sure!`/`当然`)、planner blocks(Goal/Progress/Done/Next Steps)、thinking 的原始回复,`cleanReplyText()` 后这些**全部被剥离**(ADR-008 §7 行56 + ADR-005)。
4. (persona voice,ADR-005 §1 / ADR-008 §8 行191)对「你好」「你是谁」「你能做什么」「你用什么模型」四问,Irisy 最终回复 **≤4 行、无 preamble、无 codename 泄漏、无 planner blocks** —— 用 fixture/mock provider 跑通,断言输出约束。**这是「回复是否正确」最直接的自动化测试。**

**各通道闭环 + 测(已实装)**
5. (P1) `cargo test` 验证 `IrisyPrimary`/`IrisyFallback` 路由解析 + 首-chunk failover + cooldown(`routing.rs`)。
6. (P4) `cargo test` 验证 `BrainStatusView` 形状 + `providers[irisy.primary/fallback]` + failover 记录。
7. (P5) vitest 验证 `detectReflectTrigger` / `isCorrectionMessage` 对中英文纠正标记 + tool 失败的识别。
8. (P9) 验证 `irisy_session_list` 对 hermes `sessions export` JSONL 的解析(fixture)。

**全通道闭环不跳过(bao 钦定 — 未实装的先接通再测)**
9. (P2) 把门控的 Chat→Hermes 路径接通成**最小可测闭环**(mock hermes MCP 端点经 `:17873` gate 收发回流),测路由分支选择正确。⚠ 是否解除 2026-06-12 门控待 bao 在该步确认。
10. (P6) 实装 `irisy_soul_write` / `soul_set`(目前仅 read),闭环 read→write→read 测 + 首启种子。
11. (P7) 实装 `pickCapabilitySegments()` 关键词选择(C1–C8),测中英文触发词命中正确 capability 段。

**端到端 + 验证闸**
12. (e2e,ADR-005 §6 / ADR-008 §P5 行184)Playwright 跑 first-5-min 7-step,真实 UI→gate→provider 回复满足 persona 约束;且 streaming 期间 textarea 不阻塞(吸收原目标)。
13. 全套 `npm run test` + `cargo test` 绿;dev-loop 三层验证(compile + kernel smoke + visual)过;独立 `code-reviewer` checker 判 PASS。

## 非目标 / 范围外 (Non-goals)

- 不打真实第三方 provider API —— 全部 mock / fixture(BYOK 各家不真连)。
- 不重构 Irisy 架构,不动 ADR-005 persona-shell v5 既定的 interrupt-and-redirect 设计。
- 不做复杂 NLP 分类器 —— Capability 选择(P7)用关键词表,不上模型。
- 原目标「流式不阻塞输入 + trivial-chat 提速」不另立主线 —— 不阻塞行为归入 SC12 e2e 顺带验证;提速若不属回复正确性则不在本目标。

## 进展日志 (Progress log — append-only)

- 2026-06-19 目标替换。原目标(流式不阻塞 + 提速,未推进)被吸收进本目标 P1 通道 + SC12 e2e。bao 两个钦定:① 测试中心 = 回复是否正确;② 全通道闭环不跳过(P2 门控 / P6 soul write / P7 capability floor 都要接通)。探查报告:10 通道现 0% 覆盖,PWA 无 vitest,kernel 无 Irisy 专属测试,governing=ADR-005。下一步(dev-loop step 1)= SC1+SC2+SC3+SC4。
- 2026-06-19 **step 1 完成 + commit `10adda0`**(SC1–4 ✓)。给 ctrl-web 接入 vitest@2(原 PWA 无单测框架),24 测试绿(render-filter 9 + prompts 15)+ typecheck 绿。覆盖:P10 `cleanReplyText` 各 strip pass + codename 改写;P3 `PROMPT_VERSION` pin / `formatBrainStateBlock` / `loadIrisySystemPromptWithSoul` SOUL.md 注入(mock bridge+tauri);SC4 `IRISY_SYSTEM_DEFAULT` 禁 sycophancy/planner/内部名泄漏 + 强制简短。独立 checker(code-reviewer)判 vitest 工作真实有效、断言对齐实现、全英文无 secret;其 FAIL 仅因工作树含**遗留 SC12 红色 e2e 半成品**(`bridge.ts`/`llm-transport.ts` mock seam + `e2e/irisy-streaming.spec.ts`,上个目标遗留)→ 已用精确 `git add` 只提交绿色文件解决,遗留留树待 SC12 接手。**下一步候选 = SC5**(P1 Chat→Provider `cargo test`,kernel 层,无歧义不碰未实装)。
- 2026-06-19 **SC5 第一刀**:`trait.rs` +6 路由身份契约测试(`Consumer`/`Capability` round-trip + 未知 id→`Custom` 不 panic + `RouteChain::default` 未配置),`cargo test` 11 绿(含既有)。P1「消息路由到正确的脑」身份层已测。**SC5 续刀** = `route_text_chat` failover/cooldown 集成测试(需 fake Provider + registry 注入设施)。bao 流程纠正:别在里程碑停下做选择题,连续推进(SC5+SC12 都做),仅 P2 门控(SC9)需拍板。

## Git — branch `ui/v1-editorial`

(clean)
