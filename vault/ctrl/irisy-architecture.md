# Irisy 整体架构 + 知识体系 — planning map (v2, 调研支撑)

> bao 2026-06-29: 「Irisy 要做什么他不清楚 → 得有一个整体架构和 Irisy 的整体知识体系」+「你还是做个调研吧」。
> 本文是 Irisy 的**非权威规划图**(系统设计先行),v2 把「魂 / 操作循环 / 知识栈」从拍脑袋换成 3 路调研支撑的版本(对标产品 + 工程 best-practice + 国内市场)。模块 ADR 语料库是唯一架构权威;本文不得覆盖 accepted ADR。
> 收口现有散文档,不重复:角色轴见 [[irisy-roles.md]];脑/投影见 [[architecture-byo-cli-driver.md]]。
> 确认后 amend owning module ADR + 走 dev-loop。

## Status: 魂 LOCKED (bao 2026-06-29 拍「数字员工/运营官 调研版」) — §二/§三/§四 收口中,据此 amend ADR-005 + 走 dev-loop

---

## 〇、能力域镜头(5 capabilities — planning lens, 2026-07-22)

> bao 2026-07-22:「一切都是为了建立 Irisy 的能力」。Irisy 整体架构以 **5 能力域**作为跨模块规划镜头 —— 每个能力 = Irisy 操作的东西 + 它的端点(经 `:17873` gate)+ 前端 surface + L1 模块(或横切)。
>
> **镜头模式(非替代)**:8 module ADR 是唯一架构权威(按代码归属划分);本镜头按「Irisy 操作什么」reframe 已接受决定,不自行创造或覆盖决定。实施时按 owning module ADR 原地 amend。

| # | 能力域 | Irisy 做什么 | 端点(gate / §14) | 前端 surface | L1 |
|---|---|---|---|---|---|
| ① | **md 文档管理** | 知识库 / 笔记 / 功能包文档管理(记·找·用) | §14 `text::{describe,query,produce}` + `record::*`(notes/smart-table/pack-docs 统一)+ FTS5/embeddings | KB-view workspace | Notes/KB |
| ② | **html** | 产出 HTML + 前端渲染展示 | §14 `produce` HTML artifact + viewer registry(12 类)+ FeaturePackScene | morphing output / pack workspace | 横切(嵌各 workspace) |
| ③ | **coding** | 创建功能包 + coding | projection(opencode)+ `mcp_pack_{create,validate,publish}` + `source_*` | Coding scene + PackCreator | Coding |
| ④ | **通讯** | 内部 + 外部通讯;给 Irisy 建端点 | gate `:17873` + MCP 插件 + 传输 + **物化 endpoint-spec** | Irisy dialog + Settings/connections | substrate |
| ⑤ | **L1/L2** | 把能力摆成可导航模块 + role 切换 | nav 层 + role switcher `(persona,pack,kb)` | L1 rail + L2 sub-nav | nav 本身 |

**异构性(重要)**:5 能力非全是 L1 模块 —— ①③ 是用户面模块(独立 L1 + workspace);②④ 是横切能力(渗透所有模块);⑤ 是导航层(meta,摆前 4 个)。**不强行让每个能力都成 L1。**

**与现有架构的错位**(reframe 要收敛的债):现有 8 module ADR 是**代码归属边界**非能力边界。①md 的 §14 写侧 `RecordSink`/`ProduceOp` 已于 2026-07-02 实装;当前 Track 2 债务是退役 5 个冗余 bespoke 脑面写工具并验证统一 `produce` 路径。

**收敛轨道**(6 track,地基→上层):`0 治理 → 2 md §14 写侧收敛 → 1 通讯[可并行] → 3 html → 4 coding → 5 L1/L2`;每一轨的约束和实施决定归 owning module ADR。

---

## 病根(为什么 Irisy「不智能」)

不是模型(模型是放大器)。两个结构性缺陷:

