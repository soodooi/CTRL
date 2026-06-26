# Irisy 角色系统 — 设计真相源 (design SSOT)

> bao 钦定理念 (2026-06-25): **每个功能 = 角色 + 功能包**。
> 本文是「Irisy 角色系统」的统管全局规划图,先于实施 (系统设计先行)。
> 影响 ADR-005 (irisy) + ADR-007 (workbench);确认后 amend ADR + 走 dev-loop。

## Status: DRAFT (待 bao 过)

---

## 一、核心公理 (bao 校准 2026-06-25: 灵活配置,不焊死)

**persona 与 功能包是两类可独立配置的组件;一个 L1 (功能模块) 配置「绑哪个 persona + 挂哪些功能包」,灵活可改 —— 不是焊死的单元。**

> ✗ 错 (我之前): 把 persona + 功能包焊成一个不可分单元。
> ✓ 对 (bao): persona / 功能包 **解耦**,各自是可选项池;L1 用**配置**把它们组合起来,换 persona、加功能包都不动代码。

- **persona 池** = 可选身份/声音 (default / code-companion / mcp-creator / KB / …),独立维护
- **功能包池** = 可选工具集 (coding 终端 / notes+vault / mcp 建包 / …),独立维护
- **L1 配置** = 每个 L1 声明「用哪个 persona + 挂哪些功能包」,可换、可叠、可调

| 组件 | 现有实装 | 在模型里 |
|---|---|---|
| persona 池 | `lib/irisy-prompts.ts` + `personas/irisy/*` | 可配置选项 |
| 功能包池 | `lib/feature-pack.ts` + 已装 MCP actions | 可配置选项 |
| L1 → (persona, 功能包) 配置 | (新) 每个 L1 一份声明式配置 | **绑定层 = 灵活配置** |

## 二、L1 与角色的关系 (bao 校准: L1 ≠ 角色, 但每个 L1 配置了 persona + 功能包)

- **L1 (左侧 sidebar)** = **功能模块** = 数据/workspace **+** 一份「persona + 功能包」配置 (notes / tables / coding / …)。
- **角色** = 一个 L1 当前配的 **persona** (= "Irisy 以谁的身份帮我"),显示 + 切换在**对话框上方**。

「L1 ≠ 角色」的意思:L1 比角色**大** —— L1 还含数据视图/workspace;角色只是 L1 的「以谁身份」配置面。不能把两者划等号,但**每个 L1 确实对应 (配置了) 一个 persona + 一组功能包**,两句不矛盾。

配置灵活、非 1:1 焊死:有些 L1 不挂角色 (discover/settings = 纯导航);同一 persona / 功能包可**跨 L1 复用**。

## 三、对话框上方的角色切换器 (UI)

```
┌──────────────────────────────────────────┐
│ ● 助理 ▾                        ⟳ 历史    │ ← 角色切换器 (对话框上方)
├──────────────────────────────────────────┤
│  [助理 ▾] 展开 = 功能/角色注册表:          │
│   ● 助理       通用 · Hermes 脑           │
│   ◦ 编程伴侣   code-companion + 终端包     │
│   ◦ 知识库     KB persona + notes/vault 包 │
│   ◦ 工具创作   mcp-creator + 建包          │
│   ＋ 新建角色  (persona + 功能包自由组合)  │
│                                            │
│   (对话区 — 切角色时这条对话不断 = 持续化) │
├──────────────────────────────────────────┤
│ 问 Irisy…                            [↑]  │
└──────────────────────────────────────────┘
```

- 切角色 = 换 Irisy 的 persona + 可见功能包,**对话流不重置** (持续化)。
- "＋ 新建角色" = 注册表式扩展 (沿用 mcp-creator 的造包能力,但造的是"角色"= persona+功能包)。

## 四、对话持续化 (continuity)

切角色不是开新会话。同一条对话流里:
- 切到"编程伴侣" → Irisy 换 code-companion persona + 终端功能包,但**记得前面聊的**。
- 实现要点: persona/功能包是**每轮可变的上下文**,会话历史 (hermes session) 不随角色切换重置。

## 五、与现有实装的收敛 (复用,不重造)

**角色 = persona 那一层** (bao 2026-06-25「助理角色不够?」校准):只有 3 个 persona 角色 (助理 / 编程伴侣 / 工具创作),默认 = 个人知识库助理。**功能包 + 专属知识库是正交配置,不构成新角色。**

| 角色 (初始集) | 复用的 persona | 复用的功能包 | 知识库 (数据) | 状态 |
|---|---|---|---|---|
| **个人知识库助理 (默认)** | (KB persona,待写) | notes + vault + 语义检索 | 用户 vault | 模块 ✅ / persona 待写 |
| 编程伴侣 | `personas/irisy/code-companion.ts` | coding (终端/PTY) | 代码库 | persona ✅ / 功能包待绑 |
| 工具创作 | `personas/irisy/mcp-creator.ts` | mcp 建包 | — | persona ✅ |

**关键澄清 (bao 2026-06-25「助理角色不够?」「助理角色 + 专属知识库 + 功能包,是这样」)**:**股票不是新角色**。股票 = **助理角色 (KB persona) + 专属知识库 (Stocks/) + 功能包 (ghostfolio)** 的配置组合 —— persona 仍是助理,只是挂了专属知识库 + 功能包。同 persona 绝不另立角色 (否则又焊死,违反 §一「灵活配置」)。功能包 + 知识库是助理可组合的**正交维度**,不构成角色。曾误加 `stocks` 角色 (2026-06-25),已撤回 —— 这是第二次「焊死角色」反例 (第一次「为什么焊成一个单元」),教训:**新增功能优先想「助理 + 配置」,不要新建 persona 角色。**

