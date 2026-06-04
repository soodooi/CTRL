# CTRL repositioned — AI/OPC tool aggregator + trust layer

**Date**: 2026-06-03
**Trigger**: bao "CTRL 是面向 AI 以及 OPC 的一个聚合平台, 痛点 = 海量 skill/MCP 等功能, 用户不知道哪个好、哪个可用、效果怎么样; 在这个方向上做全面研究"
**Status**: research complete (4 WebSearch passes), awaiting bao decision on positioning + scope

---

## 0 术语澄清

- **OPC** 在本 doc 上下文 = **OpenClaw Plugin** (`docs.openclaw.ai/tools/plugin`), 不是 OPC Foundation 工业协议 (OPC UA), 也不是 Vercel `open-plugin-spec` (它叫 OPS 不叫 OPC)
- **Skill** = Anthropic Agent Skills 规范 (`SKILL.md` plain markdown), 跨 Claude Code / Codex / Cursor / OpenClaw / Gemini CLI 30+ agent 通用
- **MCP** = Model Context Protocol, Anthropic 主推, tool-calling 标准
- **Keycap** = CTRL 原生 abstraction, 五源之一 (MCP / OAuth / local agent / STSS / builtin)

CTRL 新定位用一句话: **"AI 工具的 G2 + Setapp + Snyk 合体, 跨 MCP/Skill/OPC 三协议, native client 跑"**

---

## 1 真实市场规模 (verified 2026 数据)

### 1.1 MCP server (Anthropic Model Context Protocol)

| 平台 | 收录数 | 模式 | 用户痛点 |
|---|---|---|---|
| **mcp.so** | **20,222** servers (Apr 2026) | listing only | 无评测, 无安装路径 |
| **Glama** (`glama.ai/mcp`) | **17,000+** | listing + category + install for multi-client | install 路径有但碎片 |
| **Smithery** (`smithery.ai`) | **7,000+** | CLI install + hosted run (Docker Hub 类) | trust 缺失 |
| **awesome-mcp-servers** (GitHub) | ~3000 | curated list | 人工策展, 慢, 老 |
| **mpak.dev** | 数千 | listing + **MTF trust score** | trust 算 1 步, 没体验数据 |
| **LobeHub** | 部分 | listing + LobeHub 生态绑死 | 不跨平台 |
| **Fastio** / **Apigene** / **RoxyAPI** | 各几千 | enterprise-targeted | B2B 偏 |

**Anthropic 自己不做 canonical registry** — 故意留空间给独立 hub。

### 1.2 Agent Skills (SKILL.md 规范, 跨 30+ agent)

| 平台 | 收录数 | 模式 | 痛点 |
|---|---|---|---|
| **SkillsMP** (`skillsmp.com`) | **800,000+** (GitHub 抓取, ≥2 star 过滤) | 大目录, 无策展 | 数量爆炸, 质量不知 |
| **Skills.sh** (Vercel-backed, 2026-01 launch) | 全量 | "npm 式" 包管理, 一命令跨 Claude/Codex/Cursor/OpenClaw 安装 | 还在长 |
| **ClaudeSkills.info** | **658+** community + Anthropic official | 免费, 无付费层 | 不商业化 |
| **LobeHub Skills** | **169,000+** | LobeHub 绑生态 | 锁 LobeHub |
| **Anthropic Official Directory** | 数十 | manual curate, ship with Claude Code | 量小, 都验证过 |
| **quemsah/awesome-claude-plugins** | **15,134** plugins (May 2026, 4k → 15k 一年) | curated list | 长太快 |
| **obra/superpowers** | **94,000+ stars**, 已进 Anthropic 官方 | community framework 进官方 | 单一 framework |
| **netresearch/claude-code-marketplace** | curated, 30+ agent portable | Apache 2.0 + 跨 agent | small |

### 1.3 OpenClaw Plugin (OPC) 生态

OpenClaw 60 天 **250k GitHub stars** (2026-01 改名后), 现已是事实标准。OpenClaw 自己有 `tools/plugin` 文档 + Tencent WorkBuddy 兼容 OpenClaw → OPC plugin 生态正在快速形成, 但**还没有专门的 OPC 评测/聚合 hub** (空白市场)。

---

## 2 真实痛点 (来自数据, 不是猜)

### 2.1 安全 — 海量 MCP 有漏洞