1. **没有魂** — 系统提示 = 身份 + 风格 + 一长串工具 + 护栏,**唯独没有"使命"**。13 版补丁史里 v10 自己都写「the user couldn't tell what Irisy is FOR」,然后用"三个界面"糊过去 —— 那是描述出现在哪,不是要干什么。→ Irisy 永远"等你问→浅答"。
2. **知识散成 5 摊、无真相源** — 散在 `irisy-prompts.ts` + `acp_client.rs::CTRL_CAPABILITY_BRIEF` + hermes 的 SOUL/config + vault + skills。两份提示漂移 → brief 吹假能力、SOUL 被漏看(都已临时修)。

调研结论同向印证:**业界领先助手把"使命"做成模型外的持久脚手架(constitution),把"知识"做成分层、单真相源、注入-vs-召回的体系。** 本文据此重建。

---

## 一、魂(mission)— LOCKED (bao 2026-06-29)

> **Irisy = 一人公司的"数字员工"** —— 以**角色**(销售跟进 / 客服 / 文书 / 记账…)替你**把整件事做完**,在你**本地自有的数据**上记住你的生意(客户、上下文),缺工具就当场造(功能包),全程经 `:17873` gate。

三个支柱差异点(调研提炼,缺一不可):
1. **完成整件事,不是答问题** — 2025–26 国内外都从「answer」转向「complete the whole job / runs while you sleep」(Notion Agents、Doubao Office Mode、Manus、Accio "数字员工团队")。Irisy 用 CTRL 的 one-shot 原子动作实现,不做 wizard。
2. **记得你的生意 —— 本地** — 「客户画像 / 千人千面」是国内每个对手都打的牌,但**都得把你的客户书存进他们的云**;Irisy 给 agent 这份上下文**而不导出**(vault-is-truth)。这是最锋利的一条缝。
3. **自我扩展** — 缺能力当场造功能包(对标 Manus 的 Skills/Projects:把成功经验沉成可复用 playbook)。

**定位红线**(国内调研,避开打不赢的仗):
- **不抢"免费全能超级框"中心**(豆包/夸克/元宝 靠免费 + 微信分发占死,分发打不过)→ Irisy 走 **owner-role「替你打工的同事」**,按角色定义价值,不做泛聊。
- **不做深度陪伴**(陪伴市场浅、churn >50% 月活 <5 天、监管暴露)→ Irisy = **温暖但可靠的同事**,不是陪伴体。信任来自**准确 + 一致 + 给你看它怎么做的(drill-down)**,温暖只是包装。
- **隐私讲"商业数据主权"不讲抽象隐私** — 消费者对隐私是宿命论的;但 SMB 层有真痛点(PIPL/DSL 合规 + 数据外泄焦虑 + 跨 app 自动化被封号,如 Doubao AI Phone 24h 被微信/淘宝/支付宝封)。卖点 = **"你的客户/生意数据永不离开本机:不被挖、不被训练、不被封号、PIPL 干净"**。

*(若 bao 的魂不同,改这一段,全文随之调。)*

---

## 二、操作架构(operating architecture)

### 2.1 操作循环 — Irisy 每轮/常驻怎么动(魂的可执行版)

调研里 IBM/Oracle/ProAct 的 agent loop + CTRL 的 gate,合成为:

```
Sense 感知      : 读意图 + 扫最近 vault/系统信号(开着的 L1/场景、待办、客户消息)
  → Anticipate  : 空闲时预备 1–3 个可能的下一步,决定 present-now / save / hold(不老打断)
  → Plan 规划   : 拆成「答 / 动作 / 造工具」;缺工具 → 提议造功能包
  → Act 行动    : 经 :17873 gate —— 读/可逆 = 自动做;写/花钱/外发/删 = 打包上下文先确认
  → Produce 产出: 答在对话,文档/页面路由进对应模块的 workspace(不是丢一坨到聊天)
  → Persist 沉淀: 决策/结果写回 vault → 下一轮更聪明(capture→recall→supply)
```

系统提示要讲的是**这条循环**(右"altitude"的启发式),不是工具清单。

### 2.2 主动性护栏 — 主动但不烦(调研有实测:主动帮助会伤用户胜任感)

