---
title: AI-agent 炒股 SKILL 生态调研 —— 真代码 + 全量 deep-research
kind: research
created_at: 2026-07-02
owner: bao
author: claude (deep-research 101 agent + 真读 3 个 SKILL.md 源码)
purpose: bao 贴的游资 skill 产品 → 全量调研 → 定「金融功能包」方向(bao 校准:我们做功能包不是 skill)
serves: 金融功能包(数据层)+ 能力市场;验证「卖工具/skill 不卖模型」
related:
  - "[[capability-pack-map]]"          # 股票 = 一级功能包;国内 A股 = CTRL Smart Table + AkShare
  - "[[ai-native-feature-pack-research.md]]"
  - "[[feature-pack-provision-auth-engine.md]]"
---

# 结论:每个炒股 skill = 数据层 + 知识层;数据层才是 CTRL 功能包该做的东西

## 真读的 3 个源码(clone 在 `/Users/mac/Documents/coding/stock-skills-reference/`)

1. **`a-share-skill/a-share-data/SKILL.md`** = **数据 skill**:frontmatter(name/description「Use when…」)+ 指令让 agent 调本目录 `scripts/fetch_*.py`(**AkShare + MyTT + pandas**)拿结构化数据,**不网页抓 = 防幻觉**;`references/*.md` API 文档渐进读;`scripts/` 一堆 fetch_realtime/history/technical/events/sector 脚本。
2. **`a-share-skill/tuige-shortline-trading/SKILL.md`** = **知识/游资 skill**:退哥短线体系,纯 markdown 规则(`api-reference/market-regime/stock-selection/trend-setups/limit-up-pullback/relay/washout/exit-failure/position-discipline/glossary`),渐进读;明写「**不自动下单、不替代回测、不代替投顾**」。
3. **`Stock-Analysis-Skill/SKILL.md`** = **分析 skill**:`allowed-tools: Read/Write/Bash/WebSearch`,Python 取数+算指标,**Claude 自己就是分析引擎不调外部 LLM**,数据多源级联 Tushare→efinance→akshare→yfinance。

**共同架构 = [数据获取层] + [知识/分析层]**。数据层(AkShare/Tushare 脚本或 MCP)是实打实、可复用、值得治理的那半;知识层是薄 markdown 骑在上面。

## 全量 deep-research(101 agent / 25 主张验证)要点

- **打包已标准化 = Anthropic Agent Skills**(SKILL.md 文件夹 +.skill ZIP)。两种组织:按工具/框架(`lzwme/finance-quant-skills` 13 skill 按 akshare/tushare/backtrader)vs 按功能/策略(a-share-skill)。**按游资 persona 组织的是闭源付费产品**(知识星球/淘宝,本轮没够到)。
- **数据接地 = 多源级联防幻觉**(A股:Tushare/AkShare/Baostock/efinance/Pytdx;美股:FMP/FINVIZ/yfinance/Alpaca)。免费/付费源混用。
- **★ 关键:出现了专门的「数据 plumbing MCP 层」**,刻意跟建议层分离 —— `huweihua123/stock-mcp`(MIT,A/美/ETF/指数/crypto,聚合 Tushare/AkShare/Baostock + yfinance/Finnhub/... 明写「定位不是给投资建议」)、`kylefu8/tradingview-akshare-mcp`(MIT,10 个 A股 TA 工具,AkShare 主 + Sina/Tencent failover,30s 缓存 + 本地 Parquet)。**这个数据-MCP-server 就是 CTRL 的数据功能包。**
- **下单/合规**:社区 skill 全是分析/模拟盘(无真实下单,绕开合规);只有券商 skill(**富途 Futu / moomoo / tradermonty 的 Alpaca 模板**)碰真实下单,且**全部强制人工确认(密码/手动批准)= 验证 gate-and-confirm**。
- **变现**:开源层统一 **MIT 免费**(所以「卖 skill 不卖模型」在开源层只被**弱验证** —— 都白送);付费层 = 券商(引流交易)+ 闭源游资知识产品。

## 对 CTRL(bao 校准:功能包不是 skill)

- **CTRL 该做的 = 数据功能包**:把 AkShare/Tushare/券商 数据 →(复用现成 MIT 的 `stock-mcp`/`tradingview-akshare-mcp` 或 wrap AkShare)→ §14 → `:17873` gate,**一键静默 provision(我们刚建的引擎)+ 治理**。这正是所有炒股 skill 都需要、却各自零散 pip 装、无治理的那一层。
- **loose skill 的通病 = CTRL 差异化**:手动 clone/装、数据源零散、无 gate 治理、无一键、无本地主权/市场 → CTRL 数据功能包 + 能力市场全补上。
- **知识/游资 skill = 骑在数据功能包上的 commons**(以后再叠,MIT 的可直接复用作 commons)。
- **下单 = review gate**(全行业都人工确认,CTRL 的 review_gate 正对)。
- **可直接复用的 MIT commons**:`stock-mcp` / `tradingview-akshare-mcp`(数据功能包)· `a-share-skill` / `lzwme/finance-quant-skills` / `ZhuLinsen/daily_stock_analysis`(知识 skill)。

**下一步 = 建「A股数据功能包」**(AkShare / stock-mcp,经通用 provision+auth 引擎一键装 + §14 + gate),对上 capability-pack-map「国内股票 = CTRL 自己当那个软件 + AkShare 数据源」。skill 骑在上面,后叠。