- **36.7% 的公开 MCP server 有 SSRF 漏洞** (ChatForest 扫描数据)
- 安全扫描是"top differentiator" — 哪个目录扫了, 哪个赢
- 现有 trust score (mpak MTF / mcp-trust-radar / AgentAudit) 都是**静态分析**, 没有运行时数据

### 2.2 质量 — 99.5% MCP 跑不起来或不及格

- **ToolBench** 测 41,902 MCP server / 218,422 tool, **只 0.5% 拿 A 以上**
- 100 server stress test (12 task family × 12k trial): **median 71% pass, top decile 95%**
- 用户装 10 个 MCP, 9 个不能用 — 不是 server 烂, 是没人帮 user 筛

### 2.3 兼容 — 协议碎片 + 多 client 适配头大

- 同一 SKILL.md, Claude Code / Codex / Cursor / OpenClaw / Gemini CLI / Aider 安装姿势全不同
- 同一 MCP server, stdio / HTTP / SSE 三 transport, 不知道哪 client 支持哪个
- MCP 跟 Skill 跟 OPC 跟 OpenAI Plugin 互不通用, 创作者写 4 份

### 2.4 发现 — 分散 10+ 源, 没人统一

- "Discovery 碎片在 10+ 源" (Apigene blog 直接引语)
- npm / PyPI / GitHub / mcp.so / glama / smithery / SkillsMP / LobeHub / Anthropic / awesome-list
- 用户搜"GitHub MCP server" → 7 个不同 implementation, 不知道选谁

### 2.5 创作者经济缺失 — listing 多, 收入 0

- 现有 marketplace 都是免费 listing
- 创作者写 MCP / skill 没收入, 只剩 GitHub donation (Cline 模式)
- VSCode marketplace 50k extension, 付费 <1% — **AI tool marketplace 还没人开付费路径**

---

## 3 既有玩家覆盖矩阵 (谁做了什么, 谁没做)

| 能力 / 玩家 | mcp.so | Glama | Smithery | SkillsMP | Skills.sh | mpak | ToolBench | Anthropic | **CTRL** |
|---|---|---|---|---|---|---|---|---|---|
| MCP listing | ✓ | ✓ | ✓ | - | - | ✓ | ✓ | - | ✓ |
| Skill listing | - | - | - | ✓ | ✓ | - | - | ✓ | ✓ |
| OPC listing | - | - | - | - | partial | - | - | - | ✓ (空白!) |
| 跨协议统一 | ✗ | ✗ | ✗ | ✗ | partial | ✗ | ✗ | ✗ | ✓ (空白!) |
| 一键安装 | ✗ | partial | ✓ | partial | ✓ | ✗ | ✗ | ✗ | ✓ |
| Trust/Security score | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | partial | ✗ | ✓ |
| Quality benchmark | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓ |
| **运行时真实使用数据** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ 独占** |
| **用户评测 + rating** | ✗ | partial | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **付费分发 + 抽成** | ✗ | ✗ | partial | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Native client (非 web) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ 独占** |
| Ambient hotkey | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓ 独占** |

**CTRL 4 个独占洞** (无人填):
1. **跨协议聚合** (MCP + Skill + OPC + OpenAI tool 统一)
2. **运行时真实使用数据** (native client = 跑 = 收数据)
3. **付费分发 + 创作者经济** (现有 marketplace 没人做)
4. **Ambient hotkey 入口** (web directory 之外)

---

## 4 CTRL 重定位 — "AI tool 的 Steam + G2 + Snyk + Setapp"

### 4.1 4 层价值堆叠 (从下到上)

```
┌───────────────────────────────────────────────┐
│ L4 创作者经济           付费 / 订阅 / tip / 抽成   │
├───────────────────────────────────────────────┤
│ L3 决策层  G2 模式      评测 / rating / 对比 / 推荐 │
├───────────────────────────────────────────────┤
│ L2 信任层  Snyk 模式    Trust score / 漏洞扫描 / 使用数据  │
├───────────────────────────────────────────────┤
│ L1 发现层  Setapp 模式  跨协议统一索引 + 一键安装       │
├───────────────────────────────────────────────┤
│ L0 运行层  Steam 模式   native client + 全局 hotkey + sandbox    │
└───────────────────────────────────────────────┘
```

### 4.2 5 个 4-class 类比

