# 待解决 (Open Questions)

> 唯一可变的「未解决」清单。解决了就划掉 / 移进 log 或 decision。

## Irisy 助理 (hermes)
- [ ] **端到端真机测**:用 Claude Sonnet API key 在真 Tauri app 配 → hermes 回话通不通?(沙盒假 key 测不出真往返)
- [ ] hermes 认不认 volc / zhipu 的自定义 `OPENAI_BASE_URL`?(需真 key 在真机验证)
- [ ] oneshot 体验差(冷启动慢、无流式)→ 是否上 ACP streaming client(路 B)

## 项目大脑落地(下一步)
- [ ] **supply 步**:实现 vault → `AGENTS.md` 自动派生 + vault-knowledge MCP server(这是 wedge 的关键)
- [ ] **capture 自动化**:扩展 ADR-008 curator loop,从 Irisy-self-memory 到 project memory
- [ ] **recall**:本地 RAG(FTS5 + embeddings)接到 Irisy,能问答这个 vault
- [ ] 这个 vault 要不要移进 CTRL Notes vault(`~/Documents/CTRL/Notes/`),让 CTRL app 自己能看(真 dogfood)

## 模块化平台落地(最大的方向,全是「移除表面积」)
- [ ] **Coding / Notes 从 sidebar 固定 face → 可安装模块**(sidebar 不再硬编码它们)
- [ ] **模块按意图浮现**:Irisy 匹配已装模块的 manifest 描述,只加载 1-3 个(progressive disclosure)
- [ ] **Discover = 模块 store**:按场景组织、一键装(.mcpb 式 bundle)、key → keychain、AI 从一句话生成 manifest
- [ ] **coding 模块**:wrap opencode / Claude Code / Codex 成可装模块(BYOK)= 获客 beachhead
- [ ] 节奏 + 砍什么由 bao 定;原则:只一个 primitive(模块),无菜单膨胀,curation,场景组织

## 场景化一键装(杀手用例 · 配置省时,bao 2026-06-12)
- [ ] **⚠ 边界(bao 2026-06-12)**:这是**模块**,不是 CTRL 基础功能。CTRL 底座只提供 plumbing —— 模块 manifest schema + runner + secret→keychain 通道([[0004-secrets-never-touch-irisy]])+ 工作区 secret 控件;具体场景(CF Workers 开发 / Python 环境…)= Discover 可装模块(AI 生成 / 社区分享),**不内置**。CTRL 不长胖,胖的是模块库 → [[0003-ctrl-is-modular-intent-platform]]
- [ ] **痛点**:配开发环境、配 CF token 这类,手动一步步弄占用用户大量时间
- [ ] **解法**:场景化一键装 —— 选场景(如「CF Workers 开发」)→ 一键**装工具链 + 引导填 token(进 keychain)+ 注入环境变量**;把「装工具 + 配 secret + 设环境」打成一个 pattern,友好引导替代手动
- [ ] **借鉴**:[[opensuse]] Patterns(成组一键)+ [[quicker]] 动作市场(复制链接装)+ ProviderHub 友好配置;落点 = coding 模块(KOL beachhead)
- [ ] **待定**:pattern manifest 长啥样?装工具走什么(brew / winget / 内置)?token 引导 UI?跨平台怎么抹平?

## 其它
- [ ] **logo**:bao 给干净版(无网格底)→ 换掉 sidebar 纯文字 "CTRL"
- [ ] **Sonnet 真机测**:bao 在 CTRL 配了 anthropic(key 在 keychain),要让 hermes 用上需写进 ~/.hermes/.env
- [ ] worktree lanes(`feat/pwa-irisy-single-entry`、`feat/remote-window-share-spike`)+ open PR #83 要不要合
- [ ] 定位写进 ADR:CTRL = 项目大脑 + 模块化平台,amend ADR-001 spine / ADR-005 irisy(避免跟实装漂移 —— 现在 ADR 还把 Coding/Notes 当固定 face)
