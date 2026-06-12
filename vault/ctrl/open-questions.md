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

## 其它
- [ ] worktree lanes(`feat/pwa-irisy-single-entry`、`feat/remote-window-share-spike`)+ open PR #83 要不要合
- [ ] 定位写进 ADR:CTRL = 项目大脑 是否 amend ADR-001 spine / ADR-005 irisy(避免跟实装漂移)