| 类比 | 学什么 | 不学什么 |
|---|---|---|
| **Steam** | native client + 收集体验数据 + 创作者经济 + sandbox | 游戏内购抽成 (我们不抽) |
| **Setapp** | 订阅 bundle + 一价跑全部 + 策展精选 | mac 单一平台局限 |
| **G2 / Capterra** | 评测 + 真实用户 review + 决策对比 | 慢周期 + 营销塞钱 |
| **Snyk / Socket.dev** | 安全扫描 + 漏洞警报 + 持续监控 | 单纯 dev tool 定位 |
| **App Store / Play Store** | 一键安装 + 审核 + 抽成 + 商家关系 | 30% 抽成 + 锁 OS |
| **Hugging Face** | 开放 hub + benchmark + community + paid tier | model-only |

CTRL = **以上 5 个的 AI tool 切片**, 但 native client 这一条只 Steam / Setapp 占, 给 CTRL 体验护城河。

### 4.3 4 个独占洞 → 4 条可建竞争力

**护城河 1: 运行时使用数据 (Steam 模式)**

- native client 跑 MCP/skill/OPC → 收集真实数据 (anonymized)
- 装了多少人, 跑了多少次, 多少次失败, 平均耗时, 满意度评分
- 用数据驱动 ranking — "本周最稳" / "上升最快" / "崩溃率最低"
- **没人能从 web directory 拿到这数据**, 这是 native client 独占壁垒

**护城河 2: 跨协议统一**

- 创作者写一份 manifest, CTRL 同时上 MCP / Skill / OPC 渠道
- 用户搜"GitHub", CTRL 展示 MCP server / Claude skill / OpenClaw plugin 各路实现, 标 trust score / 使用数据
- 现有 directory 都偏一个协议, CTRL 是唯一 cross-protocol aggregator

**护城河 3: Trust + Benchmark 持续运行**

- 类比 Snyk 持续扫 npm 依赖, CTRL 持续扫 MCP/skill 漏洞
- 接入 mpak MTF / ToolBench / AgentAudit 三家分数 (公开数据), CTRL 综合打"CTRL Trust Score"
- 漏洞警报推给用户 ("你装的 X-MCP 昨天爆 SSRF, 一键升级 / 卸载")
- 这是 enterprise 必杀技 (合规需求)

**护城河 4: 创作者经济**

- 付费 MCP / skill / OPC (现在零市场)
- 平台抽 20% (vs Apple 30%, 良心定价拉创作者)
- Stripe Connect 自动结算
- 早期 100 创作者免抽成 1 年 + 官方 feature

---

## 5 商业模型 (替换 OSS doc 的 §3 三线模型)

### 5.1 4 条收入线 (聚合平台定位下)

| # | 收入线 | 模式 | 类比 | Y5 ARR 估 |
|---|---|---|---|---|
| 1 | **CTRL Pro 订阅** | trust score + benchmark + 漏洞警报 + 高级 ranking + cloud quota | G2 Pro / Snyk individual / Setapp | $9-15/mo, $5M |
| 2 | **Marketplace 抽成** | 付费 MCP/skill/OPC, 平台抽 20% | Steam / App Store / Gumroad | $2M (创作者 GMV $10M × 20%) |
| 3 | **CTRL Enterprise** | 内部 MCP 私有 hub + 合规 + on-prem + SSO | Snyk Enterprise / Sonatype | $50-100/seat/mo, $4M |
| 4 | **Verification + Promoted** | 创作者付费认证 (类 Apple $99/yr) + 推广位 | App Store + Product Hunt promoted | $0.5-1M |
| | **合计 Y5** | | | **~$11.5M ARR** |

跟 OSS doc §3 原模型对比 (Y5 $14.7M): 略低 ($11.5M vs $14.7M), 但**确定性更高** + **市场已验证 (mpak / ToolBench / Snyk 都在赚钱)** + **B2B 比例从 25% 涨到 35%** (聚合平台 enterprise 卖得更好)。

### 5.2 关键转向 — 从"我做 ambient AI 工具"到"我做 AI 工具的入口"