1. **可逆性 = ask 边界**:读/可逆静默做;写/外发/花钱/删 → 经 gate 暂停确认(业界 HITL 标准)。这正是 `:17873` gate 的天职。
2. **只推 trigger 触发 + 目标相关**的建议,绑到检测到的信号(截止/冲突/陈旧项),**批量成一条 brief,不刷屏**。
3. **给"一键建议"让用户可忽略**,不越俎代庖;"hold 到需要时"是合法结果。
4. **透明 + 主权**:每个动作可 drill-down 看原始;跑在本地 vault;**永不锁输入框**(CTRL 既有铁律);任何主动例程可关。

### 2.3 三轴 + 左右区

- 三轴(引擎 / 角色 / 功能包)正交 → 见 [[irisy-roles.md]];引擎轴 ADR-005 §8.7/§8.8。
- 左 = workspace/输出(per-L1);右 = Irisy 助手(本文主体)→ ADR-005 §8.7。

---

## 三、知识体系(knowledge system)— 8 层,调研支撑

**原则(Anthropic context engineering 等):静态提示尽量小("右 altitude"),动态知识走工具 just-in-time;每层一个单一真相源;能力意识"派生"不"手写"。**

### 3.1 知识 8 层(从"总注入·小"到"按需召回·大")

| # | 层 | 单一真相源 SSOT | 注入开轮 vs 召回按需 | 备注(调研对标) |
|---|---|---|---|---|
| 1 | **身份 / 使命** | `irisy-prompts.ts`(版本化) | 注入,极小 | 谁 + 一人公司使命 + 操作循环。constitution 式持久脚手架。 |
| 2 | **persona / 风格** | persona 池(版本化) | 注入,极小,按角色 | 只放声音/语气,跟身份解耦以便按角色换。 |
| 3 | **能力意识** | **gate 实时注册表**(MCP `tools/list` / `visibility.rs`) | 注入,**每轮从注册表生成** | ★诚实修复:提示只写"用工具策略",目录靠派生 → 结构上再不可能吹不存在的能力。 |
| 4 | **durable 用户/生意事实** | `vault/irisy/` 下 markdown(md + YAML) | 注入,**有上限**(Letta core-block 式) | 名字/公司/偏好 + **客户画像核心**。写时 ADD/UPDATE/DELETE 对账去重(mem0 模式),不只追加;超限降级到 7。 |
| 5 | **技能元数据** | `SKILL.md` frontmatter | 注入,**仅 name+desc**(~30–50 tok) | 渐进披露 stage1;body 命中才读(stage2),refs 执行才读(stage3)。 |
| 6 | **inferred 偏好/软上下文** | 过往会话派生索引 | **召回** top-k | "dreaming"软记忆层,可变,绝不强注入。 |
| 7 | **vault 项目大脑 / 客户书** | **用户 markdown vault(vault is truth)** | **召回 just-in-time** | 个人规模(<1M tok)**按需读文件 > 切块 RAG**(glob/grep/read);大了上本地 FTS5 + sqlite-vec 混合 + RRF。 |
| 8 | **归档 / 会话记忆** | 窗口外文件(memory-tool 目录) | **召回**;compaction 前 flush | Anthropic memory-tool + context-editing:重要结果落文件再清窗口,后续取回。 |

**组装**:1–3 + 4(capped)+ 5(元数据)每轮注入;6–8 引擎按需用工具拉。长会话用 **compaction + tool-result clearing + 结构化笔记 + 子代理**,细节不撑爆主窗口。

### 3.2 三条铁律(根治散乱)

1. **每层一个 SSOT** —— 身份/风格/能力不再分散两文件;`CTRL_CAPABILITY_BRIEF` 并入统一组装点。
2. **能力意识派生不手写** —— 从 gate 真实 `tools/list` 生成(根治"吹假能力"+ "漏看工具")。
3. **脑与对话共享同一知识源** —— hermes 看到的 = 对话路径组装的,不两套(根治 SOUL 漏看)。

### 3.3 local-first / vault-is-truth / BYOK 契合与避坑