底层机制都在:persona 注入 (`lib/irisy-prompts.ts`)、功能包加载 (`lib/feature-pack.ts`)、能力注册表 (`lib/capability-catalog.ts`)、scene 形变 (`AmbientHome.tsx`)。**角色系统 = 把这些组合成"角色"切面 (persona + 功能包 + 知识库) + 加对话框上方切换器**,不是从零造。

## 六、ADR 影响 (确认后 amend)

1. **ADR-005 `decision_one_persona_irisy`** — 现锁"单一对外人格,从不切换"。需 **amend 措辞**:区分「单一**声音/品牌**」(仍是 Irisy,不分裂成 Janus/Talos 多重人格) vs 「多**功能角色**」(persona+功能包按功能切换)。角色切换 ≠ 人格分裂 —— Irisy 始终是 Irisy,只是换工作身份。
2. **ADR-007 workbench** — 加「对话框上方角色切换器」+ 角色 ⊥ L1 的双维度信息架构。

## 七、已决 (bao 拍板 2026-06-25)

1. **L1 ↔ 角色联动 = 是 (联动 + 可手动切)。** 切 L1 时角色随之联动;Irisy 输入框上方有**现行角色指示**,也可**手动切换**;**Irisy 对话不随角色切换而变化** (对话持续化,= §四)。
2. **默认角色 = 个人知识库助理。** 初始集 = 个人知识库助理 (默认) + 编程伴侣 + 工具创作。知识库角色按「功能包 + 对应知识库」派生 (例:股票角色 = 股票功能包 + 股票知识库),见 §五派生模式。
3. **"新建角色" v1 不做。** v1 先固定初始集;注册表机制**留接口**,后续再开用户自建。

---

## 进展日志

- 2026-06-25 建档。bao 理念「每个功能 = 角色 + 功能包」+ 「L1 ≠ 角色,角色在对话框上方」+ 「persona+功能包,灵活切换,对话持续化」。
- 2026-06-25 bao 拍板 §七 3 问 (L1 联动 + 输入框上方指示/手动切 + 对话不变 / 默认个人知识库助理 + 按功能包+知识库派生 / v1 不新建角色)。→ amend ADR-005 v6 + ADR-003 v22 §8.6 → dev-loop 实施对话框上方角色切换器。
- 2026-06-25 实装 (单人快速开发, 直接 main, `lib/roles.ts` + 21 单元测试):
  - 切换器 (对话框上方) + persona 切换 + L1↔角色联动 + 对话持续 (slice 1)
  - **toolset**: `packsForRole` 过滤角色可见功能包 (system prompt + L1 rail); code-companion 配 dev 白名单
  - **功能包→角色**: `roleForPack` —— 点开某功能包切到能用它的角色 (bao 点①)
  - **kbScope 数据相对独立** (bao 点②): `inKbScope` 真过滤检索 (`askKnowledgeBase` 搜宽后丢范围外命中); null=全 vault, 非空=只该 prefix
  - ~~首个数据角色 Stocks~~ (撤回,见下)
- 2026-06-25 **gate tools 让 Irisy 装+用功能包** (bao「Irisy 要会安装、使用功能包」): `mcp_server.rs` 加 `mcp_pack_list/install/run` 3 个 gate #[tool] (复用 `list_installed_in/install_into/run_action_blocking`,gate-only 不触发 ratchet);`irisy_chat.rs` routing 加功能包意图关键词→hermes。功能包不再跟 brain 割裂。cargo test 270。
- 2026-06-25 **撤 `stocks` 角色** (bao「还有 stocks 角色?助理角色不够?」「助理角色 + 专属知识库 + 功能包,是这样」): stocks 的 persona 就是助理 KB,我把 persona+功能包+知识库又焊成角色了 (第二次焊死反例)。**角色 = persona 层 (助理/编程/工具创作 3 个);股票 = 助理 + 专属知识库 (Stocks/) + 功能包 (ghostfolio) 的配置,不是新角色。** `roles.ts` 删 STOCKS;`roleForPack('ghostfolio')→kb-assistant`;21 单元测试绿。**待定:专属知识库怎么绑** (绑功能包 / 场景 / 纯数据组织) —— 见下一步。
- 2026-06-25 **Ghostfolio 评估 + 官方 demo 真测** (bao "试着评估"): 开源 self-hosted wealth mgmt, REST `/api/v1/*`。**契合 CTRL 数据主权** (用户自己的 instance, CTRL 不在数据路径)。两类数据面: public endpoint `/api/v1/public/<accessId>/portfolio` (免 Bearer, 数据精简) vs `/api/v1/portfolio/details` (Bearer, 完整)。**官方 demo 真测** (`ghostfol.io`, 用 `info.demoAuthToken` 直连 Bearer): details 返回完整组合 —— **净值 $107,534 / 年化 8.75% / 净表现 +1.19% / 9 持仓** (每个含 assetProfile name+symbol / marketPrice / allocation / investment / netPerformance) + summary (cash / totalBuy / annualizedPerformancePercent)。`auth/anonymous` endpoint 存在 (dummy token → 403)。`performance` endpoint 在此版本 404 —— details 才是真相源。**结论: 合适做股票角色后端**。seed pack 升级用 **details Bearer flow** (security token → `GET /auth/anonymous/<token>` 换 authToken → `/portfolio/details`)。完整 connector 后续可交 Irisy mcp-creator flow (connector by Irisy not dev)。bao 自己 instance 端到端真测: 填 URL + Settings 的 security token。