| 旧定位 (workbench) | 新定位 (聚合平台) |
|---|---|
| 我自己造 top 15 keycap | 我整合全世界的 MCP/skill/OPC |
| Pi 是 brain | Pi 是默认 brain, 也接 OpenClaw / Claude / Cursor / Codex 任何 agent |
| 创作者写 keycap | 创作者写 MCP/skill/OPC 任意一种, CTRL 自动适配 |
| Vault 是数据本地承诺 | Vault 仍是本地, 但 add 一个"使用数据收集 (opt-in, anonymized)"层为 ranking 供血 |
| 卖订阅 + 创作者市场 | 卖 trust / 卖发现 / 卖创作者市场 / 卖企业合规 |

**核心 unlock**: 我们从"造工具"变成"卖判断 + 卖入口", 抗 commoditization 强 (工具会被大厂复制, 判断和入口是 network effect)。

---

## 6 跟现有 ADR / CLAUDE.md 的冲突

### 6.1 必改 ADR (按 PROCESS.md amend)

| ADR | 旧 lock | 新 lock |
|---|---|---|
| 001 spine § sources | 5 keycap source (MCP/OAuth/local/STSS/builtin) | **add: skill (Anthropic SKILL.md) + OPC (OpenClaw plugin) = 7 source** |
| 002 substrate § composition | 6-axis keycap manifest | **add: cross-protocol normalize layer** (一份 manifest → MCP/skill/OPC 三协议适配) |
| 005 irisy § lifecycle | 8 stage 围绕 keycap | **add: stage 0 = Discovery via aggregator** (Irisy 推荐 ranked 工具) |
| 007 workbench § discovery | Phase 1 kernel-local, Phase 2 ctrl-cloud Worker | **promote Phase 2 to v1 critical path** (聚合平台 = aggregator backend 是核心) |

### 6.2 必新 ADR

- **ADR-008 oss-model** — 已在 §oss-business-model doc 规划
- **ADR-009 aggregator** (新 module) — trust score 算法 + 跨协议 normalize schema + 使用数据 telemetry (opt-in) 规则 + 创作者认证流程

### 6.3 跟 CTRL 哲学冲突点

| 哲学 | 张力 | 解决 |
|---|---|---|
| "augmentation 不是 dependency" | 聚合平台 = 用户依赖 CTRL 做决策 → 似乎跟 augmentation 张力 | CTRL = augmentation 决策, 不是 augmentation 工具; 类比: Steam 不是依赖, 是入口便利, 用户也可直接装游戏 |
| "数据本地" | 使用数据 telemetry 上云 = 跟"本地 truth"冲突? | telemetry 是 **opt-in + anonymized + aggregated**, 不是用户数据 (vault); 用户可关全部 telemetry 仍跑 CTRL |
| "不卖模型" | trust score / benchmark 是不是变相"卖判断" | 一致 — 我们仍不卖模型, 卖的是"哪个工具好用" |
| "vim test" | 用 vim 还能从 CTRL aggregator 拿价值吗? | 数据本地 vault 仍 vim-readable; aggregator 是 cloud value, vim 拿不到, 但 vim 拿不到也合理 (vim 没法跑 MCP) |

**0 致命冲突, 全是可化解的张力**。

---

## 7 5 个 unlock / 5 个 risk (聚合平台模式)

### 7.1 Unlock (机会)

1. **Tencent WorkBuddy 兼容 OpenClaw** → OPC 生态正在长但还没聚合 hub → **空白市场可拿**
2. **Anthropic 不做 canonical MCP registry** (明确说留空间) → CTRL 没有官方对手压顶
3. **ToolBench 数据 (0.5% A 评级)** → 99.5% 市场需要更好筛选 → CTRL 帮用户筛 = 刚需
4. **OpenClaw 60 天 250k stars** → 整个赛道在被引爆, CTRL 顺势进
5. **Skill 跨 30+ agent 通用** → Skill creator 不会绑死任何一家, CTRL 作聚合是中立第三方 → 创作者愿来

### 7.2 Risk (大公司 / 既有玩家)

| Risk | 概率 | 影响 | Mitigation |
|---|---|---|---|
| Anthropic 改主意自做 registry | 中 | 高 (官方一出我们 footprint 变小) | 已有 cross-protocol 优势 (Anthropic 不会聚合 OpenClaw/OPC); 速度 (官方动作慢) |
| Glama / Smithery 加 trust score 抄我们 | 高 | 中 (功能可抄, 但 native client + 使用数据收集抄不来) | 护城河押在 native client + 体验数据回环 |
| 大厂 (字节 / 腾讯 / 微软) 出 official aggregator | 中 | 高 | mitigation: 创作者中立性 + 跨协议 + 开源透明 |
| 创作者经济跑不起来 (鸡生蛋) | 中 | 高 (没创作者 = aggregator 没意义) | 早期补贴 + CTRL 自营头 50 高质量 keycap 撑场 |
| 用户不愿付订阅 (信息免费时代) | 中 | 中 | 免费 tier 给基础发现, Pro 给深度 trust + benchmark |