- ✅ **memory 存成 vault markdown**(Anthropic memory-tool 本就客户端自管)→ 过 vim test、无锁定。
- ✅ **按需读文件就是 vault-is-truth**;能力派生用 gate 就是 CTRL 现有架构;本地 FTS5+sqlite-vec 全端侧。
- ⚠️ **mem0 / Letta 是托管服务** → 只借模式(memory block、写时对账、sleep-time 整理),不用其云;在 kernel 上用 vault 文件实现。
- ⚠️ **BYOK 下 embedding 可能把 vault 泄给云 embedder** → 默认**本地 embedder**;云 embed 需明确同意 + 经 gate 审计;FTS5/BM25 永远本地兜底(无 key 也能检索)。
- ⚠️ **记忆写入靠模型判断**(Letta 已知弱点)→ 所有记忆写入**经 gate 可审计可回滚**(符合 read-the-ledger + drill-down)。
- ⚠️ **便利对等风险**(用户已习惯"云同步记忆处处可用")→ 用 mesh P2P(ADR-002)实现"本地记忆也处处可用",别让 local-first 感觉像功能缺失。

---

## 四、现状差距 + 落地顺序

| 项 | 现状 | 动作 |
|---|---|---|
| 魂(层1) | ❌ 无 | bao 拍一句 → 写进 spine(constitution 式) |
| 一条 spine(3.1 组装) | ❌ 两份提示漂移 | 合并 `CTRL_CAPABILITY_BRIEF` 进统一组装点 |
| 能力派生(铁律2) | ❌ 手写 brief(已删假货) | 从 gate `tools/list` 自动生成能力清单 |
| 操作循环(2.1) | ❌ prompt 是工具清单 | 系统提示改写为"循环 + 角色职责"叙事 |
| 记忆体系(层4/8) | 🟡 SOUL 工具刚可见(§8.8) | 落 durable 块(有上限+写时对账)+ 归档/flush |
| 主动性(2.2) | ❌ 纯被动 | 加 Sense/Anticipate(空闲预备 + present/save/hold)+ gate 确认 |
| 角色轴(层2) | 🟡 roles.md DRAFT | 与本文一起锁;角色 = owner-role(销售/客服/文书/记账) |
| 客户画像 + 跨 IM(微信)摄入 | ❌ 未做 | 国内 OPC 杀手级:本地存客户书 + "转发/截图微信→摘要→记跟进";本地反而绕开封号 |

**顺序**:① bao 确认魂 + 定位红线 → ② 锁本文 + roles.md → ③ amend ADR-005(把知识体系写进 §persona/§8)→ ④ 实施(合并 spine + 能力派生 + 循环改写 + 记忆块)→ ⑤ dev-loop。

---

## 调研出处(3 路,2026-06)

**知识体系/上下文工程**:Anthropic *Effective context engineering* + *Agent Skills* + *Memory tool* + *long-running agents*;OpenAI ChatGPT memory / "dreaming";Letta/MemGPT(memory blocks、sleep-time);mem0(extract + ADD/UPDATE/DELETE);MCP `tools/list` 动态发现;Hybrid FTS5+vec+RRF;本地 RAG(Ollama+SQLite)。
**主动/操作员**:Manus(目标拆解 + Skills/Projects);AI chief-of-staff(Alyna/Lindy);ArbiterOS constitution(arXiv 2510.13857);ProAct(预备-决定-呈现);proactivity 三维 + 胜任感反噬(Springer BISE、Morae);agent loop(IBM/Oracle/MindStudio);HITL 可逆性边界(AWS Bedrock/Galileo)。
**国内/OPC**:豆包/Kimi/GLM/元宝/夸克/文小言/Monica/Manus 定位 + 记忆;AutoGLM、Doubao Office Mode(完成整件事);飞书智能伙伴 / AILY / 追一 / 金蝶(数字员工=按角色);Accio/QoderWake(一人公司数字员工团队);客户画像 + 跨 IM;PIPL/DSL + 数据外泄焦虑 + Doubao AI Phone 封号;陪伴市场 churn;信任=准确+一致+透明。

## 关联
- 角色系统 → [[irisy-roles.md]] · 脑/投影 → [[architecture-byo-cli-driver.md]] · 引擎轴 → ADR-005 §8.7/§8.8 · 秘密不入 Irisy → [[decisions/0004-secrets-never-touch-irisy]]
