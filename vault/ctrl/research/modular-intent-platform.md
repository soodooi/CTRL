# 调研:模块化、意图驱动的 AI 平台 (2026-06-11)

重新定位 CTRL(业务角度):模块化、意图驱动、用户拥有的本地 AI 工作台。

## 业务定位
- 类别:**「Raycast 的可扩展平台 + local-first」** —— 模型中立、用户拥有的 AI 模块宿主,由开发者种子。
- **Raycast 模板**:launcher → 可扩展平台 → store → AI 层。**free 核心 + Pro 订阅(~$8/mo)**;extension store 是 **moat + 获客引擎,不是收入线**。$30M Series B(Atomico 领投),2 万开发者,2000+ extensions。
- CTRL 买家:prosumer / 一人公司(付 Pro);楔子:开发者 / coding KOL(获客)。

## 模块平台模式(谁做得好 / 空位)
- 安装友好:Raycast(开扩展按 ⏎ 即装)、Anthropic **.mcpb**(双击装、key→keychain、curated 目录)、Zapier(OAuth 一键「Connect」)。
- **MCP 对非技术的摩擦(Anthropic 自己列)**:要 Node/Python、手编 JSON、无发现、更新麻烦 → .mcpb 修复(单一 bundle、双击装、无 JSON)。但 **Claude-only + 锁 Anthropic 模型**。
- **空位**:没有 local-first + 用户拥有 + 非技术友好 + 模型中立的模块宿主。Raycast 云 Pro+Mac;Claude Desktop 锁模型;Zapier 云跑拿数据。**CTRL 三条全占 = 空象限。**

## 意图驱动(反乱机制)
- **Claude Agent Skills**:启动只读 metadata(name/desc)→ 相关才加载全文(**progressive disclosure**)。
- 静态 tool-dump 失败:50 tools ≈ 72K tokens;>30-50 tools 选择质量下降。on-demand 加载省 ~90% context。
- CTRL:Irisy 匹配意图 vs 已装模块 manifest 描述 → 只加载 1-3 个。**scale 活在 registry,不在 UI。**

## coding = 获客(KOL)
- Cursor 0→$2B ARR(最快 B2B 软件)、Claude Code 46% most-loved —— 全靠开发者口碑,bottom-up。
- CTRL coding 模块(wrap opencode/Claude Code/Codex,BYOK)→ 开发者 KOL 来用 → 他们成模块供给(Raycast 2 万开发者 flywheel)→ 口碑带平台 → 带非技术买家。

## 用户可操作(app-store,不是配置文件)
- 一键 bundle 装(.mcpb)、guided 表单 → keychain、OAuth「Connect」按钮(不贴 token)、按场景组织的 store、模板做 on-ramp、AI 从一句话生成 manifest。

## 落地
① Coding/Notes 固定 face → 可装模块;② 意图浮现(Irisy 匹配 manifest 描述);③ Discover = 模块 store(场景组织、一键装、keychain)。

> 完整 sources(Raycast / Cursor / Anthropic Skills+MCP / Zapier / 本地优先)见 memory `project-ctrl-modular-intent-platform`。