---

## 8 实施 roadmap (调整 ADR-001 § sources + ADR-007 § discovery 后)

### 8.1 v1.0 (3 个月内 ship + open source)

- L0 运行层: 已有 (Tauri shell + kernel + PWA + Pi)
- L1 发现层 MVP: ctrl-cloud aggregator (Phase 2 from ADR-007 提前到 v1) — 接 mcp.so / Glama / SkillsMP 的公开数据 sync 进 CTRL hub
- L2 信任层 MVP: 接 mpak MTF + ToolBench 公开 score, 合成 "CTRL Trust Score"
- L3 决策层 MVP: 基础 rating (五星 + comment), 用户登录后可评
- L4 创作者经济: defer 到 v1.1 (先建信任)

### 8.2 v1.1 (6 个月内)

- 运行时使用数据 telemetry (opt-in)
- 跨协议 normalize layer 完成 (MCP / Skill / OPC 一份 manifest)
- Marketplace 付费 SKU 上线 (Stripe Connect)
- Enterprise pilot (5 个 design partner)

### 8.3 v1.2+

- 真正的"CTRL 推荐" — 基于使用数据 + 用户 profile 做个性化 ranking
- 企业版 on-prem aggregator (内部 MCP 私有 hub)
- 创作者认证 + 推广位

---

## 9 决策清单 — bao 拍板项

| # | 决策点 | 选项 | 我的推荐 |
|---|---|---|---|
| 1 | 重定位接受? | A. 保留旧"ambient workbench" / B. 切到"aggregator + trust layer" / C. 双定位 | **B 切定位**, 旧 workbench 变成 aggregator 的"L0 运行层" (向下兼容) |
| 2 | 哪些协议 v1 必聚合? | A. 仅 MCP / B. MCP + Skill / C. MCP + Skill + OPC / D. + OpenAI plugin | **C** (OPC 是真空白市场, Skill 是事实标准, MCP 量大) |
| 3 | Trust score 自研还是接公开? | A. 全自研 / B. 全聚合 (mpak / ToolBench) / C. 聚合 + 自研增量 (使用数据) | **C** (公开数据快 onboard + 自研使用数据是护城河) |
| 4 | 创作者经济 v1 上? | A. v1 同步 / B. v1.1 / C. v2 | **B v1.1** (v1 先建信任, 数据起来后再开付费) |
| 5 | telemetry 默认开? | A. 默认开 + opt-out / B. 默认关 + opt-in / C. 不收 | **B 默认关 + opt-in 给 Pro 福利** (隐私优先, opt-in 给 quota / 排名洞察) |
| 6 | 跟 OpenClaw 关系? | A. 兼容并入 OPC 生态 / B. 独立竞争 / C. 战略合作 (官方互推) | **A + 主动找 OpenClaw 团队 partnership** |
| 7 | 旧 §3 商业模型替换? | A. 全换聚合平台 §5 / B. 并行双模型 / C. 旧的为主, 聚合为辅 | **A 全换**, OSS doc §3 marketplace 自然落到聚合 §5 框架内 |
| 8 | aggregator backend 开源? | A. 全开源 / B. listing/score 开源, 私有数据闭源 / C. 全闭源 | **B** (公开数据透明, 私有 telemetry / 推荐算法 / 商业逻辑闭源) |

---

## 10 立即可做的下一步

1. **修订 oss-business-model doc** — §3 三线扩为聚合 §5 四线 (CTRL Pro / Marketplace / Enterprise / Verification)
2. **新建 ADR-009 aggregator** — 9 module 比 8 多 1, 符合 PROCESS.md 新 module 才新建
3. **修订 CLAUDE.md "What is CTRL" 段** — 重写定位句, 从 "ambient OS 中枢" 变成 "AI/OPC tool aggregator + trust layer + native client"
4. **联系 OpenClaw 核心团队** (Peter Steinberger) — partnership 意愿探, 加 CTRL 进 OpenClaw plugin tooling
5. **接入公开 trust score 数据** — mpak MTF + ToolBench + AgentAudit 三家 sync, 合成 CTRL Trust Score MVP
6. **找 5 个 MCP 创作者 design partner** — 直接问"你愿意 publish 到 CTRL 吗", 早期反馈
7. **跟 Anthropic skill team 联络** — Anthropic 不做 registry 但留 directory, 探合作可能

---

## 11 类比 sanity check — 已有"判断+入口"赚钱的玩家

| 玩家 | 模式 | 体量 | 启示 |
|---|---|---|---|
| **G2.com** | B2B SaaS review aggregator | 估值 $1.1B, ARR ~$100M | 评测信息可以独立成生意 |
| **Capterra** (Gartner Digital) | SaaS discovery + review | 部分 $5B Gartner Digital biz | 同上, 但买家撮合 |
| **Snyk** | OSS dep security scanner | 估值 $7.4B, ARR $200M+ | 信任分能撑独角兽 |
| **Socket.dev** | npm 包安全审 | YC + a16z, 增长猛 | 同 Snyk 但更年轻 |
| **Setapp** | mac app 订阅 bundle | $10M+ ARR (估) | bundle + 策展模式 work |
| **Steam (Valve)** | game 入口 + 抽 30% + sandbox + 体验 | 估值 $40B+ | "入口 + 体验"超级护城河 |
| **Hugging Face** | model hub + benchmark + 付费 | 估值 $4.5B | model 版 = AI 工具版 |
| **Product Hunt** | discovery + 策展 + 社区 | 中等规模, 但流量入口 | 持续策展 = 持续流量 |

**结论**: "判断 + 入口" 是经过验证的商业模型, AI tool 切片是空白蓝海。CTRL 拿 Steam / Snyk / G2 / Hugging Face 这 4 个赚钱玩家的优点合一, 切 AI tool 这片新蛋糕。

---

**End of brainstorm — 等 bao 拍板 §9 决策清单 8 项, 再启动 ADR-009 aggregator + §10 立即可做 7 步**

---

## Sources (verified 2026-06-03)

- [MCP Marketplace Guide (Apigene)](https://apigene.ai/blog/mcp-marketplace)
- [MCP Servers (mcp.so)](https://mcp.so/)
- [Best MCP Registries 2026 (TrueFoundry)](https://www.truefoundry.com/blog/best-mcp-registries)
- [Every AI Skill Marketplace and Directory 2026 (Agensi)](https://www.agensi.io/learn/best-ai-agent-skills-marketplaces-2026)
- [SkillsMP](https://skillsmp.com/)
- [Claude Code Plugins & Marketplace Directory](https://claudemarketplaces.com/)
- [netresearch/claude-code-marketplace (GitHub)](https://github.com/netresearch/claude-code-marketplace)
- [Agent Skills, Plugins and Marketplace: Complete Guide](https://chris-ayers.com/posts/agent-skills-plugins-marketplace/)
- [Evaluating MCP Servers: Buyer's Checklist (NimbleBrain)](https://nimblebrain.ai/mcp/build-vs-buy-integrations/evaluating-mcp-servers/)
- [We Scanned Top 20 MCP Servers for Vulnerabilities (dev.to)](https://dev.to/ecap0/we-scanned-20-top-mcp-servers-for-vulnerabilities-the-results-will-shock-you-21c5)
- [MCP Scorecard (GigaBrain Observer)](https://mcp-scorecard.gigabrain.observer/)
- [MCP Scoreboard](https://mcpscoreboard.com/)
- [mcp-trust-radar (GitHub)](https://github.com/brandonwise/mcp-trust-radar)
- [ToolBench: Quality Benchmark for MCP Servers (Arcade)](https://www.arcade.dev/blog/introducing-toolbench-quality-benchmark-mcp-servers/)
- [MCP Server Reviews (ChatForest)](https://chatforest.com/reviews/)
- [100 MCP Servers Stress-Tested (Digital Applied)](https://www.digitalapplied.com/blog/mcp-server-reliability-100-server-stress-test-study)
- [Plugins · OpenClaw docs](https://docs.openclaw.ai/tools/plugin)
- [OPC Foundation OPC UA for AI](https://opcfoundation.org/news/press-releases/opc-foundation-advances-opc-ua-for-the-ai-era-with-companion-specifications-optimized-for-agentic-ai/)
